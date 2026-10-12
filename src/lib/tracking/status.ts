/**
 * Internal shipment-tracking status model.
 *
 * Couriers (through Shiprocket) describe a parcel with free-text labels that
 * vary by courier and API version: "IN TRANSIT", "In Transit - Shipment picked
 * up", "UNDELIVERED", "RTO Delivered"… Every label is normalised here into ONE
 * TrackingStatus, and the customer-facing wording is derived from that — never
 * from the raw label. Raw labels are kept on the immutable event rows.
 *
 * ORDER IS LOAD-BEARING (same lesson as mapShiprocketStatus in shiprocket.ts):
 * several failure labels contain a success word as a substring —
 * "RTO Delivered", "Undelivered", "Partial Delivered", "Out for Delivery". The
 * return/failure checks run before the plain DELIVERED check.
 *
 * Mapping table (documented for ops):
 *   RTO* / RETURN* / REACHED BACK AT SELLER    → RTO_IN_TRANSIT, or RTO_DELIVERED
 *                                                when delivered/acknowledged
 *   CANCEL*                                    → CANCELLED
 *   LOST, DAMAGE*, DESTROYED, UNTRACEABLE,
 *   MISROUTED, DISPOSED, PARTIAL DELIVERED,
 *   SHIPMENT HELD, CONTRABAND                  → EXCEPTION
 *   UNDELIVERED, NDR, DELIVERY ATTEMPT*,
 *   FAILED DELIVERY, ISSUE RELATED TO RECIPIENT,
 *   CONSIGNEE NOT AVAILABLE/REFUSED            → DELIVERY_ATTEMPTED
 *   OUT FOR DELIVERY                           → OUT_FOR_DELIVERY
 *   DELIVERED                                  → DELIVERED
 *   DELAYED                                    → DELAYED
 *   OUT FOR PICKUP, PICKUP SCHEDULED/GENERATED/
 *   BOOKED/RESCHEDULED/EXCEPTION/ERROR, READY TO
 *   SHIP, AWB ASSIGNED, MANIFEST*, NEW, PACKED,
 *   SHIPMENT BOOKED                            → AWAITING_PICKUP
 *   PICKED UP, SHIPPED, HANDOVER TO COURIER    → PICKED_UP
 *   IN TRANSIT, REACHED/ARRIVED AT…, DISPATCHED,
 *   EN-ROUTE, CONNECTED, BAGGED, IN FLIGHT     → IN_TRANSIT
 *   anything else                              → UNKNOWN (stored, never shown
 *                                                as a status on its own)
 */

export const TRACKING_STATUSES = [
  "AWAITING_AWB",
  "AWAITING_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERY_ATTEMPTED",
  "DELAYED",
  "EXCEPTION",
  "RTO_IN_TRANSIT",
  "RTO_DELIVERED",
  "DELIVERED",
  "CANCELLED",
  "UNKNOWN",
] as const;

export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export type ShipmentKind = "FORWARD" | "RETURN" | "REPLACEMENT";

export function isTrackingStatus(s: string): s is TrackingStatus {
  return (TRACKING_STATUSES as readonly string[]).includes(s);
}

/** Final states: nothing more will happen to the parcel. */
export const TERMINAL_STATUSES: ReadonlySet<TrackingStatus> = new Set([
  "DELIVERED",
  "RTO_DELIVERED",
  "CANCELLED",
]);

/** The parcel is with the courier and should be moving. */
export const MOVING_STATUSES: ReadonlySet<TrackingStatus> = new Set([
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERY_ATTEMPTED",
  "DELAYED",
  "RTO_IN_TRANSIT",
]);

const has = (s: string, ...needles: string[]) => needles.some((n) => s.includes(n));

/**
 * Normalise one courier label. `kind` matters for RETURN shipments (reverse
 * pickups we book for customer returns): there, "RETURN" in a label is the
 * normal journey and "DELIVERED" means it reached our warehouse, so the RTO
 * rule is skipped.
 */
