/**
 * GET /api/admin/export?dataset=orders|funnel|customers[&days=N]
 *
 * Admin-only CSV export of the datasets you actually study the audience from:
 * paid/placed ORDERS (who bought, from where, how they paid, what), raw FUNNEL
 * EVENTS (every step a visitor took, where they dropped off), and the CUSTOMERS
 * CRM list (name, phone, email + site-scoped orders/spend/last-order).
 *
 * The point: the source code contains zero audience data. This route is the
 * "data out" half — download a CSV here, hand it to Claude (or open in Excel),
 * and you can actually analyse the audience. Nothing here lives in the repo.
 *
 * Auth: getAdminContext() (NOT requireAdmin — that redirects, which is wrong
 * for a fetch/download). Null context → 401, never a redirect.
 *
 * No BOM is written: the primary consumer is AI/pandas analysis, where a
 * BOM-prefixed first header ("﻿order_id") silently breaks column lookups.
 * Amounts are plain integers (rupees), so there's no ₹ glyph needing a BOM.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, customers, funnelEvents } from "@/db/schema";
import { getAdminContext } from "@/lib/admin-auth";
import { parseAnalyticsRange, type MetricWindow } from "@/lib/analytics-range";
import { PAID_STATUSES } from "@/lib/order-status";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

// Hard caps so a runaway export can't try to stream the whole table into
// memory. Orders are low-volume (keep all); funnel events are high-volume.
const ORDERS_MAX = 50_000;
const FUNNEL_MAX = 100_000;
const CUSTOMERS_MAX = 100_000;

class ExportLimitError extends Error {
  constructor(dataset: string, cap: number) {
    super(`${dataset} export exceeds ${cap.toLocaleString("en-IN")} rows. Choose a shorter date range or one store; no partial file was produced.`);
  }
}

/** Pull a field from a JSONB snapshot defensively (shape can drift over time). */
function field(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object") {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

async function exportOrders(
  window: MetricWindow | null,
  siteIds: string[],
): Promise<string> {
  const where = window
    ? and(
        inArray(orders.siteId, siteIds),
        gte(orders.placedAt, window.start),
        lt(orders.placedAt, window.end),
      )
    : inArray(orders.siteId, siteIds);

  const scopedCustomers = db.select({
    customerId: orders.customerId,
    paidOrders: sql<number>`count(*)::int`.as("paid_orders"),
    activeSales: sql<number>`coalesce(sum(${orders.totalInr}), 0)::bigint`.as("active_sales"),
  }).from(orders).where(and(inArray(orders.siteId, siteIds), inArray(orders.status, [...PAID_STATUSES])))
    .groupBy(orders.customerId).as("scoped_customer_stats");

  const rows = await db
    .select({ o: orders, c: customers, paidOrders: scopedCustomers.paidOrders, activeSales: scopedCustomers.activeSales })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(scopedCustomers, eq(orders.customerId, scopedCustomers.customerId))
    .where(where)
    .orderBy(desc(orders.placedAt))
    .limit(ORDERS_MAX + 1);
  if (rows.length > ORDERS_MAX) throw new ExportLimitError("Orders", ORDERS_MAX);

  const headers = [
    "order_id",
    "placed_at",
    "paid_at",
    "status",
    "payment_status",
    "payment_method",
    "created_via",
    "customer_name",
    "customer_phone",
    "customer_email",
    "city",
    "state",
    "pincode",
    "item_count",
    "items",
    "subtotal_inr",
    "shipping_inr",
    "cod_fee_inr",
    "discount_inr",
    "total_inr",
    "coupon_code",
    "source",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "referrer_host",
    "customer_scope_lifetime_paid_orders",
    "customer_scope_lifetime_active_sales_inr",
  ];

  const data = rows.map(({ o, c, paidOrders, activeSales }) => {
    const items = Array.isArray(o.items) ? o.items : [];
    const itemCount = items.reduce(
      (n: number, it: unknown) => n + (Number(field(it, "qty")) || 0),
      0,
    );
    const itemsSummary = items
      .map((it) => `${field(it, "skuId") ?? "?"}×${field(it, "qty") ?? "?"}`)
      .join("; ");
    const addr = o.shippingAddress;
    return [
      o.id,
      o.placedAt,
      o.paidAt,
      o.status,
      o.paymentStatus,
      o.paymentMethod,
      o.createdVia,
      field(addr, "fullName") ?? c?.name ?? "",
      field(addr, "phone") ?? c?.phone ?? "",
      field(addr, "email") ?? c?.email ?? "",
      field(addr, "city"),
      field(addr, "state"),
      field(addr, "pincode"),
      itemCount,
      itemsSummary,
      o.subtotalInr,
      o.shippingInr,
      o.codFeeInr,
      o.discountInr,
      o.totalInr,
      o.couponCode,
      o.source,
      o.utmSource,
      o.utmMedium,
      o.utmCampaign,
      o.referrerHost,
      paidOrders ?? 0,
      activeSales ?? 0,
    ];
  });

  return toCsv(headers, data);
}

async function exportFunnel(
  window: MetricWindow,
  siteIds: string[],
): Promise<string> {
  const rows = await db
    .select()
    .from(funnelEvents)
    .where(
      and(
        inArray(funnelEvents.siteId, siteIds),
        gte(funnelEvents.createdAt, window.start),
        lt(funnelEvents.createdAt, window.end),
      ),
    )
    .orderBy(desc(funnelEvents.createdAt))
    .limit(FUNNEL_MAX + 1);
  if (rows.length > FUNNEL_MAX) throw new ExportLimitError("Funnel", FUNNEL_MAX);

  const headers = [
    "created_at",
    "type",
    "path",
    "session_id",
    "visitor_id",
    "order_id",
    "is_bot",
    "metadata",
  ];

  const data = rows.map((e) => [
    e.createdAt,
    e.type,
    e.path,
    e.sessionId,
    e.visitorId,
    e.orderId,
    e.isBot,
    e.metadata,
  ]);

  return toCsv(headers, data);
}

async function exportCustomers(siteIds: string[], window: MetricWindow | null): Promise<string> {
  // Site-scoped CRM export. Orders are joined only for the operator's sites, so
  // the order count / spend / last-order columns reflect what this admin can
  // see — never cross-site totals. A customer is included when they have at
  // least one order in scope OR their first_site_id is one of these sites.
  const paid = inArray(orders.status, [...PAID_STATUSES]);
  const rows = await db
    .select({
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      orderCount: sql<number>`count(${orders.id}) filter (where ${paid})::int`,
      revenue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${paid}), 0)::bigint`,
      lastOrder: sql<Date | null>`max(${orders.placedAt}) filter (where ${paid})`,
    })
    .from(customers)
    .leftJoin(
      orders,
      and(eq(orders.customerId, customers.id), inArray(orders.siteId, siteIds), ...(window ? [gte(orders.placedAt, window.start), lt(orders.placedAt, window.end)] : [])),
    )
    .groupBy(customers.id)
    .having(
      sql`count(${orders.id}) > 0 OR (${inArray(customers.firstSiteId, siteIds)} ${window ? sql`AND ${customers.createdAt} >= ${window.start.toISOString()} AND ${customers.createdAt} < ${window.end.toISOString()}` : sql``})`,
    )
    .orderBy(sql`coalesce(sum(${orders.totalInr}) filter (where ${paid}), 0) desc`)
    .limit(CUSTOMERS_MAX + 1);
  if (rows.length > CUSTOMERS_MAX) throw new ExportLimitError("Customers", CUSTOMERS_MAX);

  const headers = [
    "name",
    "phone",
    "email",
    "paid_orders_in_period",
    "active_sales_inr_in_period",
    "last_paid_order_in_period",
  ];

  const data = rows.map((c) => [
    c.name,
    c.phone,
    c.email,
    c.orderCount,
    c.revenue,
    c.lastOrder,
  ]);

  return toCsv(headers, data);
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dataset = req.nextUrl.searchParams.get("dataset");
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  // Preserve ?days=N download links, now using the same IST boundaries.
  if (params.days && !params.range) params.range = params.days;
  const hasWindow = ["range", "from", "to", "month", "year"].some((key) => key in params);
  const parsed = parseAnalyticsRange(params);
  if (hasWindow && parsed.error) return NextResponse.json({ error: parsed.error.split(" Showing the ")[0] }, { status: 400 });
  const window = hasWindow ? parsed : null;

  // Export covers the admin's stores. ?site=<id> narrows to one (validated
  // against the admin's sites so it can't widen access); default = all of them.
  const siteParam = req.nextUrl.searchParams.get("site");
  if (siteParam && !ctx.siteIds.includes(siteParam)) return NextResponse.json({ error: "Store is outside your admin access." }, { status: 403 });
  const siteIds =
    siteParam && ctx.siteIds.includes(siteParam) ? [siteParam] : ctx.siteIds;

  let csv: string;
  let name: string;
  try {
  if (dataset === "orders") {
    csv = await exportOrders(window, siteIds);
    name = "orders";
  } else if (dataset === "funnel") {
    // Funnel is high-volume — always windowed. Default 30 days.
    csv = await exportFunnel(window ?? parsed, siteIds);
    name = "funnel-events";
  } else if (dataset === "customers") {
    csv = await exportCustomers(siteIds, window);
    name = "customers";
  } else {
    return NextResponse.json(
      { error: "dataset must be 'orders', 'funnel', or 'customers'" },
      { status: 400 },
    );
  }
  } catch (error) {
    if (error instanceof ExportLimitError) return NextResponse.json({ error: error.message }, { status: 413 });
    throw error;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = window || dataset === "funnel" ? `-${parsed.fromYmd}-through-${parsed.toYmd}` : "-all-time";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prc-${name}${suffix}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
