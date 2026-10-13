/**
 * The courier seam — one interface for every booking platform.
 *
 * Provider-specific request/response formats stay inside each adapter
 * (src/lib/couriers/shiprocket.ts, src/lib/couriers/delhivery.ts). The rest of
 * the app — booking, routing, tracking, /pack, admin — talks to this shape.
 *
 * Capabilities differ, and are stated, not papered over: an operation a
 * provider does not offer throws CourierUnsupportedError instead of
 * pretending to succeed (Delhivery has no manifest PDF; Shiprocket bookings
 * have no AWB until staff pick a courier).
 */

import type { CarrierSnapshot } from "@/lib/tracking/carrier";

export const COURIER_PROVIDERS = ["shiprocket", "delhivery"] as const;
export type CourierProvider = (typeof COURIER_PROVIDERS)[number];

export type CourierCapabilities = {
  serviceability: boolean;
  rateQuote: boolean;
  /** The booking call itself returns the AWB (no separate assignment step). */
  awbOnBooking: boolean;
  /** Look up a booking by OUR order id — needed to reconcile a lost response. */
  findBooking: boolean;
  label: boolean;
  manifest: boolean;
  pickup: boolean;
  tracking: boolean;
  cancel: boolean;
  /** Pushes status webhooks we can receive today. */
  webhook: boolean;
};

/** The parcel as billed: dead weight and box dimensions. */
export type Parcel = {
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
};

export type Serviceability = {
  /** Delivers to the pincode at all (prepaid). */
  serviceable: boolean;
  /** …and collects cash on delivery there. */
  codAvailable: boolean;
};

/**
 * How much a quote can be trusted for a cost comparison:
 *   full    — the provider's own price for this parcel, every charge line and
 *             GST included (Delhivery's invoice-charges API);
 *   partial — a price whose tax or surcharge coverage is not confirmed.
 * Billed amounts (invoices) are stored separately and never mixed in.
 */
export type RateConfidence = "full" | "partial";

export type QuoteComponents = {
  freightPaise: number | null;
  codPaise: number | null;
  fuelPaise: number | null;
  /** Remote-area / ODA charges. */
  remoteAreaPaise: number | null;
  otherPaise: number | null;
  taxPaise: number | null;
};

export type CourierQuote = {
  provider: CourierProvider;
  /** What we would pay, in paise, as the provider quoted it. */
  totalPaise: number;
  /** true = GST included, false = excluded, null = not stated by the provider. */
  taxIncluded: boolean | null;
  confidence: RateConfidence;
  components: QuoteComponents;
  /** The courier the price is for (Shiprocket quotes one of many). */
  courierName: string | null;
  mode: "surface" | "air" | null;
  chargedWeightGrams: number | null;
  zone: string | null;
  /** Which API produced it, e.g. "delhivery:invoice-charges". */
  source: string;
  quotedAt: string;
};

export type QuoteInput = {
  /** Our warehouse pincode. */
  originPincode: string;
  pincode: string;
  cod: boolean;
  /** Cash collected at the door, ₹ (COD fee is often a % of it). */
  codAmountInr: number;
  /** Declared value of the parcel, ₹. */
  declaredValueInr: number;
  parcel: Parcel;
};

export type BookingInput = {
  /** Our order ID (PRC-XXXXXXXX) — every provider's reference number. */
  orderId: string;
  orderPlacedAt: Date;
  customer: {
    name: string;
    phone: string;
    email?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  items: Array<{ name: string; sku: string; units: number; unitPriceInr: number }>;
  /** Shiprocket `sub_total` semantics: the invoice value it books (and, for
   *  COD, collects). Kept identical across providers. */
  invoiceValueInr: number;
  /** Cash the courier collects at the door, ₹ (0 for prepaid). */
  codAmountInr: number;
  paymentMethod: "Prepaid" | "COD";
  parcel: Parcel;
};

export type BookingResult = {
  provider: CourierProvider;
  /** Shiprocket's order id; null where the provider has none (Delhivery). */
  providerOrderId: string | null;
  /** Shiprocket's shipment id; null for Delhivery (the waybill is the id). */
  shipmentId: string | null;
  awb: string | null;
  courierName: string | null;
  trackingUrl: string | null;
  /** The provider's id for the booking request itself, when it gives one. */
  requestId: string | null;
};

/** How an order's shipment is addressed on its provider. */
export type ShipmentRef = {
  awb: string | null;
  shipmentId: string | null;
  providerOrderId: string | null;
};

export type PickupResult = {
  ok: boolean;
  /** The day the provider committed to (YYYY-MM-DD or provider text). */
  scheduledFor: string | null;
  /** Provider's pickup request id, when it gives one. */
  pickupId: string | null;
  /** A pickup already covered these parcels — not a new booking. */
  alreadyScheduled: boolean;
  message: string;
};

export interface CourierAdapter {
  readonly provider: CourierProvider;
  readonly capabilities: CourierCapabilities;
  /** Credentials present — the adapter can make calls at all. */
  isConfigured(): boolean;
  /** null = the provider could not be asked (outage, timeout). */
  serviceability(pincode: string): Promise<Serviceability | null>;
  /** null = no usable price for this parcel/lane. */
  quote(input: QuoteInput): Promise<CourierQuote | null>;
  book(input: BookingInput): Promise<BookingResult>;
  /** A live booking under our order id, or null when there is none. */
  findBooking(orderId: string): Promise<{ awb: string } | null>;
  label(ref: ShipmentRef): Promise<{ url: string | null }>;
  manifest(refs: ShipmentRef[]): Promise<{ url: string | null }>;
  schedulePickup(refs: ShipmentRef[]): Promise<PickupResult>;
  cancel(ref: ShipmentRef): Promise<{ ok: boolean; message: string }>;
  /** Parsed courier state; throws when the provider could not answer. */
  track(ref: ShipmentRef): Promise<CarrierSnapshot>;
}

/** The provider does not offer this operation. */
export class CourierUnsupportedError extends Error {
  constructor(provider: CourierProvider, operation: string) {
    super(`${provider} does not support ${operation}`);
    this.name = "CourierUnsupportedError";
  }
}
