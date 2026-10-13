"use server";

/**
 * Server actions for the /pack console.
 *
 * Every action gates on isPackAuthenticated() first — the page wrapper does
 * the same, but server actions are independently callable from any client so
 * the auth check must live here too.
 *
 * Notification UX:
 *   Each action returns either { ok: true, ... } with the URL/result the
 *   client should use, or { ok: false, error } with a string the client can
 *   toast. Throwing from a server action surfaces as a generic crash to the
 *   user — keep failures inside the return type instead.
 */

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, events, shipmentJobs, shipmentTracking } from "@/db/schema";
import { isPackAuthenticated } from "@/lib/pack-auth";
import { generateManifest, schedulePickup, generateInvoice } from "@/lib/shiprocket";
import { asCourierProvider, getCourierAdapter, shipmentRefOf } from "@/lib/couriers";
import { releaseOrderHoldsBestEffort } from "@/lib/inventory/release";
import { logError } from "@/lib/logger";

/** Staff-facing name of the platform an order is booked on. */
function providerName(courierProvider: string): string {
  return asCourierProvider(courierProvider) === "delhivery" ? "Delhivery" : "Shiprocket";
}

/**
 * Touch every server route that displays this order's state. A single
 * /pack revalidate would have left /admin/orders and the customer-facing
 * /orders/[id] page showing the order as live even after cancellation.
 */
function revalidateOrderEverywhere(orderId: string): void {
  revalidatePath("/pack");
  revalidatePath("/cod");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/track");
}

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

type GateFailure = { ok: false; error: string };

async function gate(): Promise<GateFailure | null> {
  const ok = await isPackAuthenticated();
  return ok ? null : { ok: false, error: "Not signed in." };
}

// ============================================================
// Print shipping label PDF for a single order
// ============================================================
export async function printLabelAction(
  orderId: string,
): Promise<ActionResult<{ labelUrl: string }>> {
  const denied = await gate();
  if (denied) return denied;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };
  const ref = shipmentRefOf(order);
  const provider = asCourierProvider(order.courierProvider);
  // Shiprocket labels by its shipment id; Delhivery by the waybill.
  if (provider === "delhivery" ? !ref.awb : !ref.shipmentId) {
    return {
      ok: false,
      error: "AWB not yet assigned. Wait ~30 sec and retry.",
    };
  }

  try {
    const { url: labelUrl } = await getCourierAdapter(provider).label(ref);
    if (!labelUrl) {
      return {
        ok: false,
        error: `${providerName(order.courierProvider)} didn't return a label URL. Try again in a moment.`,
      };
    }
    return { ok: true, labelUrl };
  } catch (err) {
    logError("pack:print-label", err, { orderId });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Label generation failed.",
    };
  }
}

// ============================================================
// Print today's manifest — all PACKED orders with AWB
// ============================================================
export async function printManifestAction(): Promise<
  ActionResult<{ manifestUrl: string; count: number }>
> {
  const denied = await gate();
  if (denied) return denied;

  // Collect every order PACKED with an AWB that isn't yet handed to a
  // courier. We don't track "manifest_printed_at" yet, so the simple rule is
  // every PACKED-with-AWB row. The packing employee prints once at end-of-day
  // before the courier visit. Shiprocket bookings only — Delhivery has no
  // manifest sheet.
  const rows = await db
    .select({ shipmentId: orders.shiprocketShipmentId })
    .from(orders)
    .where(and(eq(orders.status, "PACKED"), eq(orders.courierProvider, "shiprocket")));

  const shipmentIds = rows
    .map((r) => r.shipmentId)
    .filter((id): id is string => !!id);

  if (shipmentIds.length === 0) {
    return { ok: false, error: "No packed orders ready for manifest." };
  }

  try {
    const { manifestUrl } = await generateManifest(shipmentIds);
    if (!manifestUrl) {
      return { ok: false, error: "Shiprocket didn't return a manifest URL." };
    }
    return { ok: true, manifestUrl, count: shipmentIds.length };
  } catch (err) {
    logError("pack:print-manifest", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Manifest failed.",
    };
  }
}

