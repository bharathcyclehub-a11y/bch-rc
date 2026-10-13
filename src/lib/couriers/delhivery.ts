import { envStr } from "@/lib/env";
import { logError } from "@/lib/logger";
import { parseDelhiveryTracking } from "@/lib/tracking/carrier";
import { delhiveryPickupLocation, loadCourierSettings } from "./settings";
import {
  CourierUnsupportedError,
  type CourierAdapter,
  type CourierQuote,
  type PickupResult,
  type ShipmentRef,
} from "./types";

/**
 * Delhivery direct — our own Delhivery One account, booked without Shiprocket.
 *
 * Auth: a static API token sent as `Authorization: Token <token>` on every
 * call (DELHIVERY_API_TOKEN). No login call and no token cache, unlike
 * Shiprocket's JWT. DELHIVERY_ENV=staging points at Delhivery's staging host
 * (which needs its own staging token).
 *
 * Booking — one call, unlike Shiprocket's create-then-assign:
 *   POST /api/cmu/create.json, form fields `format=json` + `data=<json>`, with
 *   an EMPTY waybill → Delhivery creates the shipment ("Manifested") and
 *   assigns the waybill in the same response. The waybill is the shipment's
 *   only key: label, tracking and cancel all take it.
 *
 * Delhivery answers HTTP 200 for most failures. A refused booking is
 * `success: false` with `rmk` / `packages[].remarks`; an unknown waybill is
 * `{ Success: false, Error }`. Every helper checks the body, not the status.
 * Some refusals say the package "might have been partially saved" (wallet
 * balance, capacity…): those are NOT definitive — the order is looked up
 * before anything else is booked.
 *
 * Verified on the live API (12 Oct 2026): serviceability, invoice charges,
 * tracking by waybill and by order id, packing slip (unknown waybill), 401 on
 * a bad token. Booking, cancel and pickup follow Delhivery's developer portal
 * (one.delhivery.com/developer-portal) and are first exercised by the
 * staff-controlled test parcel (COURIERS.md).
 */

const API =
  envStr("DELHIVERY_ENV").toLowerCase() === "staging"
    ? "https://staging-express.delhivery.com"
    : "https://track.delhivery.com";

/**
 * A non-2xx answer from Delhivery, with the HTTP status kept so callers can
 * tell "refused / rate-limited" (401, 403, 429 — back off) from an ordinary
 * failure. Tracking over its rate limit is a 403 from Delhivery's WAF.
 */
export class DelhiveryApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DelhiveryApiError";
    this.status = status;
  }
}

/**
 * Delhivery definitively REFUSED a booking — nothing was created, so the
 * caller may book it elsewhere. `remark` is Delhivery's own reason.
 */
export class DelhiveryRejectedError extends Error {
  readonly remark: string;
  constructor(remark: string) {
    super(`Delhivery refused the booking: ${remark}`);
    this.name = "DelhiveryRejectedError";
    this.remark = remark;
  }
}

/**
 * Delhivery reported a failure but the shipment may still exist ("Package
 * might have been partially saved"). Never book elsewhere on this — look the
 * order up first.
 */
export class DelhiveryAmbiguousError extends Error {
  readonly remark: string;
  constructor(remark: string) {
    super(`Delhivery booking outcome unclear: ${remark}`);
    this.name = "DelhiveryAmbiguousError";
    this.remark = remark;
  }
}

function getToken(): string {
  const token = envStr("DELHIVERY_API_TOKEN");
  if (!token) throw new Error("DELHIVERY_API_TOKEN must be set");
  return token;
}

