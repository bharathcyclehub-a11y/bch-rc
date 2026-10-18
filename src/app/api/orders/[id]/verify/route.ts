/**
 * POST /api/orders/[id]/verify
 *
 * Called by the client right after Razorpay's checkout modal returns success.
 * Verifies HMAC signature → marks order as PAID. If signature is bad, we
 * reject — almost certainly a forged "paid" claim, never a real Razorpay
 * event since they always sign with the correct secret.
 *
 * Webhooks at /api/webhooks/razorpay are the redundant backup — they also
 * capture this transition, idempotently, in case the client never returns
 * (network drop, customer closes tab right after pay).
 *
 * After capture: enqueue + inline-send PAYMENT_CAPTURED email, trigger
 * Shiprocket shipment in-process (no HTTP self-call so the admin-gated route
 * stays admin-gated).
 */

import { NextResponse, after } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, events } from "@/db/schema";
import { verifyRazorpaySignature, fetchAndConfirmCapture } from "@/lib/razorpay";
import { reacquireOrderHolds } from "@/lib/inventory/release";
import {
  enqueueShipmentJob,
  runShipmentJobOnce,
} from "@/lib/fulfillment/shipment-queue";
import { notifyOrderEvent } from "@/lib/notifications/notify";

const Body = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid body", details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!order.razorpayOrderId) {
    return NextResponse.json(
      { error: "Order has no razorpay_order_id (was this a COD order?)" },
      { status: 400 },
    );
  }
  if (order.paymentStatus === "CAPTURED") {
    return NextResponse.json({ ok: true, orderId: id, alreadyPaid: true });
  }
  if (
    order.paymentStatus === "REFUNDED" ||
    order.paymentStatus === "PARTIALLY_REFUNDED"
  ) {
    return NextResponse.json(
      { error: `Order in ${order.paymentStatus} state — cannot capture` },
      { status: 409 },
    );
  }

  const valid = verifyRazorpaySignature({
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: body.razorpayPaymentId,
    razorpaySignature: body.razorpaySignature,
  });

  if (!valid) {
    await db.insert(events).values({
      siteId: order.siteId,
      orderId: id,
      customerId: order.customerId,
      type: "PAYMENT_SIGNATURE_INVALID",
      payload: { razorpayPaymentId: body.razorpayPaymentId },
      source: "system",
    });
    return NextResponse.json(
      { error: "Signature mismatch — payment not verified" },
      { status: 400 },
    );
  }

  const isPartialPrepaidCod =
    order.paymentMethod === "COD" && order.confirmationFeeInr > 0;
  const expectedAmountPaise = isPartialPrepaidCod
    ? order.confirmationFeeInr * 100
    : order.totalInr * 100;
  const confirm = await fetchAndConfirmCapture({
    paymentId: body.razorpayPaymentId,
    expectedRazorpayOrderId: order.razorpayOrderId,
    expectedAmountPaise,
  });
  if (!confirm.ok) {
    await db.insert(events).values({
      siteId: order.siteId,
      orderId: id,
      customerId: order.customerId,
      type: "PAYMENT_CAPTURE_UNCONFIRMED",
      payload: {
        razorpayPaymentId: body.razorpayPaymentId,
        reason: confirm.reason,
      },
      source: "system",
    });
    return NextResponse.json(
      { error: `Payment not yet confirmed: ${confirm.reason}` },
      { status: 402 },
    );
  }

  // If a prior failed attempt in the Razorpay modal triggered the payment.failed
  // webhook and released holds before this retry succeeded, re-acquire the holds.
  if (order.holdsReleased) {
    await reacquireOrderHolds(id);
  }

  await db
    .update(orders)
    .set({
      status: "PAID",
      paymentStatus: "CAPTURED",
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id));

  await db.insert(events).values({
    siteId: order.siteId,
    orderId: id,
    customerId: order.customerId,
    type: "PAYMENT_CAPTURED",
    payload: {
      razorpayPaymentId: body.razorpayPaymentId,
      // Record what Razorpay ACTUALLY captured — confirmation fee for
      // partial-prepaid CoD, full total for prepaid. Lets audit
      // reconciliation tell the two apart from the event log alone.
      amountInr: isPartialPrepaidCod
        ? order.confirmationFeeInr
        : order.totalInr,
      codBalanceInr: isPartialPrepaidCod
        ? order.totalInr - order.confirmationFeeInr
        : 0,
    },
    source: "user",
  });

  // Payment-received confirmation — email + WhatsApp (when enabled). The
  // order row now carries razorpayPaymentId, so the receipt/txn ref renders.
  await notifyOrderEvent(id, "PAYMENT_CAPTURED");

  // Durable, exactly-once shipment creation. Enqueue synchronously (so the job
  // is committed before we respond), then run it in `after()` — which keeps the
  // serverless instance alive past the response, unlike a bare fire-and-forget.
  // The Razorpay webhook enqueues the same job; the PK + atomic claim guarantee
  // only one of them ever creates the shipment.
  await enqueueShipmentJob(id);
  after(() => runShipmentJobOnce(id).catch(() => {}));

  return NextResponse.json({ ok: true, orderId: id });
}
