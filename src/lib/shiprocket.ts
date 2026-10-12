import { logError } from "@/lib/logger";

/**
 * Shiprocket helper — token cache + order/shipment creation + AWB assignment.
 *
 * Auth: Shiprocket issues a JWT that's valid for ~10 days. We cache it in
 * memory with a 9-day TTL. Each Vercel cold start refreshes (fine for our
 * volume). For higher scale, move the cache to Upstash Redis.
 *
 * Order creation pattern:
 *  1. POST /v1/external/orders/create/adhoc — creates a logical order
 *     Returns: { order_id (theirs), shipment_id, status }
 *  2. POST /v1/external/courier/assign/awb { shipment_id } — assigns courier
 *     Returns: { awb_code, courier_name, tracking_url }
 *
 * We bundle both in `createShipment()` so callers get the final AWB.
 */

const API = "https://apiv2.shiprocket.in/v1/external";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * A non-2xx answer from Shiprocket, with the HTTP status kept so callers can
 * tell "refused / rate-limited" (401, 403, 429 — back off everything) from an
 * ordinary failure. The message keeps the old `Shiprocket … → status: body`
 * shape so existing log greps and error strings are unchanged.
 */
export class ShiprocketApiError extends Error {
  readonly status: number;
  readonly isAuth: boolean;
  constructor(message: string, status: number, isAuth = false) {
    super(message);
    this.name = "ShiprocketApiError";
    this.status = status;
    this.isAuth = isAuth;
  }
}

/** Drop the cached JWT so the next call logs in again (after a 401). */
export function invalidateShiprocketToken(): void {
  cachedToken = null;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) {
    throw new Error("SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD must be set");
  }

  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new ShiprocketApiError(`Shiprocket auth failed: ${res.status} ${body}`, res.status, true);
  }

  const data = (await res.json()) as { token: string };
  cachedToken = {
    token: data.token,
    // Refresh after 9 days (token TTL is 10 days)
    expiresAt: Date.now() + 9 * 24 * 60 * 60 * 1000,
  };
  return data.token;
}

async function srFetch<T>(
  path: string,
  init: RequestInit & { method: "GET" | "POST" | "PATCH" | "DELETE" },
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ShiprocketApiError(`Shiprocket ${init.method} ${path} → ${res.status}: ${text}`, res.status);
  }
  return JSON.parse(text) as T;
}

/**
 * Raw tracking response for one shipment — by AWB when we have one (the
 * courier-level record), else by Shiprocket shipment id. Parsed by
 * src/lib/tracking/carrier.ts. A 401 refreshes the token and retries once.
 * Shiprocket answers 200 with `track_status: 0` when there are no scans yet;
 * that is a successful answer, not an error.
 */
export async function fetchShiprocketTracking(ref: {
  awb?: string | null;
  shipmentId?: string | null;
}): Promise<unknown> {
  const path = ref.awb
    ? `/courier/track/awb/${encodeURIComponent(ref.awb)}`
    : ref.shipmentId
      ? `/courier/track/shipment/${encodeURIComponent(ref.shipmentId)}`
      : null;
  if (!path) throw new Error("fetchShiprocketTracking: need an AWB or shipment id");
  const init = { method: "GET" as const, signal: AbortSignal.timeout(15_000) };
  try {
    return await srFetch<unknown>(path, init);
  } catch (err) {
    if (err instanceof ShiprocketApiError && err.status === 401 && !err.isAuth) {
      invalidateShiprocketToken();
      return srFetch<unknown>(path, { method: "GET", signal: AbortSignal.timeout(15_000) });
    }
    throw err;
  }
}

/**
 * The pickup pincode used for every serviceability / courier-rate query.
 *
 * Sanitised on purpose: Shiprocket's serviceability endpoint replies HTTP 200
 * with `{ message: "Invalid Pickup Pincode" }` and ZERO couriers when the
 * pickup_postcode is malformed — a trailing space, the pickup-location NAME
 * ("warehouse") pasted in by mistake, or an empty string. Because our gate
 * reads "0 couriers" as "not serviceable", a single bad env value silently
 * blocks EVERY customer at checkout (this exact outage, 2026-06-23).
 *
 * So we strip non-digits and, if the result isn't a valid 6-digit Indian
 * pincode, fall back to the known warehouse pincode (560043) rather than
 * sending Shiprocket garbage. One bad env edit can never blank-out checkout
 * again.
 */