export function normalizeCarrierStatus(
  label: string | null | undefined,
  kind: ShipmentKind = "FORWARD",
): TrackingStatus {
  const s = (label ?? "").toUpperCase().replace(/[_\s]+/g, " ").trim();
  if (!s || s === "NA" || s === "N/A" || s === "UNKNOWN") return "UNKNOWN";

  if (kind !== "RETURN" && (has(s, "RTO") || has(s, "RETURN") || has(s, "REACHED BACK AT SELLER"))) {
    return has(s, "DELIVERED", "ACKNOWLEDGED", "REACHED BACK AT SELLER", "RECEIVED AT ORIGIN")
      ? "RTO_DELIVERED"
      : "RTO_IN_TRANSIT";
  }
  if (has(s, "CANCEL")) return "CANCELLED";
  if (
    has(s, "LOST", "DAMAGE", "DESTROYED", "UNTRACEABLE", "MISROUTE", "DISPOSED", "CONTRABAND", "SHIPMENT HELD") ||
    has(s, "PARTIAL DELIVERED", "PARTIALLY DELIVERED")
  ) {
    return "EXCEPTION";
  }
  if (
    has(s, "UNDELIVERED", "UNDELIVERD", "NOT DELIVERED", "DELIVERY ATTEMPT", "FAILED DELIVERY") ||
    has(s, "ISSUE RELATED TO THE RECIPIENT", "CONSIGNEE NOT AVAILABLE", "CONSIGNEE REFUSED", "DOOR LOCKED") ||
    /\bNDR\b/.test(s) ||
    // DTDC "RTB Manifested": back to the delivery branch after failed attempts.
    /\bRTB\b/.test(s)
  ) {
    return "DELIVERY_ATTEMPTED";
  }
  // "Not Picked", "Pickup Not Done", "PickupFailed" — before the PICKED rule.
  if (has(s, "NOT PICKED", "PICKUP NOT DONE", "PICKUPFAILED", "PICKUP FAILED", "PICKUP AWAITED", "PICKUP REQUEST")) {
    return "AWAITING_PICKUP";
  }
  if (has(s, "OUT FOR DELIVERY") || /\bOFD\b/.test(s)) return "OUT_FOR_DELIVERY";
  if (has(s, "DELIVERED")) return "DELIVERED";
  if (has(s, "DELAY")) return "DELAYED";
  if (
    has(s, "OUT FOR PICKUP", "PICKUP SCHEDULED", "PICKUP GENERATED", "PICKUP BOOKED", "PICKUP RESCHEDULED") ||
    has(s, "PICKUP EXCEPTION", "PICKUP ERROR", "PICKUP QUEUED", "READY TO SHIP", "AWB ASSIGNED") ||
    has(s, "MANIFEST", "SHIPMENT BOOKED", "PACKED", "LABEL GENERATED") ||
    s === "NEW"
  ) {
    return "AWAITING_PICKUP";
  }
  if (has(s, "PICKED UP", "PICKED", "SHIPPED", "HANDOVER TO COURIER", "HANDED OVER")) return "PICKED_UP";
  if (
    has(s, "IN TRANSIT", "INTRANSIT", "TRANSIT", "EN-ROUTE", "ENROUTE", "REACHED", "ARRIVED") ||
    has(s, "DISPATCHED", "CONNECTED", "CONNECTION", "BAGGED", "IN FLIGHT", "DEPARTED", "RECEIVED AT") ||
    has(s, "AT DESTINATION", "SCHEDULED FOR DELIVERY", "PROCESSING CENTER", "INSCAN", "OUTSCAN")
  ) {
    return "IN_TRANSIT";
  }
  return "UNKNOWN";
}

/** Customer-facing words. Never shown: AWAITING_AWB is "Processing". */
export const CUSTOMER_STATUS_LABEL: Record<TrackingStatus, string> = {
  AWAITING_AWB: "Processing",
  AWAITING_PICKUP: "Ready for pickup",
  PICKED_UP: "Shipped",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERY_ATTEMPTED: "Delivery attempted",
  DELAYED: "Delivery delayed",
  EXCEPTION: "Delivery exception",
  RTO_IN_TRANSIT: "Returning to us",
  RTO_DELIVERED: "Returned",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  UNKNOWN: "In transit",
};

export type OrderStatusFromTracking = "PACKED" | "SHIPPED" | "DELIVERED" | "RETURNED" | "CANCELLED";

/**
 * The order_status a FORWARD shipment's tracking status implies. Mirrors the
 * long-standing mapShiprocketStatus semantics (any RTO stage → RETURNED, which
 * also releases stock) so finance/RTO reporting keeps its meaning.
 */
export function orderStatusFor(status: TrackingStatus): OrderStatusFromTracking | null {
  switch (status) {
    case "AWAITING_PICKUP":
      return "PACKED";
    case "PICKED_UP":
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
    case "DELIVERY_ATTEMPTED":
    case "DELAYED":
    case "EXCEPTION":
      return "SHIPPED";
    case "DELIVERED":
      return "DELIVERED";
    case "RTO_IN_TRANSIT":
    case "RTO_DELIVERED":
      return "RETURNED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return null;
  }
}

/**
 * Forward-only order transitions driven by courier data. A late or corrected
 * courier event can never drag an order backwards (DELIVERED → SHIPPED) or
 * overwrite a state staff set by hand (REFUNDED, CANCELLED…). Anything not
 * listed is refused and, where it matters, surfaced as an exception instead.
 *
 * A courier CANCELLATION never cancels the order. Ops cancel a Shiprocket
 * shipment to re-ship it with another courier (a "-C" clone); the old code
 * turned that into an order cancellation and released the stock while the
 * parcel was still going to the customer (a production order, Oct 2026). It is now a
 * SHIPMENT_CANCELLED exception for staff to re-ship or cancel deliberately.
 */
const ALLOWED: Record<string, ReadonlySet<OrderStatusFromTracking>> = {
  PAID: new Set(["PACKED", "SHIPPED", "DELIVERED", "RETURNED"]),
  PACKED: new Set(["SHIPPED", "DELIVERED", "RETURNED"]),
  SHIPPED: new Set(["DELIVERED", "RETURNED"]),
};

export function canTrackingMoveOrder(from: string, to: OrderStatusFromTracking): boolean {
  return ALLOWED[from]?.has(to) ?? false;
}
