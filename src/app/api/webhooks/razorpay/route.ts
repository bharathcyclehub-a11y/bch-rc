/**
 * POST /api/webhooks/razorpay
 *
 * Razorpay calls this on every payment event. The redundant backup to the
 * client-side verify call — if the customer closes the tab right after pay,
 * the webhook is what marks their order PAID.
 *
 * Idempotency: every event has Razorpay's `id` (e.g. `evt_*`). We INSERT
 * into webhooks_inbound with UNIQUE(source, external_id) — retries become
 * no-ops.
 *
 * Webhook secret must be set in Razorpay dashboard → Settings → Webhooks →
 * Add → Secret. Mirror the same value in RAZORPAY_WEBHOOK_SECRET env var.
 *
 * Events handled:
 *  - payment.captured     → PAID  + CAPTURED
 *  - payment.failed       → FAILED + FAILED
 *  - refund.created       → REFUNDED + REFUNDED
 *  - refund.processed     → idempotent confirm of refund state
 */

import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, events, webhooksInbound } from "@/db/schema";
import { verifyWebhookSignature, fetchAndConfirmCapture } from "@/lib/razorpay";
import { notifyOrderEvent } from "@/lib/notifications/notify";
import { sendSellerOrderAlert } from "@/lib/notifications/notify-seller";
import {
  enqueueShipmentJob,
  runShipmentJobOnce,
} from "@/lib/fulfillment/shipment-queue";
import { releaseOrderHoldsBestEffort, reacquireOrderHolds } from "@/lib/inventory/release";
import { applyRazorpayRefundEvent, onlineRefundable } from "@/lib/support/refunds";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn("RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: {
    id?: string;
    event: string;
    payload?: {
      payment?: { entity?: { id: string; order_id: string; amount: number; status: string; method?: string | null; error_description?: string } };
      refund?: {
        entity?: { id: string; payment_id: string; amount: number; status: string; notes?: Record<string, string> };
      };
      payment_link?: { entity?: { id: string; reference_id?: string; amount: number; status: string } };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const externalId = event.id ?? `${event.event}-${Date.now()}`;

  // Idempotency check. UNIQUE(source, external_id) makes this a no-op on retry.
  try {
    await db.insert(webhooksInbound).values({
      source: "razorpay",
      externalId,
      payload: event,
      processed: false,
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      // Already received. Acknowledge so Razorpay stops retrying.
      return NextResponse.json({ ok: true, duplicate: true });
    }
    throw err;
  }

  // Process the event.
  try {
    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload?.payment?.entity;
        if (!payment) break;
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.razorpayOrderId, payment.order_id));
        // A captured payment is GROUND TRUTH. Process it even if a prior failed
        // attempt already marked the order FAILED (Razorpay allows retry on the
        // same order: fail → succeed). The old guard excluded FAILED here, so a
        // successful retry was silently dropped — money taken, no order. Only a
        // genuine CAPTURED (already done) or REFUNDED order is skipped.
        if (order && order.paymentStatus !== "CAPTURED" && order.paymentStatus !== "REFUNDED") {
          // Partial-prepaid COD (Pay X now + rest on delivery) captures only
          // the upfront confirmation fee, not the total. Pure prepaid (UPI/
          // CARD/etc.) captures the full total. Legacy COD orders (created
          // before 2026-06-13) have confirmationFeeInr === 0 and never hit
          // this code path because they never have a Razorpay order_id.
          const isPartialPrepaidCod =
            order.paymentMethod === "COD" && order.confirmationFeeInr > 0;
          const expectedAmountPaise = isPartialPrepaidCod
            ? order.confirmationFeeInr * 100
            : order.totalInr * 100;
          // Even though the webhook payload is signed, an attacker who
          // captures a real webhook body + signature could replay it against
          // a different order with the same total. Belt-and-suspenders: hit
          // Razorpay's API and require status==="captured" + matching
          // order_id + matching amount before committing PAID.
          const confirm = await fetchAndConfirmCapture({
            paymentId: payment.id,
            expectedRazorpayOrderId: order.razorpayOrderId!,
            expectedAmountPaise,
          });
          if (!confirm.ok) {
            await db.insert(events).values({
              siteId: order.siteId,
              orderId: order.id,
              customerId: order.customerId,
              type: "WEBHOOK_PAYMENT_CAPTURE_UNCONFIRMED",
              payload: { paymentId: payment.id, reason: confirm.reason },
              source: "webhook",
            });
            break;
          }
          // If a prior failed attempt released this order's stock, re-reserve it
          // BEFORE marking PAID so a recovered order never under-ships.
          if (order.holdsReleased) {
            await reacquireOrderHolds(order.id);
          }
          await db
            .update(orders)
            .set({
              status: "PAID",
              paymentStatus: "CAPTURED",
              razorpayPaymentId: payment.id,
              paidAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));
          await db.insert(events).values({
            siteId: order.siteId,
            orderId: order.id,
            customerId: order.customerId,
            type: "WEBHOOK_PAYMENT_CAPTURED",
            payload: { paymentId: payment.id, amount: payment.amount, recoveredFrom: order.status !== "PENDING" ? order.status : undefined },
            source: "webhook",
          });

          // Confirmation + shipment trigger — webhook is the safety net for
          // customers who closed the tab before /verify fired. notifyOrderEvent
          // reads the just-updated row so the txn ref renders on the receipt.
          await notifyOrderEvent(order.id, "PAYMENT_CAPTURED");
          // Alert the seller/ops so they pack fast (email now, WhatsApp when
          // configured). Runs past the response; never blocks the webhook.
          after(() => sendSellerOrderAlert(order.id).catch(() => {}));
          // Durable + exactly-once: enqueue the job, run it past the response.
          // Dedups against /verify via the job PK + atomic claim.
          await enqueueShipmentJob(order.id);
          after(() => runShipmentJobOnce(order.id).catch(() => {}));
        }
        break;
      }
      case "payment_link.paid": {
        // Manual-order Payment Links don't carry a Razorpay order_id — we
        // match them via reference_id (our PRC-XXXXXXXX) which we set when
        // creating the link in /api/admin/orders/create.
        const link = event.payload?.payment_link?.entity;
        const payment = event.payload?.payment?.entity;
        if (!link || !payment) break;
        const referenceId = link.reference_id;
        if (!referenceId) break;
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.id, referenceId));
        if (
          order &&
          order.createdVia === "ADMIN_MANUAL" &&
          order.paymentStatus !== "CAPTURED" &&
          order.paymentStatus !== "FAILED" &&
          order.paymentStatus !== "REFUNDED"
        ) {
          // Amount must match. Payment-link.paid amount is in paise.
          if (Number(payment.amount) !== order.totalInr * 100) {
            await db.insert(events).values({
              siteId: order.siteId,
              orderId: order.id,
              customerId: order.customerId,
              type: "WEBHOOK_PAYMENT_LINK_AMOUNT_MISMATCH",
              payload: {
                paymentLinkId: link.id,
                paid: payment.amount,
                expected: order.totalInr * 100,
              },
              source: "webhook",
            });
            break;
          }
          await db
            .update(orders)
            .set({
              status: "PAID",
              paymentStatus: "CAPTURED",
              razorpayPaymentId: payment.id,
              paymentMethod: payment.method
                ? (payment.method.toUpperCase() as "UPI" | "CARD" | "NETBANKING" | "WALLET")
                : "UPI",
              paidAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));
          await db.insert(events).values({
            siteId: order.siteId,
            orderId: order.id,
            customerId: order.customerId,
            type: "WEBHOOK_PAYMENT_LINK_PAID",
            payload: {
              paymentLinkId: link.id,
              paymentId: payment.id,
              amount: payment.amount,
              method: payment.method ?? null,
            },
            source: "webhook",
          });
          // Same downstream as customer-self-service capture: confirmation
          // email + seller alert + Shiprocket shipment.
          await notifyOrderEvent(order.id, "PAYMENT_CAPTURED");
          after(() => sendSellerOrderAlert(order.id).catch(() => {}));
          await enqueueShipmentJob(order.id);
          after(() => runShipmentJobOnce(order.id).catch(() => {}));
        }
        break;
      }
      case "payment_link.expired":
      case "payment_link.cancelled": {
        // Customer let the manual-order link expire (or admin cancelled it).
        // Release reserved stock so it's available again. Leave the row as
        // CANCELLED with the audit trail so we can see what happened.
        const link = event.payload?.payment_link?.entity;
        if (!link?.reference_id) break;
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.id, link.reference_id));
        if (order && order.createdVia === "ADMIN_MANUAL" && order.status === "PENDING") {
          await db
            .update(orders)
            .set({
              status: "CANCELLED",
              cancelledAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));
          await db.insert(events).values({
            siteId: order.siteId,
            orderId: order.id,
            customerId: order.customerId,
            type:
              event.event === "payment_link.expired"
                ? "WEBHOOK_PAYMENT_LINK_EXPIRED"
                : "WEBHOOK_PAYMENT_LINK_CANCELLED",
            payload: { paymentLinkId: link.id },
            source: "webhook",
          });
          await releaseOrderHoldsBestEffort(
            order.id,
            event.event === "payment_link.expired" ? "ABANDONED" : "CANCELLED",
          );
        }
        break;
      }
      case "payment.failed": {
        const payment = event.payload?.payment?.entity;
        if (!payment) break;
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.razorpayOrderId, payment.order_id));
        if (order && order.paymentStatus !== "CAPTURED") {
          await db
            .update(orders)
            .set({
              status: "FAILED",
              paymentStatus: "FAILED",
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));
          await db.insert(events).values({
            siteId: order.siteId,
            orderId: order.id,
            customerId: order.customerId,
            type: "WEBHOOK_PAYMENT_FAILED",
            payload: {
              paymentId: payment.id,
              error: payment.error_description,
            },
            source: "webhook",
          });
          // Return the reserved stock + coupon usage to the pool.
          await releaseOrderHoldsBestEffort(order.id, "PAYMENT_FAILED");
        }
        break;
      }
      case "refund.created":
      case "refund.processed":
      case "refund.failed": {
        const refund = event.payload?.refund?.entity;
        if (!refund) break;
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.razorpayPaymentId, refund.payment_id));
        if (!order) break;
        await db.insert(events).values({
          siteId: order.siteId,
          orderId: order.id,
          customerId: order.customerId,
          type: `WEBHOOK_${event.event.toUpperCase().replace(".", "_")}`,
          payload: { refundId: refund.id, amount: refund.amount, status: refund.status ?? null },
          source: "webhook",
        });
        // Refund cases (support centre / admin) settle themselves here.
        const handled = await applyRazorpayRefundEvent(event.event, refund);
        // Legacy path for refunds made outside the support centre (Razorpay
        // dashboard). Only a PROCESSED refund is money back — refund.created
        // used to mark the order REFUNDED before the bank confirmed anything.
        if (!handled && event.event === "refund.processed") {
          const full = refund.amount >= onlineRefundable(order) * 100 && order.paymentMethod !== "COD";
          await db
            .update(orders)
            .set({
              ...(full ? { status: "REFUNDED" as const } : {}),
              paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));
          // Refunded goods go back to sellable stock; coupon usage is released.
          if (full) await releaseOrderHoldsBestEffort(order.id, "REFUNDED");
        }
        break;
      }
    }

    await db
      .update(webhooksInbound)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(webhooksInbound.externalId, externalId));
  } catch (err) {
    await db
      .update(webhooksInbound)
      .set({ error: String(err) })
      .where(eq(webhooksInbound.externalId, externalId));
    throw err;
  }

  return NextResponse.json({ ok: true });
}