async function dlvFetch<T>(
  path: string,
  init: RequestInit & { method: "GET" | "POST" },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers,
      Authorization: `Token ${getToken()}`,
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  const route = path.split("?")[0];
  if (!res.ok) {
    throw new DelhiveryApiError(`Delhivery ${init.method} ${route} → ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DelhiveryApiError(`Delhivery ${init.method} ${route} → non-JSON: ${text.slice(0, 200)}`, res.status);
  }
}

function remarkText(r: unknown): string {
  if (Array.isArray(r)) return r.map(String).filter((x) => x.trim()).join("; ");
  return typeof r === "string" ? r.trim() : r == null ? "" : JSON.stringify(r);
}

/** Delhivery rejects these characters in address/name fields outright. */
function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/[&#%;\\"]/g, " ").replace(/\s+/g, " ").trim();
}

/** Delhivery wants the 10-digit mobile number, without +91 / 0 prefixes. */
function tenDigitPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** YYYY-MM-DD of an instant in IST. */
function istDate(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

const paise = (inr: unknown): number => Math.round((Number(inr) || 0) * 100);

async function pickupLocationOrThrow(): Promise<string> {
  const loc = delhiveryPickupLocation(await loadCourierSettings());
  if (!loc) throw new Error("Delhivery pickup location is not configured (settings or DELHIVERY_PICKUP_LOCATION)");
  return loc;
}

type CreateResp = {
  success?: boolean;
  error?: unknown;
  rmk?: string;
  upload_wbn?: string;
  packages?: Array<{ waybill?: string; refnum?: string; status?: string; remarks?: unknown }>;
};

type TrackResp = {
  ShipmentData?: Array<{
    Shipment?: { AWB?: string | number; ReferenceNo?: string; Status?: { Status?: string; StatusType?: string } };
  }>;
};

export const delhiveryAdapter: CourierAdapter = {
  provider: "delhivery",
  capabilities: {
    serviceability: true,
    rateQuote: true,
    awbOnBooking: true,
    findBooking: true,
    label: true,
    // No manifest sheet: a booked shipment is already "Manifested".
    manifest: false,
    pickup: true,
    tracking: true,
    cancel: true,
    // Scan push exists but is enabled by Delhivery's integration team on
    // request; /api/webhooks/delhivery is ready for it. Polling covers it.
    webhook: false,
  },

  isConfigured() {
    return !!envStr("DELHIVERY_API_TOKEN");
  },

  /**
   * An unserviceable pincode is an EMPTY `delivery_codes` list; a listed one
   * with remarks "Embargo" is temporarily not serviceable. null on API
   * failure, so routing never reads an outage as "not serviceable".
   */
  async serviceability(pincode) {
    if (!/^[1-9][0-9]{5}$/.test(pincode)) return null;
    try {
      type Resp = { delivery_codes?: Array<{ postal_code?: { pin?: number | string; cod?: string; pre_paid?: string; remarks?: string } }> };
      const data = await dlvFetch<Resp>(`/c/api/pin-codes/json/?filter_codes=${pincode}`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (!Array.isArray(data.delivery_codes)) return null;
      const pc = data.delivery_codes.map((d) => d.postal_code).find((p) => String(p?.pin ?? "") === pincode);
      if (!pc || /embargo/i.test(pc.remarks ?? "")) return { serviceable: false, codAvailable: false };
      const prepaid = pc.pre_paid === "Y";
      return { serviceable: prepaid, codAvailable: prepaid && pc.cod === "Y" };
    } catch (err) {
      logError("delhivery:serviceability", err, { pincode });
      return null;
    }
  },

  /**
   * Delhivery's own price for this parcel (GET /api/kinko/v1/invoice/charges):
   * every charge line plus GST, so it is a FULL quote. `cgm` is the
   * chargeable weight in grams (routing passes max(dead, volumetric)).
   */
  async quote(q): Promise<CourierQuote | null> {
    const settings = await loadCourierSettings();
    const md = settings.delhiveryModes.includes("Surface") ? "S" : "E";
    type Row = Record<string, unknown> & {
      total_amount?: number;
      gross_amount?: number;
      charge_DL?: number;
      charge_COD?: number;
      charge_FSC?: number;
      charge_FS?: number;
      charge_ODA?: number;
      charged_weight?: number;
      zone?: string;
      tax_data?: Record<string, number>;
    };
    const rows = await dlvFetch<Row[] | Row>(
      `/api/kinko/v1/invoice/charges/.json?md=${md}&ss=Delivered&o_pin=${q.originPincode}&d_pin=${q.pincode}` +
        `&cgm=${Math.max(1, Math.round(q.parcel.weightGrams))}&pt=${q.cod ? "COD" : "Pre-paid"}&cod=${q.cod ? Math.round(q.codAmountInr) : 0}`,
      { method: "GET", signal: AbortSignal.timeout(8000) },
    );
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r || !Number.isFinite(Number(r.total_amount)) || Number(r.total_amount) <= 0) return null;
    const tax = Object.values(r.tax_data ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
    const known = new Set(["charge_DL", "charge_COD", "charge_FSC", "charge_FS", "charge_ODA"]);
    const otherInr = Object.entries(r)
      .filter(([k, v]) => k.startsWith("charge_") && !known.has(k) && typeof v === "number")
      .reduce((s, [, v]) => s + (v as number), 0);
    return {
      provider: "delhivery",
      totalPaise: paise(r.total_amount),
      taxIncluded: true,
      confidence: "full",
      components: {
        freightPaise: paise(r.charge_DL),
        codPaise: paise(r.charge_COD),
        fuelPaise: paise((Number(r.charge_FSC) || 0) + (Number(r.charge_FS) || 0)),
        remoteAreaPaise: paise(r.charge_ODA),
        otherPaise: paise(otherInr),
        taxPaise: paise(tax),
      },
      courierName: "Delhivery",
      mode: md === "S" ? "surface" : "air",
      chargedWeightGrams: Number.isFinite(Number(r.charged_weight)) ? Number(r.charged_weight) : null,
      zone: typeof r.zone === "string" ? r.zone : null,
      source: "delhivery:invoice-charges",
      quotedAt: new Date().toISOString(),
    };
  },

  /**
   * Book one shipment. Throws DelhiveryRejectedError when Delhivery refused it
   * outright (safe to book elsewhere), DelhiveryAmbiguousError when it may have
   * been saved anyway, and a plain error for anything else ambiguous (timeout,
   * 5xx) — create-shipment reconciles those before booking again.
   */
  async book(input) {
    const settings = await loadCourierSettings();
    const pickup = await pickupLocationOrThrow();
    const units = input.items.reduce((n, i) => n + i.units, 0);
    const shipment = {
      name: clean(input.customer.name),
      add: clean([input.customer.line1, input.customer.line2].filter(Boolean).join(", ")),
      pin: input.customer.pincode,
      city: clean(input.customer.city),
      state: clean(input.customer.state),
      country: "India",
      phone: tenDigitPhone(input.customer.phone),
      order: input.orderId,
      payment_mode: input.paymentMethod,
      cod_amount: input.paymentMethod === "COD" ? String(input.codAmountInr) : "0",
      total_amount: String(input.invoiceValueInr),
      products_desc: clean(input.items.map((i) => (i.units > 1 ? `${i.name} x${i.units}` : i.name)).join(", ")).slice(0, 200),
      quantity: String(units),
      // Grams and centimetres.
      weight: String(input.parcel.weightGrams),
      shipment_length: String(input.parcel.lengthCm),
      shipment_width: String(input.parcel.breadthCm),
      shipment_height: String(input.parcel.heightCm),
      shipping_mode: settings.delhiveryModes.includes("Surface") ? "Surface" : "Express",
      waybill: "",
    };
    const form = new URLSearchParams({
      format: "json",
      data: JSON.stringify({ shipments: [shipment], pickup_location: { name: pickup } }),
    });

    const resp = await dlvFetch<CreateResp>("/api/cmu/create.json", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });

    const pkg = resp.packages?.[0];
    const waybill = String(pkg?.waybill ?? "").trim();
    if (resp.success === true && waybill && !/fail/i.test(pkg?.status ?? "")) {
      return {
        provider: "delhivery",
        providerOrderId: null,
        shipmentId: null,
        awb: waybill,
        courierName: "Delhivery",
        trackingUrl: `https://www.delhivery.com/track-v2/package/${encodeURIComponent(waybill)}`,
        requestId: resp.upload_wbn ?? null,
      };
    }

    const remark =
      [...new Set([remarkText(pkg?.remarks), (resp.rmk ?? "").trim()].filter(Boolean))].join(" — ") ||
      JSON.stringify(resp).slice(0, 200);
    // "Duplicate order id": an earlier attempt DID book it — adopt that booking.
    if (/duplicate/i.test(remark)) {
      const existing = await delhiveryAdapter.findBooking(input.orderId);
      if (existing) {
        return {
          provider: "delhivery",
          providerOrderId: null,
          shipmentId: null,
          awb: existing.awb,
          courierName: "Delhivery",
          trackingUrl: `https://www.delhivery.com/track-v2/package/${encodeURIComponent(existing.awb)}`,
          requestId: null,
        };
      }
      throw new DelhiveryAmbiguousError(remark.slice(0, 300));
    }
    if (/partially saved|crashing while saving/i.test(remark)) throw new DelhiveryAmbiguousError(remark.slice(0, 300));
    if (resp.success === false || pkg) throw new DelhiveryRejectedError(remark.slice(0, 300));
    throw new DelhiveryAmbiguousError(`no waybill in response: ${remark.slice(0, 200)}`);
  },

  /**
   * The live booking under our order id, if any (GET packages by ref_ids).
   * Unknown ids answer `{ Error: "No such waybill or Order Id found" }`. A
   * forward shipment cancelled before pickup still reads "Manifested" here,
   * so a cancelled-by-us booking is excluded by our own records, not this.
   */
  async findBooking(orderId) {
    const data = await dlvFetch<TrackResp>(`/api/v1/packages/json/?ref_ids=${encodeURIComponent(orderId)}`, {
      method: "GET",
    });
    for (const s of data.ShipmentData ?? []) {
      const sh = s.Shipment;
      const awb = String(sh?.AWB ?? "").trim();
      if (!awb || String(sh?.ReferenceNo ?? "").trim() !== orderId) continue;
      if (sh?.Status?.StatusType === "CN" || /cancel/i.test(sh?.Status?.Status ?? "")) continue;
      return { awb };
    }
    return null;
  },

  /**
   * Printable 4×6 label. With `pdf=true` Delhivery renders the PDF and returns
   * a short-lived link (one waybill per request), so — like Shiprocket's — it
   * is fetched fresh on every click. Slow at the tail (p99 ≈ 60 s).
   */
  async label(ref) {
    if (!ref.awb) return { url: null };
    type Resp = { packages?: Array<{ pdf_download_link?: string }> | null; packages_found?: number };
    const data = await dlvFetch<Resp>(`/api/p/packing_slip?wbns=${encodeURIComponent(ref.awb)}&pdf=true&pdf_size=4R`, {
      method: "GET",
      signal: AbortSignal.timeout(70_000),
    });
    return { url: data.packages?.find((p) => p.pdf_download_link)?.pdf_download_link ?? null };
  },

  async manifest() {
    throw new CourierUnsupportedError("delhivery", "manifest sheets");
  },

  /**
   * Ask Delhivery to collect from our pickup location. Pickups are per
   * LOCATION and day, not per parcel, and only one can be open at a time:
   * "A Pickup Request … Already Exist" means the parcel rides on that one, and
   * "auto pickup" means Delhivery collects daily without a request. Before
   * 13:00 IST we ask for today, after that for tomorrow.
   */
  async schedulePickup(refs, now: Date = new Date()): Promise<PickupResult> {
    const istHour = new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
    const pickupDate = istDate(istHour < 13 ? now : new Date(now.getTime() + 86_400_000));
    const soft = (message: string): PickupResult => ({
      ok: true,
      scheduledFor: pickupDate,
      pickupId: null,
      alreadyScheduled: true,
      message,
    });
    const isSoft = (m: string) => /already exist|auto pickup/i.test(m);
    try {
      const pickup = await pickupLocationOrThrow();
      type Resp = { pickup_id?: number | string; pickup_date?: string; error?: unknown; message?: string; prepaid?: unknown };
      const data = await dlvFetch<Resp>("/fm/request/new/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pickup_location: pickup,
          pickup_date: pickupDate,
          pickup_time: "14:00:00",
          expected_package_count: Math.max(1, refs.length),
        }),
      });
      if (data.pickup_id != null) {
        return { ok: true, scheduledFor: data.pickup_date ?? pickupDate, pickupId: String(data.pickup_id), alreadyScheduled: false, message: "scheduled" };
      }
      const msg = remarkText(data.error) || data.message || JSON.stringify(data).slice(0, 200);
      if (isSoft(msg)) return soft(msg);
      return { ok: false, scheduledFor: null, pickupId: null, alreadyScheduled: false, message: msg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isSoft(msg)) return soft(msg);
      return { ok: false, scheduledFor: null, pickupId: null, alreadyScheduled: false, message: msg };
    }
  },

  /** Cancel before the parcel is out for delivery. JSON body. */
  async cancel(ref: ShipmentRef) {
    if (!ref.awb) return { ok: false, message: "no waybill" };
    type Resp = { status?: boolean | string; remark?: string; error?: string };
    try {
      const data = await dlvFetch<Resp>("/api/p/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ waybill: ref.awb, cancellation: "true" }),
      });
      const ok = data.status === true || data.status === "true";
      return { ok, message: data.remark ?? data.error ?? (ok ? "cancelled" : JSON.stringify(data).slice(0, 200)) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async track(ref) {
    if (!ref.awb) throw new Error("Delhivery tracks by waybill only");
    const body = await dlvFetch<unknown>(`/api/v1/packages/json/?waybill=${encodeURIComponent(ref.awb)}`, { method: "GET" });
    const snap = parseDelhiveryTracking(body);
    if (!snap) throw new Error(`Unrecognised Delhivery tracking response: ${JSON.stringify(body).slice(0, 160)}`);
    return snap;
  },
};
