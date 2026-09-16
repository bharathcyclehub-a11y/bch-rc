/**
 * ANALYTICS SERVICE — the single source of truth for every audience metric.
 *
 * Every admin page (Dashboard, Analytics, Funnel) MUST read its numbers from
 * here. Before this file existed, each page rolled its own SQL and the three
 * disagreed with each other:
 *
 *   Dashboard "Visitors 7d"    3,510   DISTINCT visitor_id, analytics_sessions, IST window
 *   Analytics "Total"          3,510   (same)
 *   Funnel    "Visited site"   2,900   DISTINCT visitor_id, funnel_events, ROLLING now()-7d
 *
 * ── THE TWO TABLES ARE NOT INTERCHANGEABLE ─────────────────────────────────
 *
 *   analytics_sessions  server session records, one row per session. The
 *                       canonical source for visits captured by this app.
 *
 *   funnel_events       written CLIENT-SIDE by the batched browser beacon.
 *                       Ad-blockable, and lost when a visitor bounces before the
 *                       batch flushes. Coverage varies by date and browser.
 *
 * Never substitute event visitors for session visitors. Request ordering,
 * blocked beacons and sessions crossing midnight can make coverage differ.
 *
 * ── CANONICAL DEFINITIONS (do not mix them) ────────────────────────────────
 *
 *   VISITOR   one unique person/browser   COUNT(DISTINCT visitor_id)  analytics_sessions
 *   SESSION   one browsing session        COUNT(*)                    analytics_sessions
 *   PAGEVIEW  one page load               SUM(pageview_count)         analytics_sessions
 *   TRACKED   visitor who emitted client  COUNT(DISTINCT visitor_id)  funnel_events
 *   VISITOR   events (funnel steps only)  WHERE type='page_view'
 *   ORDER     one order row               COUNT(*)                    orders (PAID_STATUSES)
 *   BUYER     one distinct customer       COUNT(DISTINCT customer_id) orders
 *   CONVERSION  orders ÷ visitors
 *
 * Bots (is_bot) are excluded from every audience metric.
 *
 * ── ONE WINDOW ─────────────────────────────────────────────────────────────
 * analyticsWindow(days) is IST-day-aligned and INCLUSIVE of today, so `days`
 * buckets are returned. Every page must build its window from it. The funnel
 * previously used a rolling `now() - make_interval(days => N)`, which sliced
 * mid-day and disagreed with the other two pages even for the same metric.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PAID_STATUSES, VALID_ORDER_STATUSES } from "@/lib/order-status";
import { safePct } from "@/lib/analytics-validation";
import { fillSalesTimeSeries, type AnalyticsGranularity, type MetricWindow, type SalesTimePoint } from "@/lib/analytics-range";

export { analyticsWindow, MAX_WINDOW_DAYS } from "@/lib/analytics-range";
export type { MetricWindow } from "@/lib/analytics-range";

const num = (v: unknown): number => Number(v ?? 0) || 0;

/** `site_id = ANY(...)`. An empty list matches nothing → all-zero metrics. */
function siteArray(siteIds: string[]) {
  return sql`array[${sql.join(
    siteIds.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;
}

/** Optional upper bound, so a "previous period" can be [prevStart, start). */
function upper(column: string, to?: Date) {
  return to ? sql` AND ${sql.raw(column)} < ${to.toISOString()}` : sql``;
}

async function rows(q: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  return (await db.execute(q)) as unknown as Record<string, unknown>[];
}

// ── Audience ───────────────────────────────────────────────────────────────

export type Audience = {
  /** VISITOR — unique people. The number every page labels "Visitors". */
  visitors: number;
  /** SESSION — visits. Always >= visitors. */
  sessions: number;
  /** PAGEVIEW — observed page loads; blocked/missing events can leave a session at zero. */
  pageviews: number;
  /** Unique visitors since IST midnight today. */
  visitorsToday: number;
  /** Unique visitors seen within the live window. */
  liveVisitors: number;
};

const EMPTY_AUDIENCE: Audience = {
  visitors: 0,
  sessions: 0,
  pageviews: 0,
  visitorsToday: 0,
  liveVisitors: 0,
};

/**
 * Every session-derived audience metric in ONE round-trip. `todayStart` and
 * `liveSince` are optional dashboard extras. Without them, the selected start
 * date is used; live activity is measured by last_seen_at rather than arrival.
 */
export async function getAudience(
  siteIds: string[],
  opts: { from: Date; to?: Date; todayStart?: Date; liveSince?: Date },
): Promise<Audience> {
  if (siteIds.length === 0) return EMPTY_AUDIENCE;

  const sites = siteArray(siteIds);
  const from = opts.from.toISOString();
  const to = upper("started_at", opts.to);
  const todayIso = (opts.todayStart ?? opts.from).toISOString();
  const liveIso = (opts.liveSince ?? opts.from).toISOString();
  const earliestArrival = new Date(Math.min(opts.from.getTime(), (opts.todayStart ?? opts.from).getTime())).toISOString();

  const [r] = await rows(sql`
    SELECT
      count(DISTINCT visitor_id) FILTER (WHERE is_bot = false AND started_at >= ${from}${to})::int AS visitors,
      count(*)                   FILTER (WHERE is_bot = false AND started_at >= ${from}${to})::int AS sessions,
      coalesce(sum(pageview_count) FILTER (WHERE is_bot = false AND started_at >= ${from}${to}), 0)::int AS pageviews,
      count(DISTINCT visitor_id) FILTER (WHERE is_bot = false AND started_at >= ${todayIso}${to})::int AS visitors_today,
      count(DISTINCT visitor_id) FILTER (WHERE is_bot = false AND last_seen_at >= ${liveIso}${upper("last_seen_at", opts.to)})::int AS live_visitors
    FROM analytics_sessions
    WHERE site_id = ANY(${sites})
      AND ((started_at >= ${earliestArrival}${to}) OR (last_seen_at >= ${liveIso}${upper("last_seen_at", opts.to)}))
  `);

  return {
    visitors: num(r?.visitors),
    sessions: num(r?.sessions),
    pageviews: num(r?.pageviews),
    visitorsToday: num(r?.visitors_today),
    liveVisitors: num(r?.live_visitors),
  };
}

/** VISITOR — the canonical count. Use this everywhere the word "visitors" appears. */
export async function getVisitors(
  siteIds: string[],
  from: Date,
  to?: Date,
): Promise<number> {
  if (siteIds.length === 0) return 0;
  const [r] = await rows(sql`
    SELECT count(DISTINCT visitor_id)::int AS c
    FROM analytics_sessions
    WHERE site_id = ANY(${siteArray(siteIds)})
      AND is_bot = false
      AND started_at >= ${from.toISOString()}${upper("started_at", to)}
  `);
  return num(r?.c);
}

/** SESSION — visits, not people. */
export async function getSessions(
  siteIds: string[],
  from: Date,
  to?: Date,
): Promise<number> {
  if (siteIds.length === 0) return 0;
  const [r] = await rows(sql`
    SELECT count(*)::int AS c
    FROM analytics_sessions
    WHERE site_id = ANY(${siteArray(siteIds)})
      AND is_bot = false
      AND started_at >= ${from.toISOString()}${upper("started_at", to)}
  `);
  return num(r?.c);
}

/**
 * Visitors in the window who were ALSO seen before it. `new = visitors - returning`.
 */
export async function getReturningVisitors(
  siteIds: string[],
  from: Date,
  to?: Date,
): Promise<number> {
  if (siteIds.length === 0) return 0;
  const sites = siteArray(siteIds);
  const iso = from.toISOString();
  const [r] = await rows(sql`
    SELECT count(DISTINCT a.visitor_id)::int AS c
    FROM analytics_sessions a
    WHERE a.site_id = ANY(${sites}) AND a.is_bot = false AND a.started_at >= ${iso}${upper("a.started_at", to)}
      AND EXISTS (
        SELECT 1 FROM analytics_sessions b
        WHERE b.visitor_id = a.visitor_id
          AND b.site_id = ANY(${sites}) AND b.is_bot = false
          AND b.started_at < ${iso}
      )
  `);
  return num(r?.c);
}

/**
 * TRACKED VISITORS — visitors who emitted a client-side `page_view` event.
 * ONLY for computing funnel-event coverage. Never label this "visitors".
 */
export async function getTrackedVisitors(
  siteIds: string[],
  from: Date,
  to?: Date,
): Promise<number> {
  if (siteIds.length === 0) return 0;
  const [r] = await rows(sql`
    SELECT count(DISTINCT visitor_id)::int AS c
    FROM funnel_events
    WHERE site_id = ANY(${siteArray(siteIds)})
      AND is_bot = false AND type = 'page_view'
      AND created_at >= ${from.toISOString()}${upper("created_at", to)}
  `);
  return num(r?.c);
}

// ── Commerce ───────────────────────────────────────────────────────────────

export type OrderMetrics = {
  /** ORDER — order rows with a paid status. */
  orders: number;
  /** Active order value in INR by placed_at; includes COD awaiting collection. */
  revenue: number;
  /** BUYER — distinct customers with a real (non-failed) order. */
  buyers: number;
  /** BUYER — distinct customers with a paid order. Always <= buyers. */
  paidBuyers: number;
};

const EMPTY_ORDERS: OrderMetrics = { orders: 0, revenue: 0, buyers: 0, paidBuyers: 0 };

export async function getOrderMetrics(
  siteIds: string[],
  from: Date,
  to?: Date,
): Promise<OrderMetrics> {
  if (siteIds.length === 0) return EMPTY_ORDERS;

  const paid = sql.join(PAID_STATUSES.map((s) => sql`${s}`), sql`, `);
  const valid = sql.join(VALID_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `);

  const [r] = await rows(sql`
    SELECT
      count(*) FILTER (WHERE status IN (${paid}))::int AS orders,
      coalesce(sum(total_inr) FILTER (WHERE status IN (${paid})), 0)::bigint AS revenue,
      count(DISTINCT customer_id) FILTER (WHERE status IN (${valid}))::int AS buyers,
      count(DISTINCT customer_id) FILTER (WHERE status IN (${paid}))::int AS paid_buyers
    FROM orders
    WHERE site_id = ANY(${siteArray(siteIds)})
      AND placed_at >= ${from.toISOString()}${upper("placed_at", to)}
  `);

  return {
    orders: num(r?.orders),
    revenue: num(r?.revenue),
    buyers: num(r?.buyers),
    paidBuyers: num(r?.paid_buyers),
  };
}

