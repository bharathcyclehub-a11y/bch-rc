/**
 * Courier routing engine — which provider should book a shipment, and why.
 *
 * `decideRoute` is pure (tests drive it directly); `evaluateRouting` gathers
 * its inputs from the providers. The decision sequence:
 *
 *   1. destination pincode valid, parcel dimensions valid;
 *   2. chargeable weight = max(dead weight, volumetric L×B×H ÷ 5000);
 *   3. per provider: enabled + configured, healthy (no open circuit breaker),
 *      serviceable for this payment type, payment type allowed, quote within
 *      the cap (when a cap is set — an unverifiable quote never passes it);
 *   4. the preferred provider when eligible — or, with `requireCheaper`, the
 *      cheaper of two COMPARABLE quotes (same confidence, same tax basis);
 *   5. otherwise the fallback policy: the other provider, or staff review.
 *
 * A quote that can't be compared like-for-like never decides on cost, and
 * savings are reported only when both quotes are comparable and the other
 * provider could actually have served the shipment.
 */

import { logError } from "@/lib/logger";
import { getCourierAdapter } from "./index";
import { circuitState } from "./health";
import { delhiveryPickupLocation, warehousePincode, type CourierSettings, type RoutingMode } from "./settings";
import { COURIER_PROVIDERS, type CourierProvider, type CourierQuote, type Parcel } from "./types";

export type ProviderAssessment = {
  provider: CourierProvider;
  /** Booking allowed by settings and credentials/config present. */
  enabled: boolean;
  /** Why not enabled, when it isn't. */
  disabledReason: string | null;
  /** No open circuit breaker. */
  healthy: boolean;
  /** null = the provider could not be asked. */
  serviceable: boolean | null;
  codAvailable: boolean | null;
  quote: CourierQuote | null;
  /** Booking it commits a courier (an AWB). Shiprocket bookings don't — staff
   *  pick the courier later — so an unverified Shiprocket lane is still a safe
   *  fallback; an unverified Delhivery lane is not. */
  bookingCommits: boolean;
  error: string | null;
};

export type Eligibility = {
  provider: CourierProvider;
  eligible: boolean;
  /** Why not, in staff-readable words. */
  reason: string | null;
};

export type RoutingReason =
  | "INVALID_PINCODE"
  | "INVALID_PARCEL"
  | "REVIEW_ORDER_VALUE"
  | "PREFERRED_ELIGIBLE"
  | "PREFERRED_CHEAPER"
  | "ALTERNATIVE_CHEAPER"
  | "PREFERRED_COST_UNVERIFIED"
  | "COST_UNVERIFIED_REVIEW"
  | "FALLBACK"
  | "NO_ELIGIBLE_PROVIDER";

export type ParcelFacts = Parcel & { volumetricGrams: number; chargeableGrams: number };

export type RoutingVerdict = {
  recommended: CourierProvider | null;
  reasonCode: RoutingReason;
  reason: string;
  eligibility: Eligibility[];
  /** Both quotes exist and can be compared like-for-like. */
  comparable: boolean;
  /** Alternative's quote minus the recommended one (paise), only when comparable
   *  and the alternative was eligible. Positive = the pick is cheaper. */
  savingsPaise: number | null;
  parcel: ParcelFacts | null;
};

export type RoutingInput = {
  pincode: string;
  paymentMethod: "Prepaid" | "COD";
  orderValueInr: number;
  parcel: Parcel;
  assessments: ProviderAssessment[];
  settings: CourierSettings;
};

const NAME: Record<CourierProvider, string> = { shiprocket: "Shiprocket", delhivery: "Delhivery" };
const other = (p: CourierProvider): CourierProvider => (p === "delhivery" ? "shiprocket" : "delhivery");
const inr = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export function parcelFacts(p: Parcel): ParcelFacts | null {
  const dims = [p.weightGrams, p.lengthCm, p.breadthCm, p.heightCm];
  if (!dims.every((n) => Number.isFinite(n) && n > 0)) return null;
  const volumetricGrams = Math.round(((p.lengthCm * p.breadthCm * p.heightCm) / 5000) * 1000);
  return { ...p, volumetricGrams, chargeableGrams: Math.max(p.weightGrams, volumetricGrams) };
}

function paymentAllowed(p: CourierProvider, cod: boolean, s: CourierSettings): boolean {
  if (p === "delhivery") return cod ? s.delhiveryCod : s.delhiveryPrepaid;
  return cod ? s.shiprocketCod : s.shiprocketPrepaid;
}

function quoteTrusted(q: CourierQuote | null, s: CourierSettings): q is CourierQuote {
  return !!q && (s.minRateConfidence === "partial" || q.confidence === "full");
}

