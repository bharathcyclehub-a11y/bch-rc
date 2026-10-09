"use server";

/**
 * Server actions for the admin order detail page.
 *
 *   saveOrderNote(orderId, notes)
 *     - Operator notes go on the orders.notes column (already on schema).
 *     - Authorises the admin context against the order's site.
 *     - Emits an `ADMIN_NOTE_SAVED` event so the change shows in the timeline.
 *
 *   refundOrderFully(orderId)
 *     - OWNER/FINANCE only. Opens a refund case for the remaining captured
 *       amount and executes it (src/lib/support/refunds.ts); the order turns
 *       REFUNDED only when Razorpay confirms.
 *     - Refuses if the order isn't refundable (no payment id, already
 *       refunded, or COD without a captured payment).
 *
 * Both actions revalidatePath the order detail route so the page renders
 * fresh state after the action returns.
 */

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, refundCases } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { approveRefund, onlineRefundable, requestRefund } from "@/lib/support/refunds";
import { logError } from "@/lib/logger";
import { releaseOrderHolds } from "@/lib/inventory/release";
import { confirmCodOrderCore, rejectCodOrderCore } from "@/lib/cod-verify";

const MAX_NOTE_LENGTH = 2000;

/**
 * Statuses an order can still be cancelled FROM — everything before physical
 * dispatch. Terminal / post-dispatch states (SHIPPED, DELIVERED, CANCELLED,
 * RETURNED, REFUNDED, FAILED, ABANDONED) are blocked: releasing inventory holds
 * for a parcel that already left would over-count stock, and refunds are a
 * separate action.
 */
const CANCELLABLE_STATUSES = [
  "PENDING",
  "PENDING_COD_VERIFICATION",
  "PAID",
  "PACKED",
] as const;

/** Forward-only fulfilment ranking — a status may only advance to a higher rank. */
const FULFILLMENT_RANK: Record<string, number> = {
  PAID: 1,
  PACKED: 2,
  SHIPPED: 3,
  DELIVERED: 4,
};

const FULFILLMENT_TARGETS = {
  PACKED: "packedAt",
  SHIPPED: "shippedAt",
  DELIVERED: "deliveredAt",
} as const;

export type FulfillmentTarget = keyof typeof FULFILLMENT_TARGETS;