/**
 * Active sales by order-placement date. Uses the same status set and bounds
 * as getOrderMetrics. Returns every calendar bucket, including zero sales.
 * Customers are profiles first created in the period, not distinct buyers.
 */
export async function getSalesTimeSeries(
  siteIds: string[],
  window: MetricWindow,
  granularity: AnalyticsGranularity = "day",
): Promise<SalesTimePoint[]> {
  if (siteIds.length === 0) return fillSalesTimeSeries(window, granularity, [], []);
  const sites = siteArray(siteIds);
  const paid = sql.join(PAID_STATUSES.map((s) => sql`${s}`), sql`, `);
  const [sales, customers] = await Promise.all([
    rows(sql`
      SELECT to_char(date_trunc(${granularity}, placed_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS key,
             count(*)::int AS orders, coalesce(sum(total_inr), 0)::bigint AS revenue
      FROM orders
      WHERE site_id = ANY(${sites}) AND status IN (${paid})
        AND placed_at >= ${window.start.toISOString()} AND placed_at < ${window.end.toISOString()}
      GROUP BY 1 ORDER BY 1
    `),
    rows(sql`
      SELECT to_char(date_trunc(${granularity}, created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS key,
             count(*)::int AS customers
      FROM customers
      WHERE first_site_id = ANY(${sites})
        AND created_at >= ${window.start.toISOString()} AND created_at < ${window.end.toISOString()}
      GROUP BY 1 ORDER BY 1
    `),
  ]);
  return fillSalesTimeSeries(
    window, granularity,
    sales.map((row) => ({ key: String(row.key), revenue: num(row.revenue), orders: num(row.orders) })),
    customers.map((row) => ({ key: String(row.key), customers: num(row.customers) })),
  );
}