function getPickupPincode(): string {
  const raw = (process.env.SHIPROCKET_PICKUP_PINCODE ?? "").replace(/\D/g, "");
  return /^[1-9][0-9]{5}$/.test(raw) ? raw : "560043";
}

// ============================================================
// Serviceability — live courier lookup
// ============================================================

/**
 * Shape returned by Shiprocket's GET /courier/serviceability/.
 * Only the fields we actually read are typed; the rest is `unknown`.
 */
type ServiceabilityResp = {
  status: number;
  data?: {
    available_courier_companies?: Array<{
      courier_company_id: number;
      courier_name?: string;
      cod: number; // 0 or 1
      estimated_delivery_days?: string | number;
      etd?: string;
    }>;
    recommended_courier_company_id?: number;
  };
};

export type ShiprocketServiceability = {
  /** At least one courier covers this pickup→delivery route. */
  serviceable: boolean;
  /** At least one courier covers it AND supports COD. */
  codAvailable: boolean;
  /** Min ETA across available couriers, in business days. null if unknown. */
  etaMinDays: number | null;
  /** Max ETA across available couriers, in business days. null if unknown. */
  etaMaxDays: number | null;
};

/**
 * Live serviceability check against Shiprocket. Returns null on API failure
 * so callers can fall back to a deterministic heuristic — we never want a
 * Shiprocket outage to break checkout for everyone.
 *
 * NOTE: weight = 0.5 kg (one car + box). Adjust if cart-size logic moves
 * the package weight beyond what a single courier slab covers.
 */
export async function getShiprocketServiceability(
  deliveryPincode: string,
  needsCod: boolean,
): Promise<ShiprocketServiceability | null> {
  if (!/^[1-9][0-9]{5}$/.test(deliveryPincode)) return null;

  const pickup = getPickupPincode();
  const url =
    `${API}/courier/serviceability/` +
    `?pickup_postcode=${pickup}` +
    `&delivery_postcode=${deliveryPincode}` +
    `&cod=${needsCod ? 1 : 0}` +
    `&weight=0.5`;

  try {
    const token = await getToken();
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      // Tight timeout — the checkout form blocks on this; better to fall
      // back to the heuristic than make the buyer wait.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      logError("shiprocket:serviceability", new Error(`${res.status} ${await res.text()}`));
      return null;
    }
    const json = (await res.json()) as ServiceabilityResp & { message?: string };
    const couriers = json.data?.available_courier_companies;
    if (couriers === undefined) {
      // No `data` block at all → Shiprocket rejected the REQUEST itself (e.g.
      // "Invalid Pickup Pincode"), NOT the customer's delivery PIN. This is an
      // OUR-side error — returning {serviceable:false} here would block every
      // customer for a config problem (the 2026-06-23 outage). Treat it like an
      // API failure → return null so the caller uses the permissive heuristic
      // and checkout stays open.
      logError(
        "shiprocket:serviceability",
        new Error(`no courier data (pickup=${pickup}): ${json.message ?? "unknown"}`),
      );
      return null;
    }
    if (couriers.length === 0) {
      // `data` present but the list is empty → this delivery PIN genuinely has
      // no courier. Fail closed for this PIN only.
      return { serviceable: false, codAvailable: false, etaMinDays: null, etaMaxDays: null };
    }
    const codCouriers = couriers.filter((c) => c.cod === 1);
    const etas = couriers
      .map((c) => Number(c.estimated_delivery_days))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      serviceable: true,
      codAvailable: codCouriers.length > 0,
      etaMinDays: etas.length ? Math.min(...etas) : null,
      etaMaxDays: etas.length ? Math.max(...etas) : null,
    };
  } catch (err) {
    logError("shiprocket:serviceability", err);
    return null;
  }
}

// ============================================================
// Types
// ============================================================

export type ShiprocketItem = {
  name: string;
  sku: string;
  units: number;
  selling_price: number;
  discount?: number;
  tax?: number;
  hsn?: string;
};

