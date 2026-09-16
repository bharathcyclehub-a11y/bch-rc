import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { ArrowDown, ArrowUp, Download, Users } from "lucide-react";
import { db } from "@/db";
import { analyticsSessions, customers, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { formatINR } from "@/lib/utils";
import { PAID_STATUSES, bucketOfStatus } from "@/lib/order-status";
import { PRODUCTS } from "@/lib/products";
import { getFunnelReport } from "@/lib/funnel-queries";
import { safePct } from "@/lib/analytics-validation";
import { aggregateProductSales, aggregatePaymentOutcomes } from "@/lib/analytics-commerce";
import {
  getSalesTimeSeries,
  getAudience,
  getReturningVisitors,
  getVisitors,
  warnIfInsane,
} from "@/lib/analytics-service";
import {
  getCheckoutAnalytics,
  getCouponPerformance,
  getEngagementEvents,
  getProductFunnel,
} from "@/lib/analytics-extra";
import RevenueChart from "./RevenueChart";
import { parseAnalyticsRange, type AnalyticsRange, type AnalyticsSearchParams } from "@/lib/analytics-range";
import { RangeTabs } from "../RangeTabs";
import { IntegrationReports } from "./IntegrationReports";
import { DataQualityReport } from "./DataQualityReport";
import { AnalyticsGuide } from "./AnalyticsGuide";
import TrafficDonut from "./TrafficDonut";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "products", label: "Products" },
  { key: "customers", label: "Customers" },
  { key: "marketing", label: "Marketing" },
  { key: "operations", label: "Operations" },
  { key: "tracking", label: "GA4 & Clarity" },
  { key: "quality", label: "Data health" },
  { key: "guide", label: "What to read" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const SOURCE_LABEL: Record<string, string> = {
  direct: "Direct",
  instagram: "Instagram",
  google: "Google",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  youtube: "YouTube",
  referral: "Referral",
  organic: "Organic",
};
const srcLabel = (s: string | null) =>
  !s ? "Direct" : SOURCE_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

const HERO = new Map(PRODUCTS.map((p) => [p.id, p.heroImage]));

/** Friendly labels for the engagement events already in the funnel stream. */
const ENGAGEMENT_DISPLAY: Array<{ key: string; label: string }> = [
  { key: "hero_cta_click", label: "Hero CTA clicks" },
  { key: "whatsapp_click", label: "WhatsApp clicks" },
  { key: "wheel_open", label: "Spin-wheel opens" },
  { key: "wheel_spin", label: "Spin-wheel spins" },
  { key: "wheel_lead", label: "Spin-wheel leads" },
  { key: "bargain_open", label: "Bargain opened" },
  { key: "bargain_won", label: "Bargain won" },
  { key: "bargain_checkout", label: "Bargain → checkout" },
];

/** % change vs the previous equal-length window. null when there's no baseline. */
function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

export default async function AdminAnalytics({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams & { tab?: string }>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;

  const win = parseAnalyticsRange(sp);
  const range = win.days;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview") as Tab;

  if (tab === "tracking" || tab === "quality" || tab === "guide") {
    return <AnalyticsLayout win={win} tab={tab}>
      {tab === "tracking" && <IntegrationReports siteIds={ctx.siteIds} startDate={win.fromYmd} endDate={win.toYmd} />}
      {tab === "quality" && <DataQualityReport siteIds={ctx.siteIds} window={win} />}
      {tab === "guide" && <AnalyticsGuide />}
    </AnalyticsLayout>;
  }

  const windowStart = win.start;
  const windowEnd = win.end;
  const prevStart = win.prevStart;

  const paidFilter = sql`${orders.status} in ('PAID','PACKED','SHIPPED','DELIVERED')`;

  const [
    chartPoints,
    paidVsFailedRows,
    paidOrdersForSku,
    totalStats,
    sourceRows,
    campaignRows,
    paymentOutcomeRows,
    geoRows,
    deviceStats,
    audience,
    returningVisitors,
    cohort,
    prevOrderStats,
    prevVisitors,
    prevNewCustomers,
  ] = await Promise.all([
    getSalesTimeSeries(ctx.siteIds, win, win.granularity),
    db
      .select({ status: orders.status, count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(gte(orders.placedAt, windowStart), lt(orders.placedAt, windowEnd), inArray(orders.siteId, ctx.siteIds)))
      .groupBy(orders.status),
    db
      .select({ items: orders.items })
      .from(orders)
      .where(
        and(
          gte(orders.placedAt, windowStart), lt(orders.placedAt, windowEnd),
          inArray(orders.siteId, ctx.siteIds),
          inArray(orders.status, [...PAID_STATUSES]),
        ),
      ),
    db
      .select({
        orderCount: count(orders.id),
        revenue: sql<number>`coalesce(sum(${orders.totalInr}), 0)::float8`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.placedAt, windowStart), lt(orders.placedAt, windowEnd),
          inArray(orders.siteId, ctx.siteIds),
          inArray(orders.status, [...PAID_STATUSES]),
        ),
      )
      .then((rows) => rows[0]),
    db
      .select({
        source: orders.source,
        attempts: sql<number>`count(*)::int`,
        paid: sql<number>`count(*) filter (where ${paidFilter})::int`,
        revenue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${paidFilter}), 0)::float8`,
      })
      .from(orders)
      .where(and(gte(orders.placedAt, windowStart), lt(orders.placedAt, windowEnd), inArray(orders.siteId, ctx.siteIds)))
      .groupBy(orders.source)
      .orderBy(desc(sql`count(*) filter (where ${paidFilter})`)),
    db
      .select({
        campaign: orders.utmCampaign,
        source: orders.source,
        paid: sql<number>`count(*) filter (where ${paidFilter})::int`,
        revenue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${paidFilter}), 0)::float8`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.placedAt, windowStart), lt(orders.placedAt, windowEnd),
          inArray(orders.siteId, ctx.siteIds),
          sql`${orders.utmCampaign} is not null`,
        ),
      )
      .groupBy(orders.utmCampaign, orders.source)
      .orderBy(desc(sql`count(*) filter (where ${paidFilter})`))
      .limit(10),
    db
      .select({
        method: orders.paymentMethod,
        status: orders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(gte(orders.placedAt, windowStart), lt(orders.placedAt, windowEnd), inArray(orders.siteId, ctx.siteIds)))
      .groupBy(orders.paymentMethod, orders.status),
    db
      .select({
        state: sql<string>`coalesce(nullif(${orders.shippingAddress}->>'state', ''), 'Unknown')`,
        paid: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${orders.totalInr}), 0)::float8`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.placedAt, windowStart), lt(orders.placedAt, windowEnd),
          inArray(orders.siteId, ctx.siteIds),
          inArray(orders.status, [...PAID_STATUSES]),
        ),
      )
      .groupBy(sql`coalesce(nullif(${orders.shippingAddress}->>'state', ''), 'Unknown')`)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
    db
      .select({
        total: sql<number>`count(*)::int`,
        tablet: sql<number>`count(*) filter (where ${analyticsSessions.userAgent} ~* 'ipad|tablet|playbook|silk')::int`,
        mobile: sql<number>`count(*) filter (where ${analyticsSessions.userAgent} ~* 'mobi|iphone|ipod|android.*mobile|windows phone|blackberry' and ${analyticsSessions.userAgent} !~* 'ipad|tablet|playbook|silk')::int`,
      })
      .from(analyticsSessions)
      .where(
        and(
          gte(analyticsSessions.startedAt, windowStart), lt(analyticsSessions.startedAt, windowEnd),
          inArray(analyticsSessions.siteId, ctx.siteIds),
          eq(analyticsSessions.isBot, false),
        ),
      )
      .then((rows) => rows[0]),
    // VISITORS / SESSIONS / PAGEVIEWS — canonical, from the analytics service.
    getAudience(ctx.siteIds, { from: windowStart, to: windowEnd }),
    getReturningVisitors(ctx.siteIds, windowStart, windowEnd),
    // Count actual active sales in the selected sites and period. Cached
    // customer lifetime counters include failed attempts and other sites.
    db.execute(sql`
      SELECT count(*) FILTER (WHERE n = 1)::int AS one,
             count(*) FILTER (WHERE n = 2)::int AS two,
             count(*) FILTER (WHERE n >= 3)::int AS "threePlus",
             count(*)::int AS buyers
      FROM (
        SELECT customer_id, count(*) AS n FROM orders
        WHERE ${inArray(orders.siteId, ctx.siteIds)}
          AND placed_at >= ${windowStart.toISOString()}
          AND placed_at < ${windowEnd.toISOString()}
          AND ${inArray(orders.status, [...PAID_STATUSES])}
        GROUP BY customer_id
      ) buyers_in_period
    `).then((rows) => rows[0] as {one: number; two: number; threePlus: number; buyers: number}),

    db
      .select({
        orderCount: count(orders.id),
        revenue: sql<number>`coalesce(sum(${orders.totalInr}), 0)::float8`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.placedAt, prevStart),
          lt(orders.placedAt, windowStart),
          inArray(orders.siteId, ctx.siteIds),
          inArray(orders.status, [...PAID_STATUSES]),
        ),
      )
      .then((rows) => rows[0]),
    getVisitors(ctx.siteIds, prevStart, windowStart),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(customers)
      .where(
        and(
          gte(customers.createdAt, prevStart),
          lt(customers.createdAt, windowStart),
          inArray(customers.firstSiteId, ctx.siteIds),
        ),
      )
      .then((rows) => rows[0]?.c ?? 0),
  ]);

  const newCustomersWindow = chartPoints.reduce((sum, p) => sum + p.customers, 0);
  const revenueSeries = chartPoints.map((p) => p.revenue);

  // ── Status mix (unchanged bucketing) ──────────────────────────────────────
  let liveCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let otherCount = 0;
  for (const row of paidVsFailedRows) {
    switch (bucketOfStatus(row.status)) {
      case "live": liveCount += row.count; break;
      case "pending": pendingCount += row.count; break;
      case "failed": failedCount += row.count; break;
      default: otherCount += row.count;
    }
  }
  const statusTotal = liveCount + pendingCount + failedCount + otherCount;
  const statusPct = (n: number) => Math.round(safePct(n, statusTotal));

  const { products: skuAggregate, invalidRecords: invalidItemRecords } = aggregateProductSales(paidOrdersForSku);
  const bestSellers = Array.from(skuAggregate.entries())
    .map(([skuId, v]) => ({ skuId, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const methodAggs = aggregatePaymentOutcomes(paymentOutcomeRows);

  let codPaid = 0;
  let prepaidPaid = 0;
  for (const m of methodAggs) {
    if (m.method === "COD") codPaid += m.paid;
    else prepaidPaid += m.paid;
  }
  const paidSplitTotal = codPaid + prepaidPaid;
  let codDispatched = 0;
  let codReturned = 0;
  for (const r of paymentOutcomeRows) {
    if (r.method !== "COD") continue;
    if (["SHIPPED", "DELIVERED", "RETURNED"].includes(r.status)) codDispatched += r.count;
    if (r.status === "RETURNED") codReturned += r.count;
  }
  const codRtoPct = codDispatched > 0 ? Math.round((codReturned / codDispatched) * 100) : null;

  const devTotal = deviceStats?.total ?? 0;
  const devMobile = deviceStats?.mobile ?? 0;
  const devTablet = deviceStats?.tablet ?? 0;
  const devDesktop = Math.max(0, devTotal - devMobile - devTablet);
  const devPct = (n: number) => (devTotal === 0 ? 0 : Math.round((n / devTotal) * 100));

  // VISITOR = unique person. SESSION = one visit. They are NOT the same number.
  const activeV = audience.visitors;
  const sessions = audience.sessions;
  const returningV = returningVisitors;
  const newV = Math.max(0, activeV - returningV);

  warnIfInsane("analytics", {
    visitors: activeV,
    sessions,
    pageviews: audience.pageviews,
  });

  const buyers = cohort?.buyers ?? 0;
  const repeatBuyers = (cohort?.two ?? 0) + (cohort?.threePlus ?? 0);
  const repeatRate = buyers === 0 ? 0 : Math.round((repeatBuyers / buyers) * 100);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const revenue = totalStats?.revenue ?? 0;
  const orderCount = totalStats?.orderCount ?? 0;
  const prevRevenue = prevOrderStats?.revenue ?? 0;
  const prevOrders = prevOrderStats?.orderCount ?? 0;

  const aov = orderCount > 0 ? Math.round(revenue / orderCount) : 0;
  const prevAov = prevOrders > 0 ? Math.round(prevRevenue / prevOrders) : 0;
  const conv = safePct(orderCount, activeV);
  const prevConv = safePct(prevOrders, prevVisitors);

  const funnel = tab === "overview" ? await getFunnelReport(ctx.siteIds, range, win) : null;

  // ── Additive sections (collected-but-not-shown) ───────────────────────────
  // Gated to the tab that renders them so no other tab pays for the query.
  // Every one is keyed off the SAME windowStart + PAID_STATUSES as above, so
  // revenue/orders/people reconcile with the rest of the page.
  const [couponPerf, engagement] =
    tab === "marketing"
      ? await Promise.all([
          getCouponPerformance(ctx.siteIds, windowStart, windowEnd),
          getEngagementEvents(ctx.siteIds, windowStart, windowEnd),
        ])
      : [null, null];
  const checkoutA = tab === "operations" ? await getCheckoutAnalytics(ctx.siteIds, windowStart, windowEnd) : null;
  const productFunnelRaw = tab === "products" ? await getProductFunnel(ctx.siteIds, windowStart, windowEnd) : null;

  // Merge per-SKU views/cart (beacon) with purchased units from `skuAggregate`
  // (the SAME orders-ledger map the Best-sellers list uses).
  const productFunnel = productFunnelRaw
    ? Array.from(
        new Set<string>([...productFunnelRaw.map((p) => p.skuId), ...skuAggregate.keys()]),
      )
        .map((skuId) => {
          const fe = productFunnelRaw.find((p) => p.skuId === skuId);
          const bought = skuAggregate.get(skuId);
          const views = fe?.views ?? 0;
          const addToCart = fe?.addToCart ?? 0;
          const purchased = bought?.qty ?? 0;
          return {
            skuId,
            name: bought?.name ?? fe?.name ?? skuId,
            views,
            addToCart,
            purchased,
            cartRate: views > 0 ? (addToCart / views) * 100 : null,
          };
        })
        .sort((a, b) => b.views - a.views)
    : null;

  const usePaid = sourceRows.some((r) => r.paid > 0);
  const donutSlices = sourceRows
    .map((r) => ({
      label: srcLabel(r.source),
      value: usePaid ? r.paid : r.attempts,
      revenue: r.revenue,
    }))
    .filter((s) => s.value > 0)
    .slice(0, 6);

  return (
    <AnalyticsLayout win={win} tab={tab}>
      {invalidItemRecords > 0 && (tab === "overview" || tab === "products") && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{invalidItemRecords} order item records could not be read. Product totals may be incomplete; review Data health.</p>}
      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-3 sm:space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
            <Kpi label="Active sales" value={formatINR(revenue)} delta={deltaPct(revenue, prevRevenue)} spark={revenueSeries} />
            <Kpi label="Orders" value={orderCount.toLocaleString("en-IN")} delta={deltaPct(orderCount, prevOrders)} />
            <Kpi
              label="Orders / visitors"
              value={activeV > 0 ? `${conv.toFixed(conv < 10 ? 1 : 0)}%` : "—"}
              deltaPp={activeV > 0 && prevVisitors > 0 ? conv - prevConv : null}
            />
            <Kpi label="Avg order value" value={formatINR(aov)} delta={deltaPct(aov, prevAov)} />
            <Kpi label="New profiles" value={newCustomersWindow.toLocaleString("en-IN")} delta={deltaPct(newCustomersWindow, prevNewCustomers)} />
          </div>

          <RevenueChart points={chartPoints} />
          <Card title="Sales by period" hint={`${win.granularity} totals · select Custom with the same start and end date for one day`}>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white"><tr className="border-b border-brand-line text-left">
                  <th scope="col" className="p-3">Period (IST)</th><th scope="col" className="p-3 text-right">Active sales</th>
                  <th scope="col" className="p-3 text-right">Orders</th><th scope="col" className="p-3 text-right">New profiles</th>
                </tr></thead>
                <tbody className="divide-y divide-brand-line">{chartPoints.map((p) => <tr key={p.key}>
                  <th scope="row" className="p-3 text-left font-medium">{p.label}</th><td className="p-3 text-right tabular-nums">{formatINR(p.revenue)}</td>
                  <td className="p-3 text-right tabular-nums">{p.orders}</td><td className="p-3 text-right tabular-nums">{p.customers}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </Card>

          {/* Sales breakdown */}
          <div className="grid lg:grid-cols-2 gap-3 sm:gap-4">
            <Card title="Top products" hint="Item sales before order discounts and shipping">
              {bestSellers.length === 0 ? (
                <Empty>No paid orders in this period.</Empty>
              ) : (
                <ul className="divide-y divide-brand-line">
                  {bestSellers.slice(0, 5).map((s, i) => (
                    <li key={s.skuId} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                      <span className="w-4 text-xs font-bold tabular-nums text-brand-ink-soft">{i + 1}</span>
                      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-brand-line bg-brand-cream grid place-items-center">
                        {HERO.get(s.skuId) ? (
                          <Image src={HERO.get(s.skuId)!} alt="" width={40} height={40} className="h-full w-full object-contain" />
                        ) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-brand-ink">{s.name}</div>
                        <div className="text-xs text-brand-ink-soft tabular-nums">{s.qty} units sold</div>
                      </div>
                      <span className="tabular-nums text-sm font-semibold text-brand-ink">{formatINR(s.revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <TrafficDonut slices={donutSlices} totalLabel={usePaid ? "paid orders" : "orders"} />
          </div>

          {/* Independent measured stages; no synthetic coverage uplift. */}
          {funnel && (
            <Card title="Store funnel" hint="Observed stage counts · browsers for visits, customers for orders">
              {!funnel.stages.length || funnel.stages.every((stage) => stage.visitors === 0) ? (
                <Empty>No stage activity recorded in this period.</Empty>
              ) : (
                <div className="space-y-2 p-3 sm:p-5">
                  {funnel.stages.map((s, i) => {
                    const top = funnel.stages[0].visitors || 1;
                    const w = (s.visitors / top) * 100;
                    const stageRatio = i > 0 && funnel.stages[i - 1].visitors > 0 ? safePct(s.visitors, funnel.stages[i - 1].visitors) : null;
                    return (
                      <div key={s.key} className="flex items-center gap-2 sm:gap-3">
                        <span className="w-24 sm:w-36 shrink-0 truncate text-sm font-medium text-brand-ink">{s.label}</span>
                        <div className="relative h-8 flex-1 overflow-hidden rounded-lg bg-brand-cream">
                          <div
                            className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-brand-red to-brand-red/65"
                            style={{ width: `${Math.min(100, Math.max(w, 0))}%` }}
                          />
                        </div>
                        <span
                          className="w-12 sm:w-16 text-right text-sm font-bold tabular-nums text-brand-ink"
                        >
                          {s.visitors.toLocaleString("en-IN")}
                        </span>
                        <span
                          className={`w-11 text-right text-xs font-semibold tabular-nums ${
                            stageRatio === null ? "text-brand-ink-soft/40" : "text-brand-ink-soft"
                          }`}
                        >
                          {stageRatio === null ? "—" : `${stageRatio.toFixed(stageRatio < 10 ? 1 : 0)}%`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="px-3 sm:px-5 pb-3 text-xs text-brand-ink-soft">
                Browser event coverage: {Math.round(funnel.coveragePct)}%. Steps are independently observed; visitors may skip steps. Missing events are not estimated, and stage ratios do not prove abandonment.
              </p>
            </Card>
          )}

          {/* Customers snapshot */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <Tile label="Visitors" value={activeV.toLocaleString("en-IN")} sub="unique people" />
            <Tile label="Sessions" value={sessions.toLocaleString("en-IN")} sub={`${audience.pageviews.toLocaleString("en-IN")} pageviews`} />
            <Tile label="New visitors" value={newV.toLocaleString("en-IN")} sub={`${returningV.toLocaleString("en-IN")} returning`} />
            <Tile label="Repeat rate" value={`${repeatRate}%`} sub={`${repeatBuyers} of ${buyers} buyers in this period`} />
          </div>
        </div>
      )}

      {/* ── PRODUCTS ── */}
      {tab === "products" && (
        <div className="space-y-3 sm:space-y-4">
        <Card title="Best sellers" hint={`Item sales before order discounts and shipping · ${win.label}`}>
          {bestSellers.length === 0 ? (
            <Empty>No paid orders in this period.</Empty>
          ) : (
            <ul className="divide-y divide-brand-line">
              {bestSellers.map((s, i) => (
                <li key={s.skuId} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3">
                  <span className="w-4 text-xs font-bold tabular-nums text-brand-ink-soft">{i + 1}</span>
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-brand-line bg-brand-cream grid place-items-center">
                    {HERO.get(s.skuId) ? (
                      <Image src={HERO.get(s.skuId)!} alt="" width={44} height={44} className="h-full w-full object-contain" />
                    ) : null}
                  </span>
                  <div className="min-w-[8rem] flex-1">
                    <div className="truncate text-sm font-semibold text-brand-ink">{s.name}</div>
                    <div className="text-xs text-brand-ink-soft font-mono">{s.skuId}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-brand-ink-soft">Units</div>
                    <div className="text-sm font-semibold tabular-nums text-brand-ink">{s.qty}</div>
                  </div>
                  <div className="w-24 text-right">
                    <div className="text-xs text-brand-ink-soft">Revenue</div>
                    <div className="text-sm font-semibold tabular-nums text-brand-ink">{formatINR(s.revenue)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Product funnel — per-SKU view → cart → buy (collected but never shown). */}
        <Card title="Product funnel" hint="Distinct browsers for views/cart; units from active sales. These are different populations.">
          {!productFunnel || productFunnel.filter((p) => p.views > 0 || p.purchased > 0).length === 0 ? (
            <Empty>No product activity tracked in this period.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-brand-ink-soft">
                    <th className="text-left font-semibold px-4 sm:px-5 py-2.5">Product</th>
                    <th className="text-right font-semibold px-2 py-2.5">Views</th>
                    <th className="text-right font-semibold px-2 py-2.5">Cart</th>
                    <th className="text-right font-semibold px-2 py-2.5">Units sold</th>
                    <th className="text-right font-semibold px-2 py-2.5">Cart / view</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-line">
                  {productFunnel
                    .filter((p) => p.views > 0 || p.purchased > 0)
                    .slice(0, 15)
                    .map((p) => (
                      <tr key={p.skuId}>
                        <td className="px-4 sm:px-5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-brand-line bg-brand-cream grid place-items-center">
                              {HERO.get(p.skuId) ? (
                                <Image src={HERO.get(p.skuId)!} alt="" width={32} height={32} className="h-full w-full object-contain" />
                              ) : null}
                            </span>
                            <span className="truncate max-w-[9rem] sm:max-w-[14rem] font-medium text-brand-ink">{p.name}</span>
                          </div>
                        </td>
                        <td className="text-right tabular-nums text-brand-ink px-2">{p.views.toLocaleString("en-IN")}</td>
                        <td className="text-right tabular-nums text-brand-ink-soft px-2">{p.addToCart.toLocaleString("en-IN")}</td>
                        <td className="text-right tabular-nums text-brand-ink px-2">{p.purchased.toLocaleString("en-IN")}</td>
                        <td className="text-right tabular-nums px-4 sm:px-5 text-brand-ink-soft">{p.cartRate === null ? "—" : `${p.cartRate.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        </div>
      )}

      {/* ── CUSTOMERS ── */}
      {tab === "customers" && (
        <div className="space-y-3 sm:space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <Tile label="Visitors" value={activeV.toLocaleString("en-IN")} sub="unique people" />
            <Tile label="Sessions" value={sessions.toLocaleString("en-IN")} sub="one per visit" />
            <Tile label="New visitors" value={newV.toLocaleString("en-IN")} sub={`${returningV.toLocaleString("en-IN")} returning`} />
            <Tile label="Repeat purchase rate" value={`${repeatRate}%`} sub={`${repeatBuyers} of ${buyers} buyers in this period`} />
          </div>

          <Card title="Audience profile" hint="Information suitable for content planning">
            <div className="p-4 sm:p-5 space-y-2 text-sm text-brand-ink-soft">
              <p>Gender: unknown. Customer names and delivery recipients do not reliably identify the buyer’s gender.</p>
              <p>Use an optional post-purchase survey with “Prefer not to say”, and report the response rate. Product preference, gift versus self-purchase, device, region and repeat buying are useful content signals.</p>
            </div>
          </Card>

          <Card title="Repeat cohort" hint="Active orders in the selected period and stores">
            <div className="grid grid-cols-3 divide-x divide-brand-line">
              <Split label="1 order" value={cohort?.one ?? 0} />
              <Split label="2 orders" value={cohort?.two ?? 0} />
              <Split label="3+ orders" value={cohort?.threePlus ?? 0} />
            </div>
          </Card>
        </div>
      )}

      {/* ── MARKETING ── */}
      {tab === "marketing" && (
        <div className="space-y-3 sm:space-y-4">
          <Card title="Channels" hint="Attempts → paid orders → revenue">
            {sourceRows.length === 0 ? (
              <Empty>No attributed orders yet.</Empty>
            ) : (
              <ul className="divide-y divide-brand-line">
                {sourceRows.map((r) => (
                  <li key={r.source ?? "direct"} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3 text-sm">
                    <span className="min-w-[6rem] flex-1 font-semibold text-brand-ink">{srcLabel(r.source)}</span>
                    <span className="text-brand-ink-soft tabular-nums">{r.attempts} attempts</span>
                    <span className="text-brand-ink tabular-nums font-semibold">{r.paid} paid</span>
                    <span className="w-24 text-right tabular-nums text-brand-ink">{formatINR(r.revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Campaigns" hint="Orders carrying a utm_campaign tag">
            {campaignRows.length === 0 ? (
              <Empty>No campaign-tagged orders yet.</Empty>
            ) : (
              <ul className="divide-y divide-brand-line">
                {campaignRows.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3 text-sm">
                    <span className="min-w-[8rem] flex-1 font-semibold text-brand-ink truncate">{r.campaign}</span>
                    <span className="text-xs text-brand-ink-soft">{srcLabel(r.source)}</span>
                    <span className="tabular-nums text-brand-ink">{r.paid} paid</span>
                    <span className="w-24 text-right tabular-nums text-brand-ink">{formatINR(r.revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Coupon performance — from the orders ledger (reconciles with Revenue). */}
          <Card title="Coupon performance" hint="Applied orders compared with active sales; pending and reversed orders are shown separately">
            {!couponPerf || couponPerf.rows.length === 0 ? (
              <Empty>No coupon-tagged orders in this period.</Empty>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-brand-line border-b border-brand-line">
                  <Split label="Redemptions" value={couponPerf.totals.redeemed} tone="success" />
                  <Split label="Applied" value={couponPerf.totals.applied} />
                  <div className="px-3 py-3 sm:px-5 sm:py-4 text-center">
                    <div className="text-xl sm:text-2xl font-bold tabular-nums text-brand-ink">{formatINR(couponPerf.totals.revenue)}</div>
                    <div className="text-xs text-brand-ink-soft mt-0.5">Revenue</div>
                  </div>
                  <div className="px-3 py-3 sm:px-5 sm:py-4 text-center">
                    <div className="text-xl sm:text-2xl font-bold tabular-nums text-brand-red">−{formatINR(couponPerf.totals.discount)}</div>
                    <div className="text-xs text-brand-ink-soft mt-0.5">Discount given</div>
                  </div>
                </div>
                <ul className="divide-y divide-brand-line">
                  {couponPerf.rows.slice(0, 12).map((c) => (
                    <li key={c.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3 text-sm">
                      <span className="min-w-[6rem] flex-1 font-mono font-semibold text-brand-ink">{c.code}</span>
                      <span className="text-brand-ink-soft tabular-nums text-xs">{c.applied} applied</span>
                      <span className="text-brand-ink tabular-nums font-semibold">{c.redeemed} used</span>
                      <span className={`tabular-nums text-xs font-semibold ${c.convPct < 40 ? "text-brand-red" : "text-success"}`}>{c.convPct}%</span>
                      <span className="text-brand-red tabular-nums text-xs">−{formatINR(c.discount)}</span>
                      <span className="w-24 text-right tabular-nums text-brand-ink font-semibold">{formatINR(c.revenue)}</span>
                    </li>
                  ))}
                </ul>
                {couponPerf.rows.some((c) => c.failed > 0) && (
                  <div className="px-4 sm:px-5 py-3 border-t border-brand-line">
                    <p className="text-[11px] uppercase tracking-wide text-brand-ink-soft mb-1.5">Codes without active sales (includes pending and reversed orders)</p>
                    <div className="flex flex-wrap gap-2">
                      {couponPerf.rows
                        .filter((c) => c.failed > 0)
                        .sort((a, b) => b.failed - a.failed)
                        .slice(0, 6)
                        .map((c) => (
                          <span key={c.code} className="inline-flex items-center gap-1.5 rounded-full bg-brand-cream px-2.5 py-1 text-xs">
                            <span className="font-mono font-semibold text-brand-ink">{c.code}</span>
                            <span className="text-brand-red tabular-nums">{c.failed} without active sales</span>
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Marketing engagement — on-site interactions already in the event stream. */}
          <Card title="Marketing engagement" hint="On-site interactions captured this period">
            {!engagement || Object.keys(engagement).length === 0 ? (
              <Empty>No engagement events tracked in this period.</Empty>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-brand-line">
                {ENGAGEMENT_DISPLAY.filter((e) => engagement[e.key]).map((e) => (
                  <div key={e.key} className="bg-white p-3 sm:p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink-soft truncate">{e.label}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-brand-ink">{engagement[e.key].events.toLocaleString("en-IN")}</div>
                    <div className="text-[11px] text-brand-ink-soft tabular-nums">{engagement[e.key].visitors.toLocaleString("en-IN")} people</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── OPERATIONS ── */}
      {tab === "operations" && (
        <div className="space-y-3 sm:space-y-4">
          <Card title="Order status mix" hint={`Orders placed ${win.label}`}>
            {statusTotal === 0 ? (
              <Empty>No orders in this period.</Empty>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-brand-line">
                <Split label="Live" value={liveCount} sub={`${statusPct(liveCount)}%`} tone="success" />
                <Split label="Pending" value={pendingCount} sub={`${statusPct(pendingCount)}%`} tone="gold" />
                <Split label="Failed" value={failedCount} sub={`${statusPct(failedCount)}%`} tone="danger" />
                <Split label="Other" value={otherCount} sub={`${statusPct(otherCount)}%`} />
              </div>
            )}
          </Card>

          <Card title="Payment outcomes" hint="Is the failure rate real declines, abandonment, or ops cancellations?">
            {methodAggs.length === 0 ? (
              <Empty>No payment attempts in this period.</Empty>
            ) : (
              <ul className="divide-y divide-brand-line">
                {methodAggs.map((m) => (
                  <li key={m.method} className="px-4 sm:px-5 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-brand-ink">{m.method}</span>
                      <span className="text-brand-ink-soft tabular-nums text-xs">{m.attempts} attempts</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                      <span className="text-success">{m.paid} paid</span>
                      <span className="text-brand-red">{m.failed} failed</span>
                      <span className="text-brand-ink-soft">{m.abandoned} abandoned</span>
                      <span className="text-brand-ink-soft">{m.cancelled} cancelled</span>
                      <span className="text-gold">{m.pending} pending</span>
                      <span className="text-brand-ink-soft">{m.returned} returned</span>
                      <span className="text-brand-ink-soft">{m.refunded} refunded</span>
                      {m.other > 0 && <span className="text-brand-ink-soft">{m.other} other</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
            <Card title="COD vs prepaid" hint="Of paid orders">
              {paidSplitTotal === 0 ? (
                <Empty>No paid orders yet.</Empty>
              ) : (
                <div className="p-5 space-y-3">
                  <Bar label="COD" value={codPaid} total={paidSplitTotal} color="bg-gold" />
                  <Bar label="Prepaid" value={prepaidPaid} total={paidSplitTotal} color="bg-success" />
                  <div className="pt-3 border-t border-brand-line text-sm">
                    <span className="text-brand-ink-soft">COD RTO rate: </span>
                    <span className={`font-bold tabular-nums ${codRtoPct !== null && codRtoPct > 15 ? "text-brand-red" : "text-brand-ink"}`}>
                      {codRtoPct === null ? "—" : `${codRtoPct}%`}
                    </span>
                    <span className="text-xs text-brand-ink-soft"> ({codReturned} of {codDispatched} dispatched)</span>
                  </div>
                </div>
              )}
            </Card>

            <Card title="Devices" hint="Non-bot sessions">
              {devTotal === 0 ? (
                <Empty>No sessions tracked yet.</Empty>
              ) : (
                <div className="p-5 space-y-3">
                  <Bar label="Mobile" value={devMobile} total={devTotal} color="bg-brand-red" pct={devPct(devMobile)} />
                  <Bar label="Desktop" value={devDesktop} total={devTotal} color="bg-brand-ink" pct={devPct(devDesktop)} />
                  <Bar label="Tablet" value={devTablet} total={devTotal} color="bg-gold" pct={devPct(devTablet)} />
                </div>
              )}
            </Card>
          </div>

          <Card title="Top states" hint="Paid orders by shipping state">
            {geoRows.length === 0 ? (
              <Empty>No paid orders yet.</Empty>
            ) : (
              <ul className="divide-y divide-brand-line">
                {geoRows.map((g) => (
                  <li key={g.state} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 text-sm">
                    <span className="text-brand-ink">{g.state}</span>
                    <span className="text-brand-ink-soft tabular-nums">
                      {g.paid} orders · <span className="text-brand-ink font-semibold">{formatINR(g.revenue)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Checkout analytics — payment lifecycle from on-site events. */}
          <Card title="Checkout analytics" hint="Payment lifecycle from on-site events · distinct people per step">
            {!checkoutA || checkoutA.stages.checkoutStarted === 0 ? (
              <Empty>No checkout activity tracked in this period.</Empty>
            ) : (
              <div className="p-4 sm:p-5 space-y-4">
                <div className="space-y-2">
                  {[
                    { label: "Started checkout", v: checkoutA.stages.checkoutStarted },
                    { label: "Selected payment", v: checkoutA.stages.paymentMethodSelected },
                    { label: "Opened Razorpay", v: checkoutA.stages.razorpayOpened },
                    { label: "Paid", v: checkoutA.stages.paymentSucceeded },
                  ].map((s, _i, arr) => {
                    const top = arr[0].v || 1;
                    const w = (s.v / top) * 100;
                    return (
                      <div key={s.label} className="flex items-center gap-2 sm:gap-3">
                        <span className="w-28 sm:w-36 shrink-0 text-sm text-brand-ink">{s.label}</span>
                        <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-brand-cream">
                          <div className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-brand-red to-brand-red/65" style={{ width: `${Math.min(100, Math.max(w, 0))}%` }} />
                        </div>
                        <span className="w-14 text-right text-sm font-bold tabular-nums text-brand-ink">{s.v.toLocaleString("en-IN")}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums border-t border-brand-line pt-3">
                  <span className="text-brand-red">{checkoutA.stages.paymentFailed} payment failed</span>
                  <span className="text-brand-ink-soft">{checkoutA.stages.paymentCancelled} cancelled</span>
                </div>
                {checkoutA.methods.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-brand-ink-soft mb-1.5">Payment method chosen</p>
                    <div className="flex flex-wrap gap-2">
                      {checkoutA.methods.map((m) => (
                        <span key={m.method} className="inline-flex items-center gap-1.5 rounded-full bg-brand-cream px-2.5 py-1 text-xs">
                          <span className="font-semibold text-brand-ink uppercase">{m.method}</span>
                          <span className="text-brand-ink-soft tabular-nums">{m.n}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {checkoutA.failureReasons.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-brand-ink-soft mb-1.5">Top failure reasons</p>
                    <ul className="space-y-1">
                      {checkoutA.failureReasons.map((f, i) => (
                        <li key={i} className="flex items-center justify-between text-xs">
                          <span className="text-brand-ink truncate pr-2">{f.reason}</span>
                          <span className="text-brand-red tabular-nums font-semibold">{f.n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </AnalyticsLayout>
  );
}

/* ── presentational helpers ─────────────────────────────────────────────── */

function AnalyticsLayout({ win, tab, children }: { win: AnalyticsRange; tab: Tab; children: ReactNode }) {
  const qs = (next: { tab: string }) => {
    const params = new URLSearchParams(win.query);
    if (next.tab !== "overview") params.set("tab", next.tab);
    return `/admin/analytics?${params}`;
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-brand-ink">Analytics</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <RangeTabs key={win.query} presets={[1, 7, 30, 90, 365]} defaultRange={30} custom calendar granularity />
          {/* Real export: hits the admin-gated CSV route directly. */}
          <a
            href={`/api/admin/export?dataset=orders&from=${win.fromYmd}&to=${win.toYmd}`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-3 py-2.5 sm:py-2 text-xs font-semibold text-brand-ink hover:border-brand-ink transition-colors"
          >
            <Download size={14} /> Export
          </a>
        </div>
      </div>

      <p className="text-sm text-brand-ink-soft">{win.label} · IST (Asia/Kolkata) · Compared with {win.previousLabel}</p>
      {win.error && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{win.error}</p>}
      <p className="text-xs text-brand-ink-soft">Sales use order placement dates and current active statuses. COD can still be uncollected; returned, refunded and cancelled orders are excluded. Historical totals can change after returns.</p>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-brand-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={qs({ tab: t.key })}
            aria-current={t.key === tab ? "page" : undefined}
            className={`shrink-0 px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              t.key === tab
                ? "border-brand-red text-brand-ink"
                : "border-transparent text-brand-ink-soft hover:text-brand-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  deltaPp,
  spark,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaPp?: number | null;
  spark?: number[];
}) {
  const d = deltaPp ?? delta ?? null;
  const up = d !== null && d >= 0;
  const text =
    d === null
      ? "—"
      : deltaPp !== undefined && deltaPp !== null
        ? `${Math.abs(d).toFixed(1)} pp`
        : `${Math.abs(d).toFixed(1)}%`;

  return (
    <div className="rounded-2xl border border-brand-line bg-white p-3 sm:p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink-soft truncate">{label}</div>
      <div className="mt-1.5 text-[20px] font-bold tabular-nums text-brand-ink truncate">{value}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${
            d === null ? "text-brand-ink-soft/60" : up ? "text-success" : "text-brand-red"
          }`}
        >
          {d !== null && (up ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
          {text}
        </span>
        {spark && spark.length > 1 && <Spark values={spark} />}
      </div>
    </div>
  );
}

/** Tiny server-rendered sparkline (no JS shipped). */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i / (n - 1)) * 56},${16 - (v / max) * 14}`)
    .join(" ");
  return (
    <svg width="56" height="16" viewBox="0 0 56 16" className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke="var(--success)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-brand-line bg-white overflow-hidden">
      <header className="px-4 sm:px-5 py-3.5 border-b border-brand-line">
        <h2 className="font-semibold text-brand-ink">{title}</h2>
        {hint && <p className="text-xs text-brand-ink-soft mt-0.5">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 sm:py-14 text-center text-sm text-brand-ink-soft">{children}</p>;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-white p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-ink-soft">
        <Users size={12} /> {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tabular-nums text-brand-ink">{value}</div>
      {sub && <div className="text-[11px] text-brand-ink-soft mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

function Split({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "success" | "gold" | "danger";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "gold" ? "text-gold" : tone === "danger" ? "text-brand-red" : "text-brand-ink";
  return (
    <div className="px-3 py-3 sm:px-5 sm:py-4 text-center">
      <div className={`text-xl sm:text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString("en-IN")}</div>
      <div className="text-xs text-brand-ink-soft mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-brand-ink-soft tabular-nums">{sub}</div>}
    </div>
  );
}

function Bar({
  label,
  value,
  total,
  color,
  pct,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  pct?: number;
}) {
  const p = pct ?? (total === 0 ? 0 : Math.round((value / total) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-brand-ink">{label}</span>
        <span className="text-brand-ink-soft tabular-nums">
          {value.toLocaleString("en-IN")} <span className="font-semibold text-brand-ink">({p}%)</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-brand-cream overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, p)}%` }} />
      </div>
    </div>
  );
}