/** CONVERSION — paid orders ÷ unique visitors, as a percentage. */
export function getConversion(orders: number, visitors: number): number {
  return safePct(orders, visitors);
}

/** Average order value, guarded against a zero denominator. */
export function getAov(revenue: number, orders: number): number {
  return orders > 0 ? Math.round(revenue / orders) : 0;
}

// ── Phase 8: sanity validation ─────────────────────────────────────────────

export type SanityInput = {
  visitors?: number;
  sessions?: number;
  pageviews?: number;
  trackedVisitors?: number;
  orders?: number;
  buyers?: number;
  paidBuyers?: number;
};

/**
 * Metric checks: cardinality invariants plus cross-source coverage anomalies.
 * Coverage warnings can also reflect missing requests or sessions that began
 * before midnight; they are not proof of database corruption.
 */
export function checkMetricSanity(m: SanityInput): string[] {
  const w: string[] = [];
  const has = (x?: number): x is number => typeof x === "number";

  if (has(m.visitors) && has(m.sessions) && m.visitors > m.sessions)
    w.push(`visitors (${m.visitors}) > sessions (${m.sessions}) — a person cannot have fewer visits than themselves.`);

  if (has(m.trackedVisitors) && has(m.visitors) && m.trackedVisitors > m.visitors)
    w.push(`tracked visitors (${m.trackedVisitors}) > visitors (${m.visitors}) — inspect session/event coverage and sessions crossing the selected boundary.`);

  if (has(m.paidBuyers) && has(m.buyers) && m.paidBuyers > m.buyers)
    w.push(`paid buyers (${m.paidBuyers}) > buyers (${m.buyers}) — PAID_STATUSES must be a subset of VALID_ORDER_STATUSES.`);

  if (has(m.paidBuyers) && has(m.orders) && m.paidBuyers > m.orders)
    w.push(`paid buyers (${m.paidBuyers}) > paid orders (${m.orders}) — a buyer places at least one order.`);

  return w;
}

/** Dev-only: shout about impossible states instead of rendering them silently. */
export function warnIfInsane(context: string, m: SanityInput): void {
  if (process.env.NODE_ENV === "production") return;
  for (const msg of checkMetricSanity(m)) {
    console.warn(`[analytics-sanity:${context}] ${msg}`);
  }
}