export type CreateShipmentInput = {
  /** Our order ID (PRC-XXXXXXXX). Shiprocket calls this `order_id`. */
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
  items: ShiprocketItem[];
  subtotalInr: number;
  paymentMethod: "Prepaid" | "COD";
  /** Box dimensions in cm + weight in kg. Defaults to small RC car parcel. */
  dimensions?: { lengthCm: number; breadthCm: number; heightCm: number; weightKg: number };
  /**
   * When false, ONLY create the Shiprocket order — do NOT auto-assign a courier
   * (AWB). The operator selects the courier and schedules pickup manually in the
   * Shiprocket dashboard. Used by the 1:16 store. Defaults true (1:64 keeps the
   * auto cheapest-surface assignment).
   */
  autoAssignAwb?: boolean;
};

export type ShiprocketOrderResponse = {
  order_id: number; // their internal id
  shipment_id: number;
  status: string;
  status_code: number;
  onboarding_completed_now: number;
  awb_code: string | null;
  courier_company_id: number | null;
  courier_name: string | null;
};

export type AssignAwbResponse = {
  awb_assign_status: number;
  response: {
    data: {
      courier_company_id: number;
      awb_code: string;
      courier_name: string;
      assigned_date_time: { date: string };
    };
  };
};

/**
 * Find the cheapest SURFACE courier for a pickup→delivery route. Returns the
 * courier_company_id to pass to /courier/assign/awb, or null to let Shiprocket
 * auto-pick (which defaults to expensive AIR). Surface is detected via the
 * `is_surface` flag, falling back to "name doesn't say Air". If no surface
 * option exists we return the cheapest of whatever's available.
 */
async function getCheapestSurfaceCourierId(
  deliveryPincode: string,
  weightKg: number,
  cod: 0 | 1,
): Promise<number | null> {
  const pickup = getPickupPincode();
  try {
    const data = await srFetch<{
      data?: {
        available_courier_companies?: Array<{
          courier_company_id: number;
          courier_name?: string;
          rate?: number;
          is_surface?: boolean | number;
        }>;
      };
    }>(
      `/courier/serviceability/?pickup_postcode=${pickup}&delivery_postcode=${deliveryPincode}&weight=${weightKg}&cod=${cod}`,
      { method: "GET" },
    );
    const couriers = data.data?.available_courier_companies ?? [];
    if (couriers.length === 0) return null;
    const surface = couriers.filter(
      (c) =>
        c.is_surface === true ||
        c.is_surface === 1 ||
        !/air/i.test(c.courier_name ?? "air"),
    );
    const pool = surface.length > 0 ? surface : couriers;
    pool.sort((a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity));
    return pool[0]?.courier_company_id ?? null;
  } catch (err) {
    // Never block shipment creation on serviceability — fall back to default.
    logError("shiprocket:cheapest-courier", err, { deliveryPincode });
    return null;
  }
}

// ============================================================
// Public helpers
// ============================================================

/**
 * Two-step shipment creation: create order, then assign an AWB courier.
 * Returns the final shipment metadata we save to our orders row.
 */
