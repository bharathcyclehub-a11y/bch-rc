/**
 * Courier routing settings — which provider books a new shipment, and how.
 * Defaults live here; ops override any field from /admin/settings (stored in
 * app_settings under "couriers.routing"). Same field-by-field fallback as
 * src/lib/tracking/config.ts: a bad stored value never breaks booking.
 *
 * Modes, from most to least conservative:
 *   off     Shiprocket books every order exactly as before. No evaluation.
 *   shadow  Shiprocket books every order exactly as before; the routing
 *           engine records which provider it WOULD pick and why.
 *   manual  The engine recommends. Orders it would send to Delhivery (or
 *           can't route) wait for staff to approve on the order page;
 *           orders it would send to Shiprocket book as before.
 *   auto    The engine books the provider it picks.
 *
 * `delhiveryEnabled` is the master switch: while it is false no Delhivery
 * shipment is booked in any mode (staff overrides included). Shadow
 * evaluation still asks Delhivery for serviceability and prices.
 */

import { z } from "zod";
import { envStr } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { COURIER_PROVIDERS } from "./types";

export const ROUTING_MODES = ["off", "shadow", "manual", "auto"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

const parcelSchema = z.object({
  weightGrams: z.number().int().min(50).max(30_000),
  lengthCm: z.number().min(1).max(150),
  breadthCm: z.number().min(1).max(150),
  heightCm: z.number().min(0.5).max(150),
});

export const courierSettingsSchema = z.object({
  mode: z.enum(ROUTING_MODES),
  delhiveryEnabled: z.boolean(),
  shiprocketEnabled: z.boolean(),
  /** Tried first when eligible. */
  preferred: z.enum(COURIER_PROVIDERS),
  /** When the preferred provider isn't eligible: the other one, or staff review. */
  fallback: z.enum(["other", "review"]),
  /** Use the preferred provider only when its comparable quote is not dearer. */
  requireCheaper: z.boolean(),
  /** Never auto-book a quote above this (₹, as quoted). null = no cap. A quote
   *  below `minRateConfidence` can't be checked against the cap and fails it —
   *  with the default "full" that is every Shiprocket quote (GST not stated),
   *  so a cap sends lanes Delhivery can't take to staff review. */
  maxRateInr: z.number().min(1).max(5000).nullable(),
  /** Quotes below this confidence never decide on cost (see RateConfidence). */
  minRateConfidence: z.enum(["full", "partial"]),
  delhiveryPrepaid: z.boolean(),
  delhiveryCod: z.boolean(),
  shiprocketPrepaid: z.boolean(),
  shiprocketCod: z.boolean(),
  /** Delhivery service modes we may book. Surface is the cheap one. */
  delhiveryModes: z.array(z.enum(["Surface", "Express"])).min(1),
  /** Price Shiprocket by its cheapest SURFACE courier when one exists (air
   *  only where surface is unavailable) — how staff choose by hand today. */
  shiprocketSurfacePreferred: z.boolean(),
  /** Whether Shiprocket's quoted `rate` includes 18% GST. Its API doesn't say
   *  (its billed freight equals the quote to the paisa, checked 13 Oct 2026),
   *  so ops confirm it once from the wallet passbook: "included" when an
   *  AWB's debit equals the quote, "excluded" when it is 18% more. Until then
   *  Shiprocket quotes stay "partial" and never decide on cost. */
  shiprocketRatesGst: z.enum(["unknown", "included", "excluded"]),
  /** Orders above this value (₹) always wait for staff. null = never. */
  reviewAboveInr: z.number().int().min(100).max(1_000_000).nullable(),
  /** The packed parcel, as billed. Today every order ships in one polybag. */
  parcel: parcelSchema,
  /** The pickup location name registered in Delhivery (matched exactly).
   *  Empty = DELHIVERY_PICKUP_LOCATION from the environment. */
  delhiveryPickupLocation: z.string().trim().max(80),
  /** Warehouse pincode used for price quotes. Empty = SHIPROCKET_PICKUP_PINCODE. */
  pickupPincode: z.string().regex(/^(|[1-9][0-9]{5})$/),
});

export type CourierSettings = z.infer<typeof courierSettingsSchema>;

export const DEFAULT_COURIER_SETTINGS: CourierSettings = {
  mode: "shadow",
  delhiveryEnabled: false,
  shiprocketEnabled: true,
  preferred: "delhivery",
  fallback: "other",
  requireCheaper: false,
  maxRateInr: null,
  minRateConfidence: "full",
  delhiveryPrepaid: true,
  delhiveryCod: true,
  shiprocketPrepaid: true,
  shiprocketCod: true,
  delhiveryModes: ["Surface"],
  shiprocketSurfacePreferred: true,
  shiprocketRatesGst: "unknown",
  reviewAboveInr: null,
  // The 7×10 in tamper-proof polybag (see createShipment in src/lib/shiprocket.ts).
  parcel: { weightGrams: 300, lengthCm: 25, breadthCm: 18, heightCm: 4 },
  delhiveryPickupLocation: "",
  pickupPincode: "",
};

export const COURIER_SETTINGS_KEY = "couriers.routing";

/** Merge a stored override onto the defaults, dropping invalid fields. */
export function resolveCourierSettings(stored: unknown): CourierSettings {
  if (!stored || typeof stored !== "object") return DEFAULT_COURIER_SETTINGS;
  const merged: Record<string, unknown> = { ...DEFAULT_COURIER_SETTINGS };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (!(k in DEFAULT_COURIER_SETTINGS)) continue;
    const field = courierSettingsSchema.shape[k as keyof CourierSettings];
    if (field.safeParse(v).success) merged[k] = v;
  }
  return merged as CourierSettings;
}

export async function loadCourierSettings(): Promise<CourierSettings> {
  return resolveCourierSettings(await getSetting(COURIER_SETTINGS_KEY));
}

/** The warehouse pincode for quotes, or null when none is configured. */
export function warehousePincode(s: CourierSettings): string | null {
  const raw = s.pickupPincode || envStr("SHIPROCKET_PICKUP_PINCODE").replace(/\D/g, "");
  return /^[1-9][0-9]{5}$/.test(raw) ? raw : null;
}

/** The Delhivery pickup location name, or null when none is configured. */
export function delhiveryPickupLocation(s: CourierSettings): string | null {
  return s.delhiveryPickupLocation || envStr("DELHIVERY_PICKUP_LOCATION") || null;
}
