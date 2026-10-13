/**
 * Courier providers — the platform a shipment is BOOKED on.
 *
 *   - "shiprocket": the aggregator (src/lib/shiprocket.ts). The order is created
 *     there without a courier; staff pick the courier by hand in its dashboard.
 *   - "delhivery": Delhivery booked directly with our own account
 *     (src/lib/couriers/delhivery.ts). The waybill is assigned at booking and
 *     is the whole record — there are no Shiprocket ids.
 *
 * Which one books a new order is decided by src/lib/couriers/routing.ts under
 * the settings in src/lib/couriers/settings.ts. The provider is stored on
 * orders.courier_provider and shipment_tracking.courier_provider so tracking,
 * labels, pickups and cancels call the right API — a shipment never changes
 * provider once it has an AWB.
 */

import { delhiveryAdapter } from "./delhivery";
import { shiprocketAdapter } from "./shiprocket";
import { COURIER_PROVIDERS, type CourierAdapter, type CourierProvider, type ShipmentRef } from "./types";

export { COURIER_PROVIDERS };
export type { CourierProvider };

const ADAPTERS: Record<CourierProvider, CourierAdapter> = {
  shiprocket: shiprocketAdapter,
  delhivery: delhiveryAdapter,
};

export function getCourierAdapter(p: CourierProvider): CourierAdapter {
  return ADAPTERS[p];
}

/** Read a stored provider; anything unrecognised is the historical default. */
export function asCourierProvider(v: string | null | undefined): CourierProvider {
  return v === "delhivery" ? "delhivery" : "shiprocket";
}

export const COURIER_PROVIDER_LABEL: Record<CourierProvider, string> = {
  shiprocket: "Shiprocket",
  delhivery: "Delhivery (direct)",
};

/** Public tracking page for an AWB on the platform that booked it. */
export function courierTrackingUrl(provider: CourierProvider, awb: string): string {
  return provider === "delhivery"
    ? `https://www.delhivery.com/track-v2/package/${encodeURIComponent(awb)}`
    : `https://shiprocket.co/tracking/${awb}`;
}

type BookingCols = {
  courierProvider: string;
  shiprocketOrderId: string | null;
  shiprocketShipmentId?: string | null;
  awbCode: string | null;
};

/** How an order's shipment is addressed on its provider. */
export function shipmentRefOf(o: BookingCols): ShipmentRef {
  const sid = o.shiprocketShipmentId && o.shiprocketShipmentId !== "undefined" ? o.shiprocketShipmentId : null;
  return {
    awb: o.awbCode || null,
    shipmentId: sid,
    providerOrderId: /^\d+$/.test(o.shiprocketOrderId ?? "") ? o.shiprocketOrderId : null,
  };
}

/**
 * The booking reference staff see for an order, or null when it has not been
 * booked: the Shiprocket order id, or — for Delhivery, which has no order id
 * of its own — the waybill.
 */
export function courierBookingRef(o: BookingCols): string | null {
  if (asCourierProvider(o.courierProvider) === "delhivery") return o.awbCode || null;
  return o.shiprocketOrderId || null;
}

/**
 * The order already has a courier booking that must not be made again: a
 * REAL (all-digit) Shiprocket order id with its AWB — the legacy
 * String(undefined) bug wrote "undefined" — or a Delhivery waybill.
 */
export function hasCompletedBooking(o: BookingCols): boolean {
  if (asCourierProvider(o.courierProvider) === "delhivery") return !!o.awbCode;
  return /^\d+$/.test(o.shiprocketOrderId ?? "") && !!o.awbCode;
}

/** Booked on Shiprocket (a real order id exists), AWB or not. */
export function isOnShiprocket(o: BookingCols): boolean {
  return asCourierProvider(o.courierProvider) === "shiprocket" && /^\d+$/.test(o.shiprocketOrderId ?? "");
}