/** Two quotes compare like-for-like: both trusted, and on the same tax basis. */
export function quotesComparable(a: CourierQuote | null, b: CourierQuote | null, s: CourierSettings): boolean {
  if (!quoteTrusted(a, s) || !quoteTrusted(b, s)) return false;
  if (s.minRateConfidence === "partial") return true;
  return a.taxIncluded !== null && a.taxIncluded === b.taxIncluded;
}

function eligibility(a: ProviderAssessment, cod: boolean, s: CourierSettings): Eligibility {
  const no = (reason: string): Eligibility => ({ provider: a.provider, eligible: false, reason });
  const n = NAME[a.provider];
  if (!a.enabled) return no(a.disabledReason ?? `${n} booking is disabled`);
  if (!paymentAllowed(a.provider, cod, s)) return no(`${cod ? "COD" : "Prepaid"} is not allowed on ${n} in settings`);
  if (!a.healthy) return no(`${n} is paused after refusing our API calls`);
  if (a.serviceable === false) return no(`${n} does not deliver to this pincode`);
  if (cod && a.codAvailable === false) return no(`${n} has no cash on delivery to this pincode`);
  if (a.serviceable === null && a.bookingCommits) {
    return no(`${n} serviceability could not be checked${a.error ? ` (${a.error})` : ""}`);
  }
  if (s.maxRateInr !== null) {
    if (!quoteTrusted(a.quote, s)) return no(`${n} price could not be verified against the ₹${s.maxRateInr} cap`);
    if (a.quote.totalPaise > s.maxRateInr * 100) {
      return no(`${n} quote ${inr(a.quote.totalPaise)} is above the ₹${s.maxRateInr} cap`);
    }
  }
  return { provider: a.provider, eligible: true, reason: null };
}

export function decideRoute(input: RoutingInput): RoutingVerdict {
  const s = input.settings;
  const cod = input.paymentMethod === "COD";
  const parcel = parcelFacts(input.parcel);
  const byP = new Map(input.assessments.map((a) => [a.provider, a]));
  const elig = COURIER_PROVIDERS.map((p) => {
    const a = byP.get(p);
    return a ? eligibility(a, cod, s) : { provider: p, eligible: false, reason: `${NAME[p]} was not assessed` };
  });
  const E = new Map(elig.map((e) => [e.provider, e]));
  const verdict = (
    recommended: CourierProvider | null,
    reasonCode: RoutingReason,
    reason: string,
    comparable = false,
    savingsPaise: number | null = null,
  ): RoutingVerdict => ({ recommended, reasonCode, reason, eligibility: elig, comparable, savingsPaise, parcel });

  if (!/^[1-9][0-9]{5}$/.test(input.pincode)) return verdict(null, "INVALID_PINCODE", `"${input.pincode}" is not a valid pincode`);
  if (!parcel) return verdict(null, "INVALID_PARCEL", "Parcel weight or dimensions are missing or invalid");
  if (s.reviewAboveInr !== null && input.orderValueInr > s.reviewAboveInr) {
    return verdict(null, "REVIEW_ORDER_VALUE", `Order value ₹${input.orderValueInr} is above the ₹${s.reviewAboveInr} review threshold`);
  }

  const pref = s.preferred;
  const alt = other(pref);
  const ep = E.get(pref)!;
  const ea = E.get(alt)!;
  const qp = byP.get(pref)?.quote ?? null;
  const qa = byP.get(alt)?.quote ?? null;
  const comparable = ep.eligible && ea.eligible && quotesComparable(qp, qa, s);
  const saving = (pick: CourierQuote, vs: CourierQuote) => vs.totalPaise - pick.totalPaise;

  if (ep.eligible) {
    if (s.requireCheaper && ea.eligible) {
      if (comparable) {
        return qp!.totalPaise <= qa!.totalPaise
          ? verdict(pref, "PREFERRED_CHEAPER", `${NAME[pref]} ${inr(qp!.totalPaise)} vs ${NAME[alt]} ${inr(qa!.totalPaise)}`, true, saving(qp!, qa!))
          : verdict(alt, "ALTERNATIVE_CHEAPER", `${NAME[alt]} ${inr(qa!.totalPaise)} vs ${NAME[pref]} ${inr(qp!.totalPaise)}`, true, saving(qa!, qp!));
      }
      return s.fallback === "review"
        ? verdict(null, "COST_UNVERIFIED_REVIEW", "Prices can't be compared like-for-like; staff to choose")
        : verdict(pref, "PREFERRED_COST_UNVERIFIED", `${NAME[pref]} is preferred; prices can't be compared like-for-like`);
    }
    return verdict(
      pref,
      "PREFERRED_ELIGIBLE",
      `${NAME[pref]} serves this pincode${qp ? ` (${inr(qp.totalPaise)})` : ""}`,
      comparable,
      comparable ? saving(qp!, qa!) : null,
    );
  }
  if (s.fallback === "other" && ea.eligible) {
    return verdict(alt, "FALLBACK", `${ep.reason}; using ${NAME[alt]}`);
  }
  return verdict(null, "NO_ELIGIBLE_PROVIDER", [ep.reason, ea.eligible ? `fallback is staff review` : ea.reason].filter(Boolean).join("; "));
}

