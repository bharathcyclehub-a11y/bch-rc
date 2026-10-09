/**
 * Public tracking view — what /support/track (and /track) show for an order.
 *
 * Privacy: knowing an order id is enough to see DELIVERY STATUS only — no
 * name, address, phone, items or amounts. Those need a verified session
 * (src/lib/support/verify.ts).
 *
 * The four tracking facts are returned separately and are never derived from
 * each other: last courier event (+ its own time), last successful check,
 * current estimate (+ source / expired), delay or exception.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, shipmentTracking, shipmentTrackingEvents, type ShipmentTrackingRow } from "@/db/schema";
import { logWarn } from "@/lib/logger";
import { resolveServiceability } from "@/lib/serviceability";
import { assessTracking, type Assessment } from "./assess";
import { DEFAULT_TRACKING_CONFIG } from "./config";
import { factsFromRow, storeEstimateFor } from "./exceptions";
import { CUSTOMER_STATUS_LABEL, isTrackingStatus, type TrackingStatus } from "./status";
import { formatIstDate, formatIstDateTime, istEndOfDay } from "./time";
import { loadTrackingConfig } from "./sync";

export type Tone = "positive" | "info" | "attention" | "negative" | "neutral";

export type JourneyStep = {
  key: "confirmed" | "packed" | "shipped" | "transit" | "delivered";
  label: string;
  state: "done" | "current" | "upcoming" | "problem";
  at: string | null;
};

export type PublicTrackingView = {
  orderId: string;
  headline: { label: string; tone: Tone };
  orderState: "PAYMENT_PENDING" | "AWAITING_CONFIRMATION" | "ACTIVE" | "DELIVERED" | "CLOSED";
  closedReason: string | null;
  payment: string;
  placedAt: string;
  journey: JourneyStep[];
  courier: { name: string | null; awb: string | null; trackingUrl: string | null } | null;
  facts: {
    currentStatus: string;
    lastCourierUpdateAt: string | null;
    lastCourierUpdateText: string | null;
    lastCheckedAt: string | null;
    estimate: {
      state: Assessment["estimate"]["state"];
      date: string | null;
      dateText: string | null;
      expiredDate: string | null;
      expiredDateText: string | null;
      source: "COURIER" | "STORE_ESTIMATE" | null;
      arrivingToday: boolean;
    };
  };
  delay: { headline: string; details: string[] } | null;
  sync: { healthy: boolean; failingSince: string | null; pending: boolean };
  events: Array<{ at: string; atText: string; label: string; activity: string | null; location: string | null }>;
};

type OrderRow = typeof orders.$inferSelect;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function paymentLabel(o: OrderRow): string {
  if (o.paymentMethod === "COD") {
    return o.confirmationFeeInr > 0 ? "Part paid online · balance on delivery" : "Cash on delivery";
  }
  if (o.paymentStatus === "CAPTURED") return "Paid online";
  if (o.paymentStatus === "REFUNDED" || o.paymentStatus === "PARTIALLY_REFUNDED") return "Refunded";
  return "Payment pending";
}

/** Stage reached on the 5-step journey (0 confirmed … 4 delivered). */
function stageOf(status: TrackingStatus | null, orderStatus: string): number {
  if (status) {
    switch (status) {
      case "AWAITING_AWB":
        return 0;
      case "AWAITING_PICKUP":
        return 1;
      case "PICKED_UP":
        return 2;
      case "DELIVERED":
        return 4;
      case "UNKNOWN":
        break;
      default:
        return 3;
    }
  }
  return { PAID: 0, PACKED: 1, SHIPPED: 2, DELIVERED: 4 }[orderStatus] ?? 0;
}

function journeyFor(o: OrderRow, row: ShipmentTrackingRow | null, a: Assessment | null, firstTransitAt: Date | null): JourneyStep[] {
  const status = row && a && a.status !== "UNKNOWN" ? a.status : null;
  const stage = stageOf(status, o.status);
  const problem = status === "EXCEPTION" || status === "DELIVERY_ATTEMPTED" || !!a?.delay;
  const transitLabel =
    status === "OUT_FOR_DELIVERY" || status === "DELIVERY_ATTEMPTED" || status === "DELAYED" || status === "EXCEPTION"
      ? CUSTOMER_STATUS_LABEL[status]
      : "In transit";
  const steps: Array<Omit<JourneyStep, "state">> = [
    { key: "confirmed", label: o.paymentMethod === "COD" ? "Order confirmed" : "Payment confirmed", at: iso(o.paidAt ?? o.placedAt) },
    { key: "packed", label: status === "AWAITING_PICKUP" ? "Ready for pickup" : "Packed", at: iso(o.packedAt) },
    { key: "shipped", label: "Shipped", at: iso(row?.pickedUpAt ?? o.shippedAt) },
    { key: "transit", label: transitLabel, at: iso(firstTransitAt) },
    { key: "delivered", label: "Delivered", at: iso(row?.deliveredAt ?? o.deliveredAt) },
  ];
  return steps.map((s, i) => ({
    ...s,
    at: i <= stage ? s.at : null,
    state: i < stage || stage === 4 ? "done" : i === stage ? (problem && i >= 2 ? "problem" : "current") : "upcoming",
  }));
}