const MAX_AWB_LENGTH = 60;
const MAX_COURIER_LENGTH = 80;
const MAX_TRACKING_URL_LENGTH = 500;

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function saveOrderNote(
  orderId: string,
  notes: string,
): Promise<ActionResult> {
  const ctx = await requireAdmin();

  const trimmed = (notes ?? "").slice(0, MAX_NOTE_LENGTH);

  const [order] = await db
    .select({ siteId: orders.siteId, notes: orders.notes })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, error: "Order not found." };
  if (!ctx.siteIds.includes(order.siteId)) {
    return { ok: false, error: "You don't have access to this order's site." };
  }
  if ((order.notes ?? "") === trimmed) {
    return { ok: true, message: "No changes to save." };
  }

  await db
    .update(orders)
    .set({ notes: trimmed, updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  await db.insert(events).values({
    siteId: order.siteId,
    orderId,
    type: "ADMIN_NOTE_SAVED",
    source: "admin",
    payload: {
      adminEmail: ctx.email,
      previewBefore: (order.notes ?? "").slice(0, 200),
      previewAfter: trimmed.slice(0, 200),
    },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Note saved." };
}

/**
 * Full online refund — now a refund case (src/lib/support/refunds.ts) so it
 * gets the same guarantees as support refunds: only OWNER/FINANCE may run it,
 * the refundable amount is what Razorpay actually captured (the COD
 * confirmation fee, not the order total, for part-prepaid COD), a double
 * click can't refund twice, and the order is marked REFUNDED only when
 * Razorpay confirms (webhook refund.processed or API read-back).
 */
export async function refundOrderFully(orderId: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "refunds.approve")) {
    return { ok: false, error: "Only an owner or finance approver can issue refunds. Raise a refund request from the support ticket instead." };
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, error: "Order not found." };
  if (!ctx.siteIds.includes(order.siteId)) {
    return { ok: false, error: "You don't have access to this order's site." };
  }
  if (!order.razorpayPaymentId) {
    return {
      ok: false,
      error:
        order.paymentMethod === "COD"
          ? "COD orders can't be refunded online — cancel instead and refund cash on return."
          : "No captured Razorpay payment on this order yet.",
    };
  }
  if (order.status === "REFUNDED" || order.paymentStatus === "REFUNDED") {
    return { ok: false, error: "Already refunded." };
  }

  try {
    const pending = await db
      .select({ amount: refundCases.amountInr })
      .from(refundCases)
      .where(and(eq(refundCases.orderId, orderId), eq(refundCases.method, "RAZORPAY"), inArray(refundCases.status, ["REQUESTED", "APPROVED", "PROCESSING", "PROCESSED"])));
    const remaining = onlineRefundable(order) - pending.reduce((s, r) => s + r.amount, 0);
    if (remaining <= 0) return { ok: false, error: "A refund for the full captured amount already exists for this order." };
    const c = await requestRefund({
      orderId,
      amountInr: remaining,
      reason: "Full refund from the order page",
      method: "RAZORPAY",
      requestedBy: ctx.email,
      idempotencyKey: `admin-full:${orderId}:${Math.floor(Date.now() / 60_000)}`,
    });
    const done = await approveRefund(c, ctx.email);
    revalidatePath(`/admin/orders/${orderId}`);
    return {
      ok: true,
      message:
        done.status === "PROCESSED"
          ? `Refund of ₹${done.amountInr.toLocaleString("en-IN")} confirmed by Razorpay.`
          : `Refund of ₹${done.amountInr.toLocaleString("en-IN")} initiated. The order is marked refunded once Razorpay confirms.`,
    };
  } catch (err) {
    logError("admin:refund:razorpay", err, { orderId, paymentId: order.razorpayPaymentId });
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * cancelOrder(orderId)
 *   - Blocks unless the order is still pre-dispatch (see CANCELLABLE_STATUSES).
 *   - Atomic status → CANCELLED + cancelledAt (conditional UPDATE = the claim,
 *     so a concurrent COD-verify / ship can't race a cancel through).
 *   - Releases inventory + coupon holds via releaseOrderHolds (idempotent).
 *   - Emits ORDER_CANCELLED. Does NOT refund money — refund is separate.
 */
export async function cancelOrder(orderId: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!orderId) return { ok: false, error: "Missing order id." };

  const [order] = await db
    .select({ siteId: orders.siteId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, error: "Order not found." };
  if (!ctx.siteIds.includes(order.siteId)) {
    return { ok: false, error: "You don't have access to this order's site." };
  }
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(order.status)) {
    return {
      ok: false,
      error:
        order.status === "CANCELLED"
          ? "Order is already cancelled."
          : order.status === "REFUNDED"
            ? "Order was refunded — it can't be cancelled."
            : order.status === "DELIVERED"
              ? "Order is already delivered — it can't be cancelled."
              : `Can't cancel a ${order.status} order.`,
    };
  }

  const claimed = await db
    .update(orders)
    .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, orderId),
        inArray(orders.status, [...CANCELLABLE_STATUSES]),
      ),
    )
    .returning({ id: orders.id });

  if (claimed.length === 0) {
    return {
      ok: false,
      error: "Order status changed — refresh the page and try again.",
    };
  }

  try {
    await releaseOrderHolds(orderId, "CANCELLED");
  } catch (err) {
    // Stock restore failed — the cancel still stands; log for manual fix.
    logError("admin:cancel:release", err, { orderId });
  }

  await db.insert(events).values({
    siteId: order.siteId,
    orderId,
    type: "ORDER_CANCELLED",
    source: "admin",
    payload: { adminEmail: ctx.email, previousStatus: order.status },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Order cancelled and holds released." };
}

/**
 * updateFulfillment(orderId, target)
 *   - target ∈ { PACKED, SHIPPED, DELIVERED }.
 *   - Forward-only: current fulfilment rank must be BELOW the target's.
 *   - Sets the matching timestamp column (packedAt / shippedAt / deliveredAt)
 *     + status, emits FULFILLMENT_ADVANCED. Conditional UPDATE guards races.
 */
export async function updateFulfillment(
  orderId: string,
  target: FulfillmentTarget,
): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!orderId) return { ok: false, error: "Missing order id." };
  if (!(target in FULFILLMENT_TARGETS)) {
    return { ok: false, error: "Invalid fulfilment target." };
  }

  const [order] = await db
    .select({ siteId: orders.siteId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, error: "Order not found." };
  if (!ctx.siteIds.includes(order.siteId)) {
    return { ok: false, error: "You don't have access to this order's site." };
  }

  const currentRank = FULFILLMENT_RANK[order.status] ?? 0;
  const targetRank = FULFILLMENT_RANK[target];
  if (currentRank === 0) {
    return {
      ok: false,
      error:
        order.status === "PENDING_COD_VERIFICATION"
          ? "Confirm the COD order first — it isn't paid yet."
          : `Order must be paid before fulfilment (currently ${order.status}).`,
    };
  }
  if (currentRank >= targetRank) {
    return {
      ok: false,
      error: `Order is already ${order.status} — can't move it back to ${target}.`,
    };
  }

  const now = new Date();
  const base = { status: target, updatedAt: now };
  const patch =
    target === "PACKED"
      ? { ...base, packedAt: now }
      : target === "SHIPPED"
        ? { ...base, shippedAt: now }
        : { ...base, deliveredAt: now };
  const claimed = await db
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
    .returning({ id: orders.id });

  if (claimed.length === 0) {
    return {
      ok: false,
      error: "Order status changed — refresh the page and try again.",
    };
  }

  await db.insert(events).values({
    siteId: order.siteId,
    orderId,
    type: "FULFILLMENT_ADVANCED",
    source: "admin",
    payload: { adminEmail: ctx.email, from: order.status, to: target },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: `Marked ${target.toLowerCase()}.` };
}

/**
 * saveTracking(orderId, awbCode, courierName, trackingUrl)
 *   - Manual set/override of the AWB + courier + tracking URL (for orders not
 *     shipped through the Shiprocket "Create shipment" flow, or to correct it).
 *   - Emits TRACKING_UPDATED. Blank fields clear the corresponding column.
 */
export async function saveTracking(
  orderId: string,
  awbCode: string,
  courierName: string,
  trackingUrl: string,
): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!orderId) return { ok: false, error: "Missing order id." };

  const awb = (awbCode ?? "").trim().slice(0, MAX_AWB_LENGTH);
  const courier = (courierName ?? "").trim().slice(0, MAX_COURIER_LENGTH);
  const url = (trackingUrl ?? "").trim().slice(0, MAX_TRACKING_URL_LENGTH);

  if (!awb && !courier && !url) {
    return { ok: false, error: "Enter an AWB number, courier, or tracking URL." };
  }
  if (url && !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "Tracking URL must start with http:// or https://" };
  }

  const [order] = await db
    .select({
      siteId: orders.siteId,
      awbCode: orders.awbCode,
      courierName: orders.courierName,
      trackingUrl: orders.trackingUrl,
    })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, error: "Order not found." };
  if (!ctx.siteIds.includes(order.siteId)) {
    return { ok: false, error: "You don't have access to this order's site." };
  }

  const nextAwb = awb || null;
  const nextCourier = courier || null;
  const nextUrl = url || null;

  if (
    (order.awbCode ?? null) === nextAwb &&
    (order.courierName ?? null) === nextCourier &&
    (order.trackingUrl ?? null) === nextUrl
  ) {
    return { ok: true, message: "No changes to save." };
  }

  await db
    .update(orders)
    .set({
      awbCode: nextAwb,
      courierName: nextCourier,
      trackingUrl: nextUrl,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  await db.insert(events).values({
    siteId: order.siteId,
    orderId,
    type: "TRACKING_UPDATED",
    source: "admin",
    payload: {
      adminEmail: ctx.email,
      awbCode: nextAwb,
      courierName: nextCourier,
      trackingUrl: nextUrl,
    },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Tracking saved." };
}

/**
 * COD verify from the admin surface — reuses the shared /cod core (money +
 * shipment + notifications) after an admin/site-access check, so no COD-console
 * cookie is required. Keeps the /cod list in sync via a second revalidate.
 */
export async function adminConfirmCod(orderId: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!orderId) return { ok: false, error: "Missing order id." };

  const [order] = await db
    .select({ siteId: orders.siteId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, error: "Order not found." };
  if (!ctx.siteIds.includes(order.siteId)) {
    return { ok: false, error: "You don't have access to this order's site." };
  }
  if (order.status !== "PENDING_COD_VERIFICATION") {
    return { ok: false, error: "This order isn't awaiting COD verification." };
  }

  const res = await confirmCodOrderCore(orderId, {
    source: "admin",
    email: ctx.email,
  });
  if (!res.ok) return res;

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/cod");
  return { ok: true, message: res.message };
}

export async function adminRejectCod(
  orderId: string,
  reason?: string,
): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!orderId) return { ok: false, error: "Missing order id." };

  const [order] = await db
    .select({ siteId: orders.siteId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, error: "Order not found." };
  if (!ctx.siteIds.includes(order.siteId)) {
    return { ok: false, error: "You don't have access to this order's site." };
  }
  if (order.status !== "PENDING_COD_VERIFICATION") {
    return { ok: false, error: "This order isn't awaiting COD verification." };
  }

  const res = await rejectCodOrderCore(orderId, reason ?? "admin-reject", {
    source: "admin",
    email: ctx.email,
  });
  if (!res.ok) return res;

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/cod");
  return { ok: true, message: res.message };
}