export async function createShipment(input: CreateShipmentInput): Promise<{
  shiprocketOrderId: string;
  shipmentId: string;
  awbCode: string | null;
  courierName: string | null;
  trackingUrl: string | null;
}> {
  // Trim: Shiprocket matches the pickup nickname EXACTLY, so a stray trailing
  // space in the env value (" warehouse" / "warehouse ") makes every create
  // fail with "Wrong Pickup location entered" — the same whitespace class of
  // bug that took down serviceability via SHIPROCKET_PICKUP_PINCODE (2026-06-23).
  const pickup = process.env.SHIPROCKET_PICKUP_LOCATION?.trim();
  if (!pickup) throw new Error("SHIPROCKET_PICKUP_LOCATION not set");

  // Real packaging is a 7×10 inch tamper-proof POLYBAG (flat), not a box.
  // Shiprocket bills the GREATER of actual weight and volumetric weight
  // (L×B×H ÷ 5000). The old 20×15×10 "box" declared a fake 10 cm height →
  // volumetric 0.6 kg → pushed every parcel into a higher weight slab (~₹150–
  // 290). The polybag is ~25×18×4 cm → volumetric 0.36 kg → falls under the
  // 0.5 kg surface minimum → cheapest slab (~₹95). A 1:64 / 88 mm die-cast +
  // polybag is ~0.15–0.3 kg actual, so 0.5 kg is the billed floor. (2026-06-23)
  const dims = input.dimensions ?? {
    lengthCm: 25, // 10 in
    breadthCm: 18, // 7 in
    heightCm: 4, // flat polybag with one small car
    weightKg: 0.3,
  };

  const nameParts = input.customer.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? input.customer.name;
  const lastName = nameParts.slice(1).join(" ") || ".";

  const body = {
    order_id: input.orderId,
    order_date: input.orderPlacedAt.toISOString().slice(0, 19).replace("T", " "),
    pickup_location: pickup,
    channel_id: "",
    comment: "",
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: input.customer.line1,
    billing_address_2: input.customer.line2 ?? "",
    billing_city: input.customer.city,
    billing_pincode: input.customer.pincode,
    billing_state: input.customer.state,
    billing_country: "India",
    billing_email: input.customer.email ?? "noreply@pocketrccars.com",
    billing_phone: input.customer.phone,
    shipping_is_billing: true,
    order_items: input.items,
    payment_method: input.paymentMethod,
    sub_total: input.subtotalInr,
    length: dims.lengthCm,
    breadth: dims.breadthCm,
    height: dims.heightCm,
    weight: dims.weightKg,
  };

  const order = await srFetch<ShiprocketOrderResponse>(
    "/orders/create/adhoc",
    { method: "POST", body: JSON.stringify(body) },
  );

  // Shiprocket intermittently answers HTTP 200 with NO order_id/shipment_id
  // (a transient rejection under load). Without this guard, String(undefined)
  // persisted the literal text "undefined" as the shiprocket id and the
  // shipment job was marked DONE — silently losing a PAID order, with no retry
  // and no alert (2026-06-23 incident: 3 paid orders vanished this way).
  // Throwing makes runShipmentJob treat it as a TRANSIENT failure → backoff +
  // retry, then an ops alert if it never succeeds.
  if (order?.order_id == null || order?.shipment_id == null) {
    throw new Error(
      `Shiprocket create returned no order_id/shipment_id (transient): ${JSON.stringify(order ?? {}).slice(0, 200)}`,
    );
  }

  // If AWB wasn't auto-assigned (most cases), call assign AWB — UNLESS the
  // caller opted out (autoAssignAwb === false, the 1:16 store), in which case
  // the order is left courier-less on Shiprocket for manual selection + pickup.
  let awbCode = order.awb_code;
  let courierName = order.courier_name;

  if (input.autoAssignAwb !== false && !awbCode && order.shipment_id) {
    try {
      // Pick the CHEAPEST SURFACE courier for the route. Without an explicit
      // courier_id, Shiprocket defaults to AIR (~₹200/parcel) instead of
      // Surface (~₹70) — a big margin hit on ₹999-1899 toys. We query
      // serviceability, drop air options, and assign the cheapest surface.
      // If serviceability fails we fall back to Shiprocket's default pick.
      const cod = input.paymentMethod === "COD" ? 1 : 0;
      const courierId = await getCheapestSurfaceCourierId(
        input.customer.pincode,
        dims.weightKg,
        cod,
      );
      const awbResp = await srFetch<AssignAwbResponse>(
        "/courier/assign/awb",
        {
          method: "POST",
          body: JSON.stringify(
            courierId
              ? { shipment_id: order.shipment_id, courier_id: courierId }
              : { shipment_id: order.shipment_id },
          ),
        },
      );
      awbCode = awbResp.response?.data?.awb_code ?? null;
      courierName = awbResp.response?.data?.courier_name ?? null;
    } catch (err) {
      // Order is still created on Shiprocket's side; admin can retry AWB
      // assignment manually. Use the typed logger so the raw err object
      // (which may echo back our auth token in its response body) never
      // reaches Vercel logs.
      logError("shiprocket:awb-assign", err, {
        shipmentId: String(order.shipment_id ?? ""),
      });
    }
  }

  return {
    shiprocketOrderId: String(order.order_id),
    shipmentId: String(order.shipment_id),
    awbCode,
    courierName,
    trackingUrl: awbCode
      ? `https://shiprocket.co/tracking/${awbCode}`
      : null,
  };
}

