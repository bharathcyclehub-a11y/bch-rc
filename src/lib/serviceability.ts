/**
 * Pincode serviceability + delivery ETA.
 *
 * Two entry points:
 *
 * 1. `resolveServiceability(pincode)` — SYNC, deterministic heuristic.
 *    Same input always yields same answer, no API cost. Used for ETA-text
 *    rendering in places that can't await (e.g. the order success page,
 *    notification templates) and as the fallback when the live call fails.
 *
 * 2. `verifyServiceabilityLive(pincode, needsCod)` — ASYNC, calls Shiprocket
 *    to confirm a courier actually serves the PIN with the requested payment
 *    method. Used by /api/serviceability (UI gate) and /api/orders/create
 *    (hard gate). Falls back to the heuristic if Shiprocket is unreachable.
 *
 * Why both: a live call is the only honest answer (a PIN like 999999 passes
 * regex but isn't a real delivery destination), but a hard dependency on
 * Shiprocket would break checkout for everyone the moment their API hiccups.
 * The split keeps live truth on the path that matters (gating orders) and
 * deterministic safety on the path that doesn't (rendering ETA).
 */
import {
  getShiprocketServiceability,
  type ShiprocketServiceability,
} from "./shiprocket";

// Metro prefixes (first 2 digits) — 2-3 day delivery. Everything else 3-5.
const METRO_PREFIXES = new Set([
  "11", // Delhi
  "12",
  "20", // Lucknow
  "30", // Jaipur
  "38", // Ahmedabad
  "40", // Mumbai
  "41", // Pune
  "44", // Chennai outer
  "50", // Hyderabad
  "56", // Bangalore
  "60", // Chennai
  "70", // Kolkata
]);

// Remote / hard-to-reach circles where COD is unreliable (RTO risk) — prepaid
// only. First 2 digits of the pincode. Tune from real RTO data over time.
const COD_BLOCKED_PREFIXES = new Set([
  "19", // J&K / Ladakh
  "79", // Arunachal / NE far
  "73", // parts of Sikkim/NE
]);

// Circles we genuinely don't ship to yet. Empty for now (pan-India), but the
// seam exists so ops can switch one off without a code change of substance.
const NON_SERVICEABLE_PREFIXES = new Set<string>([]);

export type Serviceability = {
  /** The pincode echoed back (normalised). */
  pincode: string;
  /** Valid 6-digit Indian pincode that isn't in a non-serviceable circle. */
  serviceable: boolean;
  /** COD allowed for this pincode (serviceable AND not in the COD blocklist). */
  codAvailable: boolean;
  /** Min / max business-day delivery estimate. */
  etaMinDays: number;
  etaMaxDays: number;
  /** Human delivery date range, e.g. "Wed, 04 Jun". */
  etaText: string;
  /** Customer-facing reason when not serviceable / COD blocked. */
  reason: string | null;
};

const PINCODE_RE = /^[1-9][0-9]{5}$/; // Indian pincodes never start with 0