function closedReason(status: string): string | null {
  switch (status) {
    case "CANCELLED":
      return "This order was cancelled.";
    case "FAILED":
      return "Payment for this order did not go through.";
    case "ABANDONED":
      return "This order was not completed.";
    case "REFUNDED":
      return "This order was refunded.";
    case "RETURNED":
      return "This parcel was returned to us.";
    default:
      return null;
  }
}

async function loadTracking(orderId: string): Promise<{ row: ShipmentTrackingRow | null; events: Array<typeof shipmentTrackingEvents.$inferSelect> }> {
  try {
    const [row] = await db
      .select()
      .from(shipmentTracking)
      .where(and(eq(shipmentTracking.orderId, orderId), eq(shipmentTracking.kind, "FORWARD")));
    if (!row) return { row: null, events: [] };
    const evs = await db
      .select()
      .from(shipmentTrackingEvents)
      .where(eq(shipmentTrackingEvents.trackingId, row.id))
      .orderBy(desc(shipmentTrackingEvents.eventAt), desc(shipmentTrackingEvents.receivedAt))
      .limit(60);
    return { row, events: evs };
  } catch (err) {
    // Tables not migrated yet → order-only view.
    logWarn("tracking:view", err instanceof Error ? err.message : String(err), { orderId });
    return { row: null, events: [] };
  }
}