/**
 * Cancel an order on Shiprocket's side. Used when our DB rolls a "phantom
 * paid" order back to FAILED — leaving the Shiprocket order alive would risk
 * an actual pickup against goods we were never paid for.
 *
 * The cancel API takes the Shiprocket numeric order id (NOT our PRC-XXX),
 * because Shiprocket only indexes their own id post-creation.
 */
export async function cancelShiprocketOrder(
  shiprocketOrderId: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const data = await srFetch<{ message?: string; status_code?: number }>(
      "/orders/cancel",
      {
        method: "POST",
        body: JSON.stringify({ ids: [Number(shiprocketOrderId)] }),
      },
    );
    return { ok: true, message: data.message ?? "cancelled" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Status pings (used by manual refresh or admin override).
 */
export async function getShipmentStatus(shipmentId: string): Promise<{
  current_status: string;
  current_status_id: number;
  awb: string | null;
  courier: string | null;
}> {
  const data = await srFetch<{
    tracking_data: {
      shipment_track: Array<{
        current_status: string;
        current_status_id: number;
        awb_code: string | null;
        courier_company_name?: string | null;
      }>;
    };
  }>(`/courier/track/shipment/${shipmentId}`, { method: "GET" });

  const t = data.tracking_data?.shipment_track?.[0];
  return {
    current_status: t?.current_status ?? "Unknown",
    current_status_id: t?.current_status_id ?? 0,
    awb: t?.awb_code ?? null,
    courier: t?.courier_company_name?.trim() || null,
  };
}

// ============================================================
// Document generation — label / manifest / invoice / pickup
//
// Used by /pack so the packing employee never has to open the
// Shiprocket dashboard. Each helper hits a Shiprocket "generate"
// endpoint and returns a URL to a PDF Shiprocket hosts. The PDF
// link is short-lived (~hours) so we always re-fetch fresh on
// click rather than caching it on the order row.
// ============================================================

/**
 * Generate (or retrieve) the printable shipping label PDF for one or more
 * shipments. Shiprocket returns `label_url` — a direct link to the PDF.
 *
 * @param shipmentIds — Shiprocket shipment IDs (we store one per order
 *                     as orders.shiprocket_shipment_id).
 */
export async function generateShippingLabel(shipmentIds: string[]): Promise<{
  labelUrl: string | null;
  notCreated: number[];
}> {
  if (shipmentIds.length === 0) return { labelUrl: null, notCreated: [] };
  type Resp = {
    label_created: number;
    response: string;
    label_url?: string;
    not_created?: number[];
  };
  const data = await srFetch<Resp>("/courier/generate/label", {
    method: "POST",
    body: JSON.stringify({
      shipment_id: shipmentIds.map((s) => Number(s)),
    }),
  });
  return {
    labelUrl: data.label_url ?? null,
    notCreated: data.not_created ?? [],
  };
}

/**
 * Generate the daily pickup manifest PDF (courier signs this on collection).
 */
export async function generateManifest(shipmentIds: string[]): Promise<{
  manifestUrl: string | null;
}> {
  if (shipmentIds.length === 0) return { manifestUrl: null };
  type Resp = { manifest_url?: string; status?: number };
  const data = await srFetch<Resp>("/manifests/generate", {
    method: "POST",
    body: JSON.stringify({
      shipment_id: shipmentIds.map((s) => Number(s)),
    }),
  });
  return { manifestUrl: data.manifest_url ?? null };
}

/**
 * Schedule a courier pickup for the given shipments. Returns a
 * pickup_scheduled_date Shiprocket commits to.
 */
export async function schedulePickup(shipmentIds: string[]): Promise<{
  ok: boolean;
  pickupScheduledDate: string | null;
  message: string;
}> {
  if (shipmentIds.length === 0)
    return { ok: false, pickupScheduledDate: null, message: "no shipments" };
  type Resp = {
    pickup_status?: number;
    response?: { pickup_scheduled_date?: string; pickup_token_number?: number };
    message?: string;
  };
  try {
    const data = await srFetch<Resp>("/courier/generate/pickup", {
      method: "POST",
      body: JSON.stringify({
        shipment_id: shipmentIds.map((s) => Number(s)),
      }),
    });
    return {
      ok: data.pickup_status === 1,
      pickupScheduledDate: data.response?.pickup_scheduled_date ?? null,
      message: data.message ?? "ok",
    };
  } catch (err) {
    return {
      ok: false,
      pickupScheduledDate: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generate the printable tax invoice PDF for one or more Shiprocket orders.
 * NOTE: this uses Shiprocket's ORDER ids (not shipment ids).
 */
export async function generateInvoice(shiprocketOrderIds: string[]): Promise<{
  invoiceUrl: string | null;
}> {
  if (shiprocketOrderIds.length === 0) return { invoiceUrl: null };
  type Resp = { invoice_url?: string; not_created?: number[] };
  const data = await srFetch<Resp>("/orders/print/invoice", {
    method: "POST",
    body: JSON.stringify({
      ids: shiprocketOrderIds.map((s) => Number(s)),
    }),
  });
  return { invoiceUrl: data.invoice_url ?? null };
}

/**
 * Maps Shiprocket's status text to our order_status enum.
 * Reference: Shiprocket status codes 1-19+ for various states.
 *
 * ORDER IS LOAD-BEARING. Several Shiprocket strings contain "DELIVERED" as a
 * SUBSTRING while meaning the opposite of a successful delivery:
 *   - "RTO Delivered"  — the parcel was returned to origin and handed back to US
 *   - "Undelivered", "Undelivered-AT SOURCE HUB" — a delivery attempt FAILED
 * A naive `includes("DELIVERED")` first check (the original bug) marked all of
 * these as DELIVERED. For COD that silently books uncollected cash as revenue
 * and drives the /admin/returns RTO rate to a fake 0%. So the failure/return
 * cases MUST be tested before the plain-delivered case.
 */
export type MappedOrderStatus =
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "RETURNED"
  | "CANCELLED"
  | null;

export function mapShiprocketStatus(status: string): MappedOrderStatus {
  const s = (status ?? "").toUpperCase().trim();
  if (!s || s === "UNKNOWN") return null;

  // 1. Return-to-origin — ANY stage. "RTO Initiated/In Transit/Delivered/
  //    Acknowledged" and customer-initiated "Return*" all collapse to RETURNED,
  //    the only return-shaped terminal state our enum has. Checked first so
  //    "RTO Delivered" can never fall through to DELIVERED.
  if (s.includes("RTO") || s.includes("RETURN")) return "RETURNED";

  // 2. Cancelled (incl. the American "Canceled" Shiprocket actually emits).
  if (s.includes("CANCEL")) return "CANCELLED";

  // 3. Failed delivery attempt — the parcel is STILL with the courier and will
  //    be re-attempted or eventually RTO'd. It is NOT delivered and NOT yet
  //    returned, so it stays in flight as SHIPPED. Must precede the DELIVERED
  //    test because "UNDELIVERED" contains "DELIVERED".
  if (s.includes("UNDELIVERED") || s.includes("UNDELIVERD")) return "SHIPPED";

  // 4. Genuine successful delivery.
  if (s.includes("DELIVERED")) return "DELIVERED";

  // 5. In transit toward the customer.
  if (
    s.includes("OUT FOR DELIVERY") ||
    s.includes("SHIPPED") ||
    s.includes("IN TRANSIT") ||
    s.includes("INTRANSIT") ||
    s.includes("EN-ROUTE") ||
    s.includes("PICKED UP")
  ) {
    return "SHIPPED";
  }

  // 6. Handed to the courier / awaiting pickup — packed but not moving yet.
  if (
    s.includes("PICKUP SCHEDULED") ||
    s.includes("PICKUP GENERATED") ||
    s.includes("OUT FOR PICKUP") ||
    s.includes("PICKUP EXCEPTION") ||
    s.includes("READY TO SHIP") ||
    s.includes("AWB ASSIGNED")
  ) {
    return "PACKED";
  }

  return null;
}
