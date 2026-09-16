/**
 * Client-side analytics — thin wrapper over GA4 `gtag`, Meta Pixel `fbq`,
 * and our server-side CAPI relay (/api/track/meta).
 *
 * Key design choice: every event gets a shared `event_id` (a UUID). The
 * Pixel and CAPI both report the same event to Meta with that ID; Meta
 * dedups them so the event counts ONCE in your dashboard regardless of
 * whether the browser pixel was blocked by an ad-blocker, iOS ITP, Brave,
 * or just a slow network. Without dedup we'd double-count. With dedup we
 * recover the ~30-50% of conversions browser pixels lose.
 *
 * The functions in this module are no-ops if:
 *  - the user hasn't accepted consent (the banner sets prc_consent=accepted)
 *  - the relevant env var (NEXT_PUBLIC_GA_ID / NEXT_PUBLIC_META_PIXEL_ID)
 *    isn't set
 *  - the call is happening on the server (typeof window === "undefined")
 *
 * So mounting <Analytics /> at the layout root is safe even before Syed
 * gives us the IDs — nothing fires until the env vars land.
 */

declare global {
  interface Window {
    clarity?: (command: string, ...args: unknown[]) => void;
    gtag?: (
      command: string,
      eventName: string,
      params?: Record<string, unknown>,
    ) => void;
    fbq?: (
      command: "init" | "track" | "trackCustom",
      eventName: string,
      params?: Record<string, unknown>,
      opts?: { eventID?: string },
    ) => void;
  }
}

export type PurchaseEventInput = {
  orderId: string;
  totalInr: number;
  itemCount: number;
  paymentMethod: "UPI" | "CARD" | "NETBANKING" | "WALLET" | "COD";
  /** Plain email — hashed server-side before sending to Meta. */
  email?: string | null;
  /** Plain phone (digits only) — hashed server-side. */
  phone?: string | null;
  contents?: Array<{
    sku: string;
    quantity: number;
    item_price: number;
    name?: string;
  }>;
};

export type AddToCartEventInput = {
  sku: string;
  name: string;
  priceInr: number;
  quantity?: number;
};

const CONSENT_KEY = "prc_consent";

export function consentGranted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

/** UUID — Web Crypto if available, RFC 4122-style fallback otherwise. */
function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "evt_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Post the same event to our CAPI relay so Meta receives it from our
 * server even if the browser pixel was blocked. The relay does the SHA256
 * hashing of email/phone (Meta requires hashed identifiers) and the actual
 * Graph API call.
 */
async function postToCapi(input: {
  eventName: string;
  eventId: string;
  eventTime: number;
  customData?: Record<string, unknown>;
  userData?: { email?: string | null; phone?: string | null };
  sourceUrl: string;
}): Promise<void> {
  try {
    await fetch("/api/track/meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, consent: "accepted" }),
      keepalive: true,
    });
  } catch {
    // Best-effort. CAPI failures must never affect the user's flow.
  }
}

export function trackPageView(path?: string, channels: { ga?: boolean; meta?: boolean } = { ga: true, meta: true }): void {
  if (typeof window === "undefined") return;
  // GA fires for everyone — Consent Mode keeps it cookieless until consent.
  if (channels.ga) window.gtag?.("event", "page_view", { page_path: path ?? window.location.pathname });
  // Pixel + CAPI share identifying data → opt-in only.
  if (!channels.meta || !consentGranted()) return;
  const eventId = newEventId();
  window.fbq?.("track", "PageView", undefined, { eventID: eventId });
  void postToCapi({
    eventName: "PageView",
    eventId,
    eventTime: Math.floor(Date.now() / 1000),
    sourceUrl: window.location.href,
  });
}

export function trackAddToCart(input: AddToCartEventInput): void {
  if (typeof window === "undefined") return;
  const value = input.priceInr * (input.quantity ?? 1);
  window.gtag?.("event", "add_to_cart", {
    currency: "INR",
    value,
    items: [
      {
        item_id: input.sku,
        item_name: input.name,
        price: input.priceInr,
        quantity: input.quantity ?? 1,
      },
    ],
  });
  if (!consentGranted()) return;
  const eventId = newEventId();
  window.fbq?.(
    "track",
    "AddToCart",
    {
      content_ids: [input.sku],
      content_name: input.name,
      content_type: "product",
      currency: "INR",
      value,
    },
    { eventID: eventId },
  );
  void postToCapi({
    eventName: "AddToCart",
    eventId,
    eventTime: Math.floor(Date.now() / 1000),
    customData: {
      content_ids: [input.sku],
      content_name: input.name,
      content_type: "product",
      currency: "INR",
      value,
    },
    sourceUrl: window.location.href,
  });
}

export function trackInitiateCheckout(subtotalInr: number): void {
  if (typeof window === "undefined") return;
  window.gtag?.("event", "begin_checkout", { currency: "INR", value: subtotalInr });
  if (!consentGranted()) return;
  const eventId = newEventId();
  window.fbq?.(
    "track",
    "InitiateCheckout",
    { currency: "INR", value: subtotalInr },
    { eventID: eventId },
  );
  void postToCapi({
    eventName: "InitiateCheckout",
    eventId,
    eventTime: Math.floor(Date.now() / 1000),
    customData: { currency: "INR", value: subtotalInr },
    sourceUrl: window.location.href,
  });
}

export function trackPurchase(input: PurchaseEventInput, channels: { ga?: boolean; meta?: boolean } = { ga: true, meta: true }): void {
  if (typeof window === "undefined") return;
  // GA purchase fires for everyone (cookieless-modeled until consent) so
  // revenue + conversion data is never lost. Meta Pixel/CAPI — which also
  // carries hashed email/phone — stays opt-in.
  if (channels.ga) window.gtag?.("event", "purchase", {
    transaction_id: input.orderId,
    currency: "INR",
    value: input.totalInr,
    payment_type: input.paymentMethod,
    items: input.contents?.map((c) => ({
      item_id: c.sku,
      item_name: c.name ?? c.sku,
      price: c.item_price,
      quantity: c.quantity,
    })),
  });
  if (!channels.meta || !consentGranted()) return;
  const eventId = `purchase:${input.orderId}`;
  window.fbq?.(
    "track",
    "Purchase",
    {
      content_ids: input.contents?.map((c) => c.sku),
      content_type: "product",
      currency: "INR",
      value: input.totalInr,
      num_items: input.itemCount,
      contents: input.contents,
    },
    { eventID: eventId },
  );
  void postToCapi({
    eventName: "Purchase",
    eventId,
    eventTime: Math.floor(Date.now() / 1000),
    customData: {
      currency: "INR",
      value: input.totalInr,
      order_id: input.orderId,
      content_ids: input.contents?.map((c) => c.sku),
      num_items: input.itemCount,
      contents: input.contents,
    },
    userData: { email: input.email ?? null, phone: input.phone ?? null },
    sourceUrl: window.location.href,
  });
}