export async function getPublicTrackingView(orderId: string, now: Date = new Date()): Promise<PublicTrackingView | null> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return null;
  const cfg = await loadTrackingConfig().catch(() => DEFAULT_TRACKING_CONFIG);
  const { row, events } = await loadTracking(orderId);

  const a: Assessment | null = row
    ? assessTracking(factsFromRow(row), {
        now,
        config: cfg,
        storeEstimate: storeEstimateFor(o, row.pickedUpAt),
        orderStatus: o.status,
      })
    : null;

  // No tracking row yet (not shipped, or created before tracking existed):
  // the PRC estimate from the order alone, with the same expiry rule.
  let estimate: Assessment["estimate"] = a?.estimate ?? {
    state: "NONE",
    date: null,
    expiredDate: null,
    source: null,
    arrivingToday: false,
  };
  if (!a && ["PAID", "PACKED", "SHIPPED"].includes(o.status)) {
    const d = storeEstimateFor(o, o.shippedAt);
    if (d && now > istEndOfDay(d)) estimate = { state: "EXPIRED", date: null, expiredDate: d, source: "STORE_ESTIMATE", arrivingToday: false };
    else if (d) estimate = { state: "STORE_ESTIMATE", date: d, expiredDate: null, source: "STORE_ESTIMATE", arrivingToday: false };
    else estimate = { ...estimate, state: "UNAVAILABLE" };
  }
  if (o.status === "DELIVERED" && !a) {
    estimate = { state: "DELIVERED", date: o.deliveredAt, expiredDate: null, source: null, arrivingToday: false };
  }

  const reason = closedReason(o.status);
  const orderState: PublicTrackingView["orderState"] =
    o.status === "PENDING"
      ? "PAYMENT_PENDING"
      : o.status === "PENDING_COD_VERIFICATION"
        ? "AWAITING_CONFIRMATION"
        : o.status === "DELIVERED"
          ? "DELIVERED"
          : reason
            ? "CLOSED"
            : "ACTIVE";

  // A courier-side cancellation on an order that is still open means ops are
  // re-shipping: the customer sees the order's own progress, not "Cancelled".
  const status: TrackingStatus | null =
    a && a.status !== "UNKNOWN" && !(a.status === "CANCELLED" && ["PAID", "PACKED"].includes(o.status))
      ? a.status
      : null;
  const CLOSED_LABEL: Record<string, string> = {
    CANCELLED: "Cancelled",
    FAILED: "Payment failed",
    ABANDONED: "Not completed",
    REFUNDED: "Refunded",
    RETURNED: "Returned",
  };
  const ORDER_LABEL: Record<string, string> = { PAID: "Processing", PACKED: "Packed", SHIPPED: "Shipped", DELIVERED: "Delivered" };
  const currentStatus =
    orderState === "PAYMENT_PENDING"
      ? "Payment pending"
      : orderState === "AWAITING_CONFIRMATION"
        ? "Awaiting confirmation call"
        : reason
          ? (CLOSED_LABEL[o.status] ?? o.status)
          : status
            ? a!.customerLabel
            : (ORDER_LABEL[o.status] ?? "Processing");

  const delay = orderState === "ACTIVE" ? (a?.delay ?? (estimate.state === "EXPIRED"
    ? { type: "EDD_EXPIRED" as const, headline: "Delivery delayed — updated estimate pending.", details: [] }
    : null)) : null;

  const tone: Tone =
    orderState === "DELIVERED"
      ? "positive"
      : orderState === "CLOSED"
        ? "negative"
        : orderState !== "ACTIVE"
          ? "attention"
          : status === "EXCEPTION" || status === "RTO_IN_TRANSIT"
            ? "negative"
            : delay
              ? "attention"
              : "info";

  const firstTransit = [...events].reverse().find((e) => isTrackingStatus(e.status) && e.status !== "AWAITING_PICKUP" && e.status !== "PICKED_UP" && e.status !== "UNKNOWN");

  // A stale view nudges the worker to poll this shipment on its next pass —
  // no courier call from a customer request.
  if (row && row.active && a && (!a.sync.healthy || !a.lastCheckedAt || now.getTime() - a.lastCheckedAt.getTime() > 2 * 3_600_000) && row.nextSyncAt > now) {
    db.update(shipmentTracking)
      .set({ nextSyncAt: now })
      .where(eq(shipmentTracking.id, row.id))
      .catch(() => {});
  }

  const lastText = row?.lastEventActivity
    ? `${row.lastEventActivity}${row.lastEventLocation ? ` — ${row.lastEventLocation}` : ""}`
    : null;

  return {
    orderId: o.id,
    headline: { label: currentStatus, tone },
    orderState,
    closedReason: reason,
    payment: paymentLabel(o),
    placedAt: o.placedAt.toISOString(),
    journey: journeyFor(o, row, a, firstTransit?.eventAt ?? null),
    courier:
      row?.awbCode || o.awbCode || (o.courierName ?? "").trim()
        ? {
            name: row?.courierName ?? ((o.courierName ?? "").trim() || null),
            awb: row?.awbCode ?? o.awbCode,
            trackingUrl: o.trackingUrl,
          }
        : null,
    facts: {
      currentStatus,
      lastCourierUpdateAt: iso(a?.lastCourierUpdateAt ?? null),
      lastCourierUpdateText: lastText,
      lastCheckedAt: iso(a?.lastCheckedAt ?? null),
      estimate: {
        state: estimate.state,
        date: iso(estimate.date),
        dateText: estimate.date ? formatIstDate(estimate.date) : null,
        expiredDate: iso(estimate.expiredDate),
        expiredDateText: estimate.expiredDate ? formatIstDate(estimate.expiredDate) : null,
        source: estimate.source,
        arrivingToday: estimate.arrivingToday,
      },
    },
    delay: delay ? { headline: delay.headline, details: delay.details } : null,
    sync: {
      healthy: a ? a.sync.healthy : true,
      failingSince: iso(a?.sync.failingSince ?? null),
      pending: !!row && !row.baselineAt,
    },
    events: events.map((e) => ({
      at: e.eventAt.toISOString(),
      atText: formatIstDateTime(e.eventAt),
      label: isTrackingStatus(e.status) && e.status !== "UNKNOWN" ? CUSTOMER_STATUS_LABEL[e.status] : (e.carrierStatusLabel ?? "Update"),
      activity: e.activity,
      location: e.location,
    })),
  };
}

/**
 * One-line delivery estimate for an order, consistent with /track — used by
 * the order page, the order API and emails so no surface promises a date the
 * tracking page has already called expired.
 */
export async function deliveryEstimateText(order: OrderRow, now: Date = new Date()): Promise<string | null> {
  if (!["PAID", "PACKED", "SHIPPED", "PENDING_COD_VERIFICATION"].includes(order.status)) return null;
  let row: ShipmentTrackingRow | null = null;
  try {
    [row] = await db
      .select()
      .from(shipmentTracking)
      .where(and(eq(shipmentTracking.orderId, order.id), eq(shipmentTracking.kind, "FORWARD")));
  } catch {
    row = null;
  }
  if (row?.eddSource === "COURIER" && row.eddAt) {
    return now > istEndOfDay(row.eddAt)
      ? "delayed — updated estimate pending"
      : `${formatIstDate(row.eddAt)} (courier estimate)`;
  }
  const pincode = (order.shippingAddress as { pincode?: string } | null)?.pincode;
  if (!pincode) return null;
  const anchor = row?.pickedUpAt ?? order.shippedAt ?? order.paidAt ?? order.placedAt;
  const s = resolveServiceability(pincode, anchor);
  if (!s.serviceable) return null;
  const end = storeEstimateFor(order, row?.pickedUpAt ?? order.shippedAt);
  if (end && now > istEndOfDay(end)) return "delayed — updated estimate pending";
  return s.etaText;
}

export { formatIstDateTime };
