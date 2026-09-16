import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { MetricWindow } from "@/lib/analytics-range";

export type QualityCheck = { key: string; label: string; count: number; explanation: string };
export type QualityReport = {
  checkedAt: string;
  ordersChecked: number;
  sessionsChecked: number;
  eventsChecked: number;
  history: Array<{ source: string; first: string | null; latest: string | null }>;
  checks: QualityCheck[];
};

/** Read-only aggregates. Call only after admin authentication and pass its site scope. */
export async function getAnalyticsQuality(siteIds: string[], window: MetricWindow): Promise<QualityReport> {
  const sites = sql`array[${sql.join(siteIds.map((id) => sql`${id}`), sql`, `)}]::text[]`;
  const from = window.start.toISOString();
  const to = window.end.toISOString();
  const [orderResult, eventResult, historyResult] = await Promise.all([
    db.execute(sql`
      WITH scoped AS (
        SELECT * FROM orders WHERE site_id = ANY(${sites}) AND placed_at >= ${from} AND placed_at < ${to}
      )
      SELECT count(*)::int AS orders,
        count(*) FILTER (WHERE total_inr <> subtotal_inr + shipping_inr + cod_fee_inr - discount_inr)::int AS totals_mismatch,
        count(*) FILTER (WHERE total_inr < 0 OR subtotal_inr < 0 OR shipping_inr < 0 OR cod_fee_inr < 0 OR discount_inr < 0 OR confirmation_fee_inr < 0 OR confirmation_fee_inr > total_inr)::int AS invalid_amounts,
        count(*) FILTER (WHERE jsonb_typeof(items) <> 'array' OR items = '[]'::jsonb OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) item
          WHERE jsonb_typeof(item) <> 'object' OR coalesce(item->>'skuId', '') = ''
            OR coalesce(item->>'qty', '') !~ '^[1-9][0-9]*$'
            OR coalesce(item->>'lineTotalInr', '') !~ '^[0-9]+$'
        ))::int AS invalid_items,
        count(*) FILTER (WHERE payment_method <> 'COD' AND status IN ('PAID','PACKED','SHIPPED','DELIVERED') AND payment_status <> 'CAPTURED')::int AS payment_state,
        count(*) FILTER (WHERE payment_status = 'CAPTURED' AND status IN ('FAILED','ABANDONED','CANCELLED'))::int AS captured_inactive,
        count(*) FILTER (WHERE status = 'PENDING' AND placed_at < now() - interval '24 hours')::int AS stale_pending,
        count(*) FILTER (WHERE placed_at > now() + interval '5 minutes')::int AS future_orders,
        count(*) FILTER (WHERE created_via = 'CUSTOMER_WEB' AND source = 'direct' AND coalesce(utm_campaign, '') <> '')::int AS tagged_direct,
        (SELECT count(*)::int FROM (
          SELECT razorpay_payment_id FROM orders WHERE site_id = ANY(${sites}) AND razorpay_payment_id IS NOT NULL
          GROUP BY razorpay_payment_id HAVING count(*) > 1
            AND bool_or(placed_at >= ${from} AND placed_at < ${to})
        ) duplicates) AS duplicate_payments
      FROM scoped
    `),
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM analytics_sessions WHERE site_id = ANY(${sites}) AND started_at >= ${from} AND started_at < ${to}) AS sessions,
        (SELECT count(*)::int FROM analytics_sessions WHERE site_id = ANY(${sites}) AND started_at >= ${from} AND started_at < ${to} AND (pageview_count < 0 OR last_seen_at < started_at)) AS invalid_sessions,
        count(*)::int AS events,
        count(*) FILTER (WHERE f.is_bot = false AND f.session_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM analytics_sessions s WHERE s.id = f.session_id AND s.site_id = f.site_id
        ))::int AS unmatched_events,
        count(*) FILTER (WHERE f.is_bot = false AND (f.path ~ '^/(admin|api|cod|pack)(/|$)'))::int AS internal_events
      FROM funnel_events f WHERE f.site_id = ANY(${sites}) AND f.created_at >= ${from} AND f.created_at < ${to}
    `),
    db.execute(sql`
      SELECT 'Orders' AS source, min(placed_at)::text AS first, max(placed_at)::text AS latest FROM orders WHERE site_id = ANY(${sites})
      UNION ALL
      SELECT 'Sessions', min(started_at)::text, max(last_seen_at)::text FROM analytics_sessions WHERE site_id = ANY(${sites})
      UNION ALL
      SELECT 'Funnel events', min(created_at)::text, max(created_at)::text FROM funnel_events WHERE site_id = ANY(${sites})
    `),
  ]);
  const o = orderResult[0] ?? {};
  const e = eventResult[0] ?? {};
  const definitions: Array<[string, string, string]> = [
    ["totals_mismatch", "Order arithmetic", "Total must equal subtotal + shipping + COD fee − discount. The confirmation fee is part of the total, not an extra charge."],
    ["invalid_amounts", "Invalid money values", "Negative amounts or a confirmation fee larger than the total require review."],
    ["invalid_items", "Missing item snapshots", "Empty or malformed order items prevent reliable product reporting."],
    ["payment_state", "Active prepaid orders without capture", "Check gateway reconciliation; partial refunds may explain some rows."],
    ["captured_inactive", "Captured payments on inactive orders", "Review refunds and payment reconciliation. A captured payment may need follow-up."],
    ["duplicate_payments", "Payment IDs used on multiple orders", "Checks all scoped history for payment IDs belonging to orders in this period."],
    ["stale_pending", "Payment attempts pending over 24 hours", "Review the reconciliation job and distinguish expired attempts from valid pending payments, including COD confirmation fees."],
    ["future_orders", "Orders dated in the future", "Checks timestamps more than five minutes ahead of the database clock."],
    ["tagged_direct", "Campaign orders classified as direct", "Review first-touch attribution; a tagged campaign should have an explainable channel."],
    ["invalid_sessions", "Invalid session counters or timing", "Pageviews cannot be negative; last-seen time cannot precede session start. Zero pageviews can be an unflushed browser beacon."],
    ["unmatched_events", "Browser events without a session record", "May indicate blocked/lost writes or historical retention differences; these are coverage warnings, not proven lost customers."],
    ["internal_events", "Internal pages in storefront tracking", "Admin, packing, COD operator and API paths should not pollute storefront behavior reports."],
  ];
  return {
    checkedAt: new Date().toISOString(),
    ordersChecked: Number(o.orders ?? 0), sessionsChecked: Number(e.sessions ?? 0), eventsChecked: Number(e.events ?? 0),
    history: historyResult.map((r) => ({ source: String(r.source), first: r.first ? String(r.first) : null, latest: r.latest ? String(r.latest) : null })),
    checks: definitions.map(([key, label, explanation]) => ({ key, label, explanation, count: Number(o[key] ?? e[key] ?? 0) })),
  };
}