// ── Gathering inputs ────────────────────────────────────────────────────────

/** The routing record stored on orders.courier_routing (latest evaluation). */
export type RoutingRecord = RoutingVerdict & {
  v: 1;
  mode: RoutingMode;
  /** Shadow mode evaluates every configured provider as if it were enabled. */
  hypothetical: boolean;
  evaluatedAt: string;
  paymentMethod: "Prepaid" | "COD";
  assessments: ProviderAssessment[];
};

export type RoutingOrderFacts = {
  pincode: string;
  paymentMethod: "Prepaid" | "COD";
  orderValueInr: number;
  codAmountInr: number;
};

/**
 * Why a provider can't book at all, or null. In shadow mode a missing
 * Delhivery pickup location doesn't stop the evaluation — shadow answers "what
 * would happen once Delhivery is set up" — it is noted on the assessment.
 */
function configured(p: CourierProvider, s: CourierSettings, hypothetical: boolean): string | null {
  if (!getCourierAdapter(p).isConfigured()) return `${NAME[p]} credentials are not configured`;
  if (p === "delhivery" && !delhiveryPickupLocation(s) && !hypothetical) return "Delhivery pickup location is not configured";
  return null;
}

/** Ask every provider, then decide. Never throws for a provider failure. */
export async function evaluateRouting(
  facts: RoutingOrderFacts,
  s: CourierSettings,
  now: Date = new Date(),
): Promise<RoutingRecord> {
  const hypothetical = s.mode === "shadow";
  const cod = facts.paymentMethod === "COD";
  const parcel = parcelFacts(s.parcel);
  const origin = warehousePincode(s);

  const assessments = await Promise.all(
    COURIER_PROVIDERS.map(async (p): Promise<ProviderAssessment> => {
      const adapter = getCourierAdapter(p);
      const notConfigured = configured(p, s, hypothetical);
      const switchedOff = p === "delhivery" ? !s.delhiveryEnabled : !s.shiprocketEnabled;
      const base: ProviderAssessment = {
        provider: p,
        enabled: !notConfigured && (hypothetical || !switchedOff),
        disabledReason: notConfigured ?? (switchedOff && !hypothetical ? `${NAME[p]} booking is switched off in settings` : null),
        healthy: true,
        serviceable: null,
        codAvailable: null,
        quote: null,
        bookingCommits: adapter.capabilities.awbOnBooking,
        error: p === "delhivery" && hypothetical && !delhiveryPickupLocation(s) ? "pickup location not configured yet" : null,
      };
      if (notConfigured) return base;
      try {
        base.healthy = !(await circuitState(now, p));
        if (!base.healthy) return base;
        const sv = await adapter.serviceability(facts.pincode);
        if (sv) {
          base.serviceable = sv.serviceable;
          base.codAvailable = sv.codAvailable;
        } else {
          base.error = "serviceability check failed";
        }
        if (sv?.serviceable !== false && parcel && origin) {
          base.quote = await adapter.quote({
            originPincode: origin,
            pincode: facts.pincode,
            cod,
            codAmountInr: facts.codAmountInr,
            declaredValueInr: facts.orderValueInr,
            parcel: { ...parcel, weightGrams: parcel.chargeableGrams },
          });
        }
      } catch (err) {
        base.error = err instanceof Error ? err.message.slice(0, 160) : String(err);
        logError("couriers:assess", err, { provider: p, pincode: facts.pincode });
      }
      return base;
    }),
  );

  const verdict = decideRoute({
    pincode: facts.pincode,
    paymentMethod: facts.paymentMethod,
    orderValueInr: facts.orderValueInr,
    parcel: s.parcel,
    assessments,
    settings: s,
  });
  return {
    v: 1,
    mode: s.mode,
    hypothetical,
    evaluatedAt: now.toISOString(),
    paymentMethod: facts.paymentMethod,
    assessments,
    ...verdict,
  };
}