function deliveryDate(fromDays: number, now: Date): string {
  const dt = new Date(now);
  dt.setDate(dt.getDate() + fromDays);
  return dt.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * @param now injectable for deterministic tests; defaults to current time.
 */
export function resolveServiceability(
  rawPincode: string,
  now: Date = new Date(),
): Serviceability {
  const pincode = (rawPincode ?? "").trim();
  const prefix = pincode.slice(0, 2);

  const base: Serviceability = {
    pincode,
    serviceable: false,
    codAvailable: false,
    etaMinDays: 0,
    etaMaxDays: 0,
    etaText: "",
    reason: null,
  };

  if (!PINCODE_RE.test(pincode)) {
    return { ...base, reason: "Enter a valid 6-digit pincode." };
  }
  if (NON_SERVICEABLE_PREFIXES.has(prefix)) {
    return {
      ...base,
      reason: "We don't deliver to this pincode yet. WhatsApp us to check.",
    };
  }

  const isMetro = METRO_PREFIXES.has(prefix);
  // Seed off the last 2 digits so adjacent pincodes get slightly different
  // ETAs (feels real, not algorithmic).
  const seed = parseInt(pincode.slice(-2), 10) || 0;
  const etaMinDays = isMetro ? 2 : 3;
  const etaMaxDays = isMetro ? 2 + (seed % 2) + 1 : 3 + (seed % 3) + 1; // metro 2-3, other 3-5
  const codAvailable = !COD_BLOCKED_PREFIXES.has(prefix);

  return {
    pincode,
    serviceable: true,
    codAvailable,
    etaMinDays,
    etaMaxDays,
    etaText: `${deliveryDate(etaMinDays, now)}–${deliveryDate(etaMaxDays, now)}`,
    reason: codAvailable
      ? null
      : "COD isn't available for this pincode — pay online to order (you save ₹100).",
  };
}

/**
 * Live serviceability check, with fallback. Use this on the order-gate path
 * (/api/serviceability and /api/orders/create) so the heuristic's optimistic
 * "any well-formed 6 digits is fine" can't ship orders to PINs Shiprocket
 * has no courier for.
 *
 * Behaviour:
 *   1. If pincode is malformed → return the heuristic's structured rejection.
 *   2. Ask Shiprocket. If they return a definitive answer (serviceable or
 *      not, with available couriers and COD support), trust it.
 *   3. If Shiprocket times out / errors / returns malformed JSON, fall back
 *      to the heuristic so checkout never breaks because of a courier-API
 *      outage. The heuristic is permissive but never returns "serviceable"
 *      for malformed PINs.
 *
 * @param needsCod true if the buyer has selected COD as the payment method.
 *                 Affects which couriers count as "available".
 */
export async function verifyServiceabilityLive(
  rawPincode: string,
  needsCod: boolean,
  now: Date = new Date(),
): Promise<Serviceability> {
  const heuristic = resolveServiceability(rawPincode, now);
  // Malformed / non-serviceable per the static rules → don't even hit the API.
  if (!heuristic.serviceable) return heuristic;

  const live: ShiprocketServiceability | null = await getShiprocketServiceability(
    heuristic.pincode,
    needsCod,
  );
  if (live === null) {
    // Shiprocket unreachable — degrade gracefully to heuristic so the buyer
    // doesn't see a hard error mid-checkout. The /api/orders/create gate
    // will run the live check again at submit time; transient API blips
    // resolve themselves by then.
    return heuristic;
  }

  if (!live.serviceable) {
    return {
      ...heuristic,
      serviceable: false,
      codAvailable: false,
      reason:
        "Sorry — no courier serves this pincode right now. WhatsApp us to confirm.",
    };
  }

  // Live ETA wins if Shiprocket gave us numbers; otherwise keep the heuristic
  // dates (so the UI always has something to show).
  const etaMinDays = live.etaMinDays ?? heuristic.etaMinDays;
  const etaMaxDays = live.etaMaxDays ?? heuristic.etaMaxDays;
  return {
    pincode: heuristic.pincode,
    serviceable: true,
    codAvailable: live.codAvailable,
    etaMinDays,
    etaMaxDays,
    etaText: `${deliveryDate(etaMinDays, now)}–${deliveryDate(etaMaxDays, now)}`,
    reason: live.codAvailable
      ? null
      : "COD isn't available for this pincode — pay online to order (you save ₹100).",
  };
}

/** Shown instead of a date once an order's estimated window has passed. */
export const ETA_LATE_TEXT = "running a little late — we'll update you shortly";

/**
 * Delivery estimate for an EXISTING order. Anchored to a fixed moment (ship
 * date once shipped, else payment/placement) so the date doesn't slide forward
 * every time the buyer reloads the page. Once that window has passed without
 * delivery, returns ETA_LATE_TEXT rather than a date in the past.
 */
export function orderEtaText(
  pincode: string | undefined,
  order: { placedAt: Date; paidAt: Date | null; shippedAt: Date | null },
  now: Date = new Date(),
): string | null {
  if (!pincode) return null;
  const anchor = new Date(order.shippedAt ?? order.paidAt ?? order.placedAt);
  const s = resolveServiceability(pincode, anchor);
  if (!s.serviceable) return null;
  const windowEnd = new Date(anchor);
  windowEnd.setDate(windowEnd.getDate() + s.etaMaxDays + 1); // through the whole last day
  return now > windowEnd ? ETA_LATE_TEXT : s.etaText;
}