// ============================================================
// Print manifest for ONE order (per-order button in the card)
//
// Generates the Shiprocket manifest for this order's shipment and records
// manifested_at + manifest_url so the order moves from "Ready to Ship" into
// "Pickups & Manifests" (mirrors Shiprocket — no more showing in both tabs).
// ============================================================
export async function printManifestForOrderAction(
  orderId: string,
): Promise<ActionResult<{ manifestUrl: string | null; note?: string }>> {
  const denied = await gate();
  if (denied) return denied;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };
  const provider = asCourierProvider(order.courierProvider);

  // Delhivery has no manifest sheet to print: a booked shipment is already
  // "Manifested" on Delhivery's side. Say so instead of pretending to print —
  // the order still moves on to "Pickups & Manifests".
  if (provider === "delhivery") {
    if (!order.awbCode) return { ok: false, error: "Waybill not yet assigned." };
    await db
      .update(orders)
      .set({ manifestedAt: new Date(), manifestUrl: null, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    await db.insert(events).values({
      siteId: order.siteId,
      orderId: order.id,
      customerId: order.customerId,
      type: "MANIFEST_GENERATED",
      payload: { manifestUrl: null, provider, by: "pack-console" },
      source: "operator",
    });
    revalidateOrderEverywhere(orderId);
    return {
      ok: true,
      manifestUrl: null,
      note: "Delhivery has no manifest sheet — the shipment was manifested when it was booked. Schedule the pickup next.",
    };
  }

  if (!order.shiprocketShipmentId) {
    return { ok: false, error: "AWB not yet assigned. Generate AWB first." };
  }

  try {
    const { manifestUrl } = await generateManifest([order.shiprocketShipmentId]);
    if (!manifestUrl) {
      return { ok: false, error: "Shiprocket didn't return a manifest URL." };
    }
    await db
      .update(orders)
      .set({ manifestedAt: new Date(), manifestUrl, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    await db.insert(events).values({
      siteId: order.siteId,
      orderId: order.id,
      customerId: order.customerId,
      type: "MANIFEST_GENERATED",
      payload: { manifestUrl, by: "pack-console" },
      source: "operator",
    });
    revalidateOrderEverywhere(orderId);
    return { ok: true, manifestUrl };
  } catch (err) {
    logError("pack:manifest-order", err, { orderId });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Manifest failed.",
    };
  }
}

// ============================================================
// Schedule courier pickup for ONE order (per-order button)
// ============================================================
export async function schedulePickupForOrderAction(
  orderId: string,
): Promise<ActionResult<{ scheduledFor: string | null }>> {
  const denied = await gate();
  if (denied) return denied;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };
  const provider = asCourierProvider(order.courierProvider);
  const ref = shipmentRefOf(order);
  if (provider === "delhivery" ? !ref.awb : !ref.shipmentId) {
    return { ok: false, error: "AWB not yet assigned. Generate AWB first." };
  }

  // Shiprocket's "already scheduled" (premium couriers auto-schedule) and
  // Delhivery's "pickup already requested for the day" both come back as
  // ok + alreadyScheduled: the parcel IS covered, just not by a new request.
  const result = await getCourierAdapter(provider).schedulePickup([ref]);
  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  await db
    .update(orders)
    .set({ pickupScheduledAt: new Date(), updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  await db.insert(events).values({
    siteId: order.siteId,
    orderId: order.id,
    customerId: order.customerId,
    type: "PICKUP_SCHEDULED",
    payload: {
      provider,
      scheduledFor: result.scheduledFor,
      pickupId: result.pickupId,
      alreadyScheduled: result.alreadyScheduled,
      by: "pack-console",
    },
    source: "operator",
  });
  revalidateOrderEverywhere(orderId);
  return {
    ok: true,
    scheduledFor: result.scheduledFor ?? "auto-scheduled",
  };
}

// ============================================================
// Print invoice for a single order
// ============================================================
export async function printInvoiceAction(
  orderId: string,
): Promise<ActionResult<{ invoiceUrl: string }>> {
  const denied = await gate();
  if (denied) return denied;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.shiprocketOrderId) {
    return {
      ok: false,
      error: "Order not yet created on Shiprocket.",
    };
  }

  try {
    const { invoiceUrl } = await generateInvoice([order.shiprocketOrderId]);
    if (!invoiceUrl) {
      return { ok: false, error: "Shiprocket didn't return an invoice URL." };
    }
    return { ok: true, invoiceUrl };
  } catch (err) {
    logError("pack:print-invoice", err, { orderId });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invoice generation failed.",
    };
  }
}

// ============================================================
// Manually generate the AWB for an order whose auto-assign didn't fire
//
// AWBs are normally assigned automatically by the shipment-job runner the
// moment an order is paid. This button is the backup for the rare case where
// that job failed/stalled (Shiprocket hiccup, serviceability retry). It runs
// the SAME proven path (runShipmentJobOnce) — no parallel logic — so the
// result is identical to the auto path: Shiprocket order created, AWB
// assigned, order moved PACKED.
// ============================================================
export async function generateAwbAction(
  orderId: string,
): Promise<ActionResult<{ awbCode: string | null }>> {
  const denied = await gate();
  if (denied) return denied;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };
  if (order.awbCode) {
    return { ok: false, error: "AWB already assigned." };
  }
  if (order.status !== "PAID" && order.status !== "PACKED") {
    return {
      ok: false,
      error: `Order is ${order.status} — can't generate AWB from here.`,
    };
  }

  try {
    const { runShipmentJobOnce } = await import(
      "@/lib/fulfillment/shipment-queue"
    );
    const res = await runShipmentJobOnce(orderId);
    if (res.error) return { ok: false, error: res.error };

    // Re-read to surface the freshly-assigned AWB to the UI.
    const [updated] = await db
      .select({ awb: orders.awbCode })
      .from(orders)
      .where(eq(orders.id, orderId));
    revalidateOrderEverywhere(orderId);
    return { ok: true, awbCode: updated?.awb ?? null };
  } catch (err) {
    logError("pack:generate-awb", err, { orderId });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AWB generation failed.",
    };
  }
}

