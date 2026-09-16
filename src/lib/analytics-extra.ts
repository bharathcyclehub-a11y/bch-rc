/**
 * Additive analytics aggregations — powers the sections that were COLLECTED but
 * never SHOWN (coupon performance, marketing engagement, checkout analytics,
 * per-SKU product funnel).
 *
 * CONSISTENCY: every function here takes the SAME `windowStart` the Analytics
 * page already builds from `analyticsWindow(range)`, and reuses the SAME
 * `PAID_STATUSES` as `analytics-service.ts` and `funnel-queries.ts`. So
 * revenue/orders/visitor numbers match every other page by construction —
 * there is no second source of truth introduced here.
 *
 * Data sources (all already written by the live app):
 *   • orders               — coupon_code, discount_inr, total_inr, status  (authoritative)
 *   • funnel_events        — product_view / add_to_cart / checkout_* / payment_*
 *                            / engagement events (client beacon, no PII)
 * Server-only.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PAID_STATUSES } from "@/lib/order-status";

const num = (v: unknown): number => Number(v ?? 0) || 0;

/** `site_id = ANY(...)` — mirrors analytics-service.siteArray (not exported there). */
function siteArray(siteIds: string[]) {
  return sql`array[${sql.join(
    siteIds.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;
}

async function rows(q: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  return (await db.execute(q)) as unknown as Record<string, unknown>[];
}

const paidList = sql.join(PAID_STATUSES.map((s) => sql`${s}`), sql`, `);

function upper(column: "placed_at" | "created_at", to?: Date) {
  return to ? sql` AND ${sql.raw(column)} < ${to.toISOString()}` : sql``;
}

// ── Coupon performance ───────────────────────────────────────────────────────
// Every field is derived from the orders ledger, so it reconciles with Revenue.

export type CouponRow = {
  code: string;
  applied: number; // orders that carried this code (any status)
  redeemed: number; // paid orders
  failed: number; // applied − redeemed (applied but never paid)
  convPct: number; // redeemed / applied
  revenue: number; // paid revenue on this code
  discount: number; // realized discount on paid orders
};

export type CouponPerformance = {
  rows: CouponRow[];
  totals: { applied: number; redeemed: number; revenue: number; discount: number };
};

export async function getCouponPerformance(
  siteIds: string[],
  windowStart: Date,
  windowEnd?: Date,
): Promise<CouponPerformance> {
  if (siteIds.length === 0) return { rows: [], totals: { applied: 0, redeemed: 0, revenue: 0, discount: 0 } };

  const r = await rows(sql`
    SELECT
      coupon_code AS code,
      count(*)::int AS applied,
      count(*) FILTER (WHERE status IN (${paidList}))::int AS redeemed,
      coalesce(sum(total_inr)    FILTER (WHERE status IN (${paidList})), 0)::bigint AS revenue,
      coalesce(sum(discount_inr) FILTER (WHERE status IN (${paidList})), 0)::bigint AS discount
    FROM orders
    WHERE site_id = ANY(${siteArray(siteIds)})
      AND placed_at >= ${windowStart.toISOString()}${upper("placed_at", windowEnd)}
      AND coupon_code IS NOT NULL AND coupon_code <> ''
    GROUP BY coupon_code
    ORDER BY revenue DESC, applied DESC
  `);

  const list: CouponRow[] = r.map((row) => {
    const applied = num(row.applied);
    const redeemed = num(row.redeemed);
    return {
      code: String(row.code),
      applied,
      redeemed,
      failed: Math.max(0, applied - redeemed),
      convPct: applied > 0 ? Math.round((redeemed / applied) * 100) : 0,
      revenue: num(row.revenue),
      discount: num(row.discount),
    };
  });

  return {
    rows: list,
    totals: {
      applied: list.reduce((a, c) => a + c.applied, 0),
      redeemed: list.reduce((a, c) => a + c.redeemed, 0),
      revenue: list.reduce((a, c) => a + c.revenue, 0),
      discount: list.reduce((a, c) => a + c.discount, 0),
    },
  };
}

// ── Marketing engagement ─────────────────────────────────────────────────────
// Raw counts + unique visitors for the engagement events already in the stream.

// Only the keys the analytics page actually renders (ENGAGEMENT_DISPLAY).
const ENGAGEMENT_TYPES = [
  "hero_cta_click",
  "whatsapp_click",
  "wheel_open",
  "wheel_spin",
  "wheel_lead",
  "bargain_open",
  "bargain_won",
  "bargain_checkout",
] as const;

export type EngagementCounts = Record<string, { events: number; visitors: number }>;

export async function getEngagementEvents(
  siteIds: string[],
  windowStart: Date,
  windowEnd?: Date,
): Promise<EngagementCounts> {
  if (siteIds.length === 0) return {};
  const typeList = sql.join(ENGAGEMENT_TYPES.map((t) => sql`${t}`), sql`, `);
  const r = await rows(sql`
    SELECT type,
           count(*)::int AS events,
           count(DISTINCT visitor_id)::int AS visitors
    FROM funnel_events
    WHERE site_id = ANY(${siteArray(siteIds)})
      AND is_bot = false
      AND created_at >= ${windowStart.toISOString()}${upper("created_at", windowEnd)}
      AND type IN (${typeList})
    GROUP BY type
  `);
  const out: EngagementCounts = {};
  for (const row of r) out[String(row.type)] = { events: num(row.events), visitors: num(row.visitors) };
  return out;
}

// ── Checkout analytics ───────────────────────────────────────────────────────
// The checkout micro-funnel + payment method mix + failure reasons — all from
// the payment lifecycle events already captured client-side.

export type CheckoutAnalytics = {
  stages: {
    checkoutStarted: number;
    paymentMethodSelected: number;
    razorpayOpened: number;
    paymentSucceeded: number;
    paymentFailed: number;
    paymentCancelled: number;
  };
  methods: Array<{ method: string; n: number }>;
  failureReasons: Array<{ reason: string; n: number }>;
};

export async function getCheckoutAnalytics(
  siteIds: string[],
  windowStart: Date,
  windowEnd?: Date,
): Promise<CheckoutAnalytics> {
  const empty: CheckoutAnalytics = {
    stages: {
      checkoutStarted: 0, paymentMethodSelected: 0, razorpayOpened: 0,
      paymentSucceeded: 0, paymentFailed: 0, paymentCancelled: 0,
    },
    methods: [],
    failureReasons: [],
  };
  if (siteIds.length === 0) return empty;
  const sites = siteArray(siteIds);
  const from = windowStart.toISOString();

  const [stageRows, methodRows, failRows] = await Promise.all([
    rows(sql`
      SELECT
        count(DISTINCT visitor_id) FILTER (WHERE type = 'checkout_started')::int AS checkout_started,
        count(DISTINCT visitor_id) FILTER (WHERE type = 'payment_method_selected')::int AS payment_method_selected,
        count(DISTINCT visitor_id) FILTER (WHERE type = 'razorpay_opened')::int AS razorpay_opened,
        count(DISTINCT visitor_id) FILTER (WHERE type = 'payment_succeeded')::int AS payment_succeeded,
        count(*) FILTER (WHERE type = 'payment_failed')::int AS payment_failed,
        count(*) FILTER (WHERE type = 'payment_cancelled')::int AS payment_cancelled
      FROM funnel_events
      WHERE site_id = ANY(${sites}) AND is_bot = false AND created_at >= ${from}${upper("created_at", windowEnd)}
    `),
    rows(sql`
      SELECT coalesce(nullif(metadata->>'method',''), 'unknown') AS method, count(*)::int AS n
      FROM funnel_events
      WHERE site_id = ANY(${sites}) AND is_bot = false AND created_at >= ${from}${upper("created_at", windowEnd)}
        AND type = 'payment_method_selected'
      GROUP BY 1 ORDER BY n DESC
    `),
    rows(sql`
      SELECT coalesce(nullif(metadata->>'reason',''), '(no reason given)') AS reason, count(*)::int AS n
      FROM funnel_events
      WHERE site_id = ANY(${sites}) AND is_bot = false AND created_at >= ${from}${upper("created_at", windowEnd)}
        AND type = 'payment_failed'
      GROUP BY 1 ORDER BY n DESC LIMIT 8
    `),
  ]);

  const s = stageRows[0] ?? {};
  return {
    stages: {
      checkoutStarted: num(s.checkout_started),
      paymentMethodSelected: num(s.payment_method_selected),
      razorpayOpened: num(s.razorpay_opened),
      paymentSucceeded: num(s.payment_succeeded),
      paymentFailed: num(s.payment_failed),
      paymentCancelled: num(s.payment_cancelled),
    },
    methods: methodRows.map((r) => ({ method: String(r.method), n: num(r.n) })),
    failureReasons: failRows.map((r) => ({ reason: String(r.reason), n: num(r.n) })),
  };
}

// ── Per-SKU product funnel (views → cart, from the beacon) ────────────────────
// Purchased units come from the orders.items aggregation the page already does,
// so this only supplies the pre-purchase behavioural half. Merged in the page.

export type ProductFunnelRow = {
  skuId: string;
  name: string;
  views: number; // distinct visitors who opened the PDP/card
  addToCart: number; // distinct visitors who added it
};

export async function getProductFunnel(
  siteIds: string[],
  windowStart: Date,
  windowEnd?: Date,
): Promise<ProductFunnelRow[]> {
  if (siteIds.length === 0) return [];
  const r = await rows(sql`
    SELECT
      metadata->>'skuId' AS sku,
      (array_agg(metadata->>'name') FILTER (WHERE metadata->>'name' IS NOT NULL))[1] AS name,
      count(DISTINCT visitor_id) FILTER (WHERE type = 'product_view')::int AS views,
      count(DISTINCT visitor_id) FILTER (WHERE type = 'add_to_cart')::int AS carts
    FROM funnel_events
    WHERE site_id = ANY(${siteArray(siteIds)})
      AND is_bot = false
      AND created_at >= ${windowStart.toISOString()}${upper("created_at", windowEnd)}
      AND type IN ('product_view', 'add_to_cart')
      AND metadata->>'skuId' IS NOT NULL AND metadata->>'skuId' <> ''
    GROUP BY 1
    ORDER BY views DESC
    LIMIT 100
  `);
  return r.map((row) => ({
    skuId: String(row.sku),
    name: String(row.name ?? row.sku),
    views: num(row.views),
    addToCart: num(row.carts),
  }));
}
