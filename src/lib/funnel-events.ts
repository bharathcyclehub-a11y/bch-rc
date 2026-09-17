/**
 * Funnel event vocabulary — the single source of truth for every user action
 * we record. Pure + dependency-free so it can be imported from client
 * components, the edge, and node routes alike.
 *
 * The ORDER of FUNNEL_STAGES is the canonical conversion path; the dashboard
 * renders drop-off between consecutive stages. Some events (payment_failed,
 * payment_cancelled, serviceability blocked) are NOT stages — they are
 * "leak" reasons that explain WHY a visitor fell out between two stages.
 */

export const FUNNEL_EVENTS = [
  "page_view", // any storefront page (path in `path`)
  "product_view", // a PDP / product card detail opened
  "add_to_cart", // added an item (also fired by Buy-Now)
  "view_cart", // opened the cart drawer
  "checkout_started", // landed on /checkout with a non-empty cart
  "serviceability_checked", // pincode checked (metadata.serviceable true/false)
  "payment_method_selected", // chose UPI/prepaid vs COD
  "order_submitted", // /api/orders/create succeeded (order row exists)
  "razorpay_opened", // Razorpay modal opened
  "payment_succeeded", // payment captured client-side
  "payment_failed", // Razorpay reported a failure (metadata.reason)
  "payment_cancelled", // customer dismissed the Razorpay modal
  "purchase", // order success page reached
  // --- engagement / leak signals (not funnel stages) ---
  "hero_cta_click", // tapped the hero primary CTA (metadata.variant)
  "whatsapp_click", // left to WhatsApp chat (metadata.placement: fab|header)
  // --- spin-wheel lead capture (hub "drift for your discount") ---
  "wheel_open", // popup shown (metadata.via: auto|tab)
  "wheel_spin", // tapped HIT THE THROTTLE (drifted)
  "wheel_lead", // claimed the code (metadata.code) — NO raw phone stored here
  "wheel_wa_claim", // tapped "send code to WhatsApp"
  // --- "Name your price" bargain game (exit-intent haggle) ---
  "bargain_ab", // A/B bucket assigned for this session (metadata.bucket: on|off)
  "bargain_open", // modal shown (metadata.trigger: back|idle|return|manual, skuId)
  "bargain_seen_no_play", // modal closed without ever making a guess
  "bargain_guess", // submitted a guess (metadata.outcome: close|low|won|lost)
  "bargain_won", // won a price (metadata.skuId, discountInr) — no code/PII here
  "bargain_lost", // used all 3 guesses without winning
  "bargain_checkout", // tapped "Buy now" → went to checkout with the won code
  "bargain_coupon_applied", // a BG- coupon validated at checkout (metadata.discountInr)
  "bargain_payment_success", // order paid on a BG- coupon (attribution; orders table is authoritative)
] as const;

export type FunnelEventType = (typeof FUNNEL_EVENTS)[number];

const FUNNEL_EVENT_SET = new Set<string>(FUNNEL_EVENTS);
export function isFunnelEvent(t: string): t is FunnelEventType {
  return FUNNEL_EVENT_SET.has(t);
}

/**
 * The ordered conversion funnel shown on the dashboard. Each stage maps to the
 * event(s) that mark a visitor as having reached it. A visitor counts toward a
 * stage if they fired ANY of its events at least once in the window.
 */
export type FunnelStage = {
  key: string;
  label: string;
  /** Events that count as reaching this stage. */
  events: FunnelEventType[];
};

// The top four stages are distinct-visitor counts from funnel_events; the bottom
// two ("order", "paid") are sourced from the ORDERS TABLE in getFunnelReport
// (authoritative — order_submitted/purchase events undercount real orders, which
// made the funnel show a false checkout→order cliff). The old "pincode" and
// "pay_open" event stages were dropped from the linear funnel: serviceability
// has its own panel, and "opened payment" was a noisy intermediate that broke
// the funnel shape once orders became real counts.
export const FUNNEL_STAGES: FunnelStage[] = [
  { key: "visit", label: "Visited site", events: ["page_view"] },
  { key: "product", label: "Viewed a product", events: ["product_view"] },
  { key: "cart", label: "Added to cart", events: ["add_to_cart"] },
  { key: "checkout", label: "Started checkout", events: ["checkout_started"] },
  { key: "order", label: "Placed order", events: ["order_submitted"] },
  { key: "paid", label: "Sale buyers", events: ["payment_succeeded", "purchase"] },
];

/** Max events accepted in a single ingest batch (abuse guard). */
export const MAX_FUNNEL_BATCH = 30;
/** Keep each beacon under the browser's shared keepalive request quota. */
export const MAX_FUNNEL_BODY_BYTES = 48 * 1024;

/** Client event/session IDs must use the same UUID format as the database. */
/**
 * v4 UUID that also works on plain-HTTP pages. `crypto.randomUUID` exists only
 * in secure contexts (HTTPS / localhost); `crypto.getRandomValues` exists in
 * all of them, so the fallback stays a real UUID that passes isTrackingUuid.
 */
export function newTrackingUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isTrackingUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Only event dimensions used by the storefront may enter the event ledger. */
const METADATA_KEYS = new Set([
  "skuId", "sku", "qty", "quantity", "valueInr", "cartValueInr", "itemCount",
  "subtotalInr", "totalInr", "amountInr", "discountInr", "pincode", "serviceable",
  "codAvailable", "paymentMethod", "method", "reason", "failureReason", "variant",
  "placement", "via", "code", "bucket", "trigger", "outcome", "attempt", "guessInr",
]);

export function cleanFunnelMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!METADATA_KEYS.has(key)) continue;
    if (typeof item === "string") {
      // Payment providers sometimes include customer contact details in errors.
      result[key] = item.slice(0, 200).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted]").replace(/\b\d{10,15}\b/g, "[redacted]");
    } else if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
      result[key] = item;
    }
  }
  return result;
}

/** Query strings can contain contact information and order access tokens. */
export function cleanTrackingPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return value.split(/[?#]/, 1)[0].slice(0, 512);
}