// ============================================================
// Set / update the Zoho GST invoice number for an order
//
// Per Syed (2026-06-19): GST invoice numbers come from Zoho Books, not us.
// The operator pulls the number from Zoho and enters it here; only then can
// the branded invoice be sent to the customer. Order ID stays the reference;
// this is the taxation document number.
// ============================================================
export async function setInvoiceNumberAction(
  orderId: string,
  invoiceNumber: string,
): Promise<ActionResult<{ invoiceNumber: string }>> {
  const denied = await gate();
  if (denied) return denied;

  const trimmed = invoiceNumber.trim();
  if (trimmed.length < 2 || trimmed.length > 64) {
    return { ok: false, error: "Enter a valid Zoho invoice number." };
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };

  await db
    .update(orders)
    .set({ invoiceNumber: trimmed, updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  await db.insert(events).values({
    siteId: order.siteId,
    orderId: order.id,
    customerId: order.customerId,
    type: "INVOICE_NUMBER_SET",
    payload: { invoiceNumber: trimmed, setBy: "pack-console" },
    source: "operator",
  });

  revalidateOrderEverywhere(orderId);
  return { ok: true, invoiceNumber: trimmed };
}

// ============================================================
// Schedule courier pickup for all packed orders
// ============================================================
export async function schedulePickupAction(): Promise<
  ActionResult<{ scheduledFor: string | null; count: number }>
> {
  const denied = await gate();
  if (denied) return denied;

  // Shiprocket bookings only; a Delhivery pickup is requested per order card.
  const rows = await db
    .select({ shipmentId: orders.shiprocketShipmentId })
    .from(orders)
    .where(and(eq(orders.status, "PACKED"), eq(orders.courierProvider, "shiprocket")));

  const shipmentIds = rows
    .map((r) => r.shipmentId)
    .filter((id): id is string => !!id);

  if (shipmentIds.length === 0) {
    return { ok: false, error: "No packed orders to schedule." };
  }

  const result = await schedulePickup(shipmentIds);
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  return {
    ok: true,
    scheduledFor: result.pickupScheduledDate,
    count: shipmentIds.length,
  };
}

// ============================================================
// Mark an order as dispatched (PACKED → SHIPPED)
//
// Confirms the employee has physically handed the parcel to the courier.
// This is BEFORE Shiprocket's tracking webhook fires SHIPPED (which depends
// on the courier's scan). Acts as the human confirmation.
// ============================================================
export async function markDispatchedAction(
  orderId: string,
): Promise<ActionResult<{ status: "SHIPPED" }>> {
  const denied = await gate();
  if (denied) return denied;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };

  // Only PACKED orders can be marked SHIPPED from here. PAID-without-AWB
  // would skip a state; CANCELLED/DELIVERED/RETURNED are terminal.
  if (order.status !== "PACKED") {
    return {
      ok: false,
      error: `Order is in ${order.status}, cannot mark as dispatched.`,
    };
  }
  if (!order.awbCode) {
    return {
      ok: false,
      error: "AWB not yet assigned — cannot dispatch yet.",
    };
  }

  const now = new Date();
  await db
    .update(orders)
    .set({ status: "SHIPPED", shippedAt: now, updatedAt: now })
    .where(eq(orders.id, orderId));

  await db.insert(events).values({
    siteId: order.siteId,
    orderId: order.id,
    customerId: order.customerId,
    type: "DISPATCH_CONFIRMED",
    payload: {
      awbCode: order.awbCode,
      courierName: order.courierName,
      confirmedBy: "pack-console",
    },
    source: "operator",
  });

  revalidateOrderEverywhere(orderId);
  return { ok: true, status: "SHIPPED" };
}

// ============================================================
// Cancel an order from /pack (test / smoke / wrong-address cleanup)
//
// Moves the order to CANCELLED and cancels the corresponding Shiprocket
// order so we aren't billed for an AWB we won't ship. Refund of any
// captured prepaid payment is NOT triggered here — that stays an admin
// action so the packer can't accidentally trigger a refund.
// ============================================================
export async function cancelOrderFromPackAction(
  orderId: string,
  reason: string,
): Promise<ActionResult<{ status: "CANCELLED" }>> {
  const denied = await gate();
  if (denied) return denied;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "Order not found." };
  if (
    order.status === "SHIPPED" ||
    order.status === "DELIVERED" ||
    order.status === "RETURNED"
  ) {
    return {
      ok: false,
      error: `Order is ${order.status} - too late to cancel from here. Use /admin.`,
    };
  }
  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    return { ok: false, error: `Order is already ${order.status}.` };
  }

  // Best-effort cancel on the courier platform so we don't pay for an AWB we
  // won't use. Errors are logged but do not block the local DB cancel - admin
  // can clean up on the platform separately if needed. Staff asked for this
  // cancel; nothing cancels a booking automatically.
  const provider = asCourierProvider(order.courierProvider);
  const ref = shipmentRefOf(order);
  if (provider === "delhivery" ? ref.awb : order.shiprocketOrderId) {
    try {
      const r = await getCourierAdapter(provider).cancel({
        ...ref,
        providerOrderId: order.shiprocketOrderId,
      });
      if (!r.ok) logError("pack:cancel-courier", new Error(r.message), { orderId, provider });
      // Delhivery keeps a shipment cancelled before pickup at "Manifested" —
      // its tracking never says "cancelled" — so close our tracking row here
      // or the worker would keep polling it and flag a pickup delay.
      if (r.ok && provider === "delhivery") {
        const now = new Date();
        await db
          .update(shipmentTracking)
          .set({ status: "CANCELLED", statusLabel: "Cancelled by us", statusChangedAt: now, terminalAt: now, active: false, updatedAt: now })
          .where(and(eq(shipmentTracking.orderId, orderId), eq(shipmentTracking.kind, "FORWARD")));
      }
    } catch (err) {
      logError("pack:cancel-courier", err, { orderId, provider });
    }
  }

  // Park any pending shipment job for this order so the queue worker stops
  // retrying. Without this, a still-PENDING job keeps calling the Shiprocket
  // create-order API every retry-backoff window and failing with
  // NotShippableError until max_attempts. The order is gone — the job is too.
  await db
    .update(shipmentJobs)
    .set({
      status: "FAILED",
      lastError: `Order cancelled from pack: ${reason.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shipmentJobs.orderId, orderId),
        inArray(shipmentJobs.status, ["PENDING", "PROCESSING"]),
      ),
    );

  const now = new Date();
  await db
    .update(orders)
    .set({ status: "CANCELLED", cancelledAt: now, updatedAt: now })
    .where(eq(orders.id, orderId));

  await db.insert(events).values({
    siteId: order.siteId,
    orderId: order.id,
    customerId: order.customerId,
    type: "CANCELLED_FROM_PACK",
    payload: { reason: reason.slice(0, 200), cancelledBy: "pack-console" },
    source: "operator",
  });

  // Return the reserved stock + any redeemed coupon back to the pool. This
  // is the same exactly-once release the COD reject path and the failed-
  // payment webhook use — without it, the SKU shows the same depleted
  // stock on the storefront even though the test order is dead.
  await releaseOrderHoldsBestEffort(orderId, "CANCELLED");

  revalidateOrderEverywhere(orderId);
  return { ok: true, status: "CANCELLED" };
}

// ============================================================
// Bulk mark dispatched — used when the courier picks up a whole batch
// ============================================================
export async function markBulkDispatchedAction(
  orderIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const denied = await gate();
  if (denied) return denied;
  if (orderIds.length === 0)
    return { ok: false, error: "No orders selected." };

  const eligible = await db
    .select({ id: orders.id, awb: orders.awbCode })
    .from(orders)
    .where(
      and(eq(orders.status, "PACKED"), inArray(orders.id, orderIds)),
    );

  const dispatchable = eligible
    .filter((r) => !!r.awb)
    .map((r) => r.id);

  if (dispatchable.length === 0) {
    return { ok: false, error: "Selected orders aren't ready to dispatch." };
  }

  const now = new Date();
  await db
    .update(orders)
    .set({ status: "SHIPPED", shippedAt: now, updatedAt: now })
    .where(inArray(orders.id, dispatchable));

  revalidatePath("/pack");
  revalidatePath("/admin/orders");
  return { ok: true, count: dispatchable.length };
}
