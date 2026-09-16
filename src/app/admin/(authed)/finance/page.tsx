import { and, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { formatINR } from "@/lib/utils";
import { PAID_STATUSES } from "@/lib/order-status";
import { resolveAdminRange } from "@/lib/admin-range";
import { RangeTabs } from "../RangeTabs";

export const dynamic = "force-dynamic";

export default async function AdminFinance({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;

  // Day boundaries are IST, NOT the server's UTC (Vercel). resolveAdminRange
  // is the same parser the dashboard and Returns use, so "30 days" means the
  // identical span on every page — it did not before, when this window was a
  // hardcoded -29 days with no way to change it.
  const range = resolveAdminRange(sp, { defaultDays: 30 });

  const windowWhere = and(
    gte(orders.placedAt, range.from),
    range.to ? lt(orders.placedAt, range.to) : undefined,
    inArray(orders.siteId, ctx.siteIds),
  );

  // COD statuses that mean "parcel is out there, cash not collected yet".
  const COD_IN_FLIGHT = [
    "PENDING_COD_VERIFICATION",
    "PAID",
    "PACKED",
    "SHIPPED",
  ] as const;

  // One aggregation pass over the real orders ledger. Every figure is a FILTER
  // over the actual status/paymentMethod columns — no mock or derived numbers.
  const [totals, methodRows, codInFlight] = await Promise.all([
    db
      .select({
        collectedRevenue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${orders.status} in ('PAID','PACKED','SHIPPED','DELIVERED','REFUNDED')), 0)::float8`,
        paidRevenue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${orders.status} in ('PAID','PACKED','SHIPPED','DELIVERED')), 0)::float8`,
        refundValue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${orders.status} = 'REFUNDED'), 0)::float8`,
        refundCount: sql<number>`count(*) filter (where ${orders.status} = 'REFUNDED')::int`,
        rtoLossValue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${orders.status} = 'RETURNED'), 0)::float8`,
        rtoCount: sql<number>`count(*) filter (where ${orders.status} = 'RETURNED')::int`,
        paidCount: sql<number>`count(*) filter (where ${orders.status} in ('PAID','PACKED','SHIPPED','DELIVERED'))::int`,
      })
      .from(orders)
      .where(windowWhere)
      .then((r) => r[0]),
    // Active sales value by payment method; COD may still be uncollected.
    db
      .select({
        method: orders.paymentMethod,
        paidCount: sql<number>`count(*)::int`,
        paidRevenue: sql<number>`coalesce(sum(${orders.totalInr}), 0)::float8`,
      })
      .from(orders)
      .where(
        and(windowWhere, inArray(orders.status, [...PAID_STATUSES])),
      )
      .groupBy(orders.paymentMethod)
      .orderBy(sql`coalesce(sum(${orders.totalInr}), 0) desc`),

    /**
     * COD in flight — deliberately NOT windowed, and deliberately not `total_inr`.
     *
     * Two bugs lived here. (1) It sat inside the 30-day window, so a COD parcel
     * shipped 45 days ago and still uncollected silently dropped out of "in
     * flight" — but this is a STOCK figure (cash owed to us right now), not a
     * flow over a period, so a date filter can only ever understate it.
     * (2) It summed `total_inr`, while the amount the courier actually collects
     * is `total_inr - confirmation_fee_inr` (see the schema note on
     * confirmationFeeInr: for partial-prepaid COD we already captured that fee
     * up front). Every such order overstated the outstanding cash by its fee.
     */
    db
      .select({
        value: sql<number>`coalesce(sum(${orders.totalInr} - ${orders.confirmationFeeInr}), 0)::float8`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.siteId, ctx.siteIds),
          sql`${orders.paymentMethod} = 'COD'`,
          inArray(orders.status, [...COD_IN_FLIGHT]),
        ),
      )
      .then((r) => r[0]),
  ]);

  const collectedRevenue = totals?.collectedRevenue ?? 0;
  const refundValue = totals?.refundValue ?? 0;
  const refundCount = totals?.refundCount ?? 0;
  const codInFlightValue = codInFlight?.value ?? 0;
  const codInFlightCount = codInFlight?.count ?? 0;
  const rtoValue = totals?.rtoLossValue ?? 0;
  const rtoCount = totals?.rtoCount ?? 0;
  const paidCount = totals?.paidCount ?? 0;

  // Active order value after excluding fully refunded order statuses.
  // This is not a cash-settlement or partial-refund ledger.
  const netRevenue = collectedRevenue - refundValue;

  const isEmpty = paidCount === 0 && collectedRevenue === 0;

  return (
    <div className="space-y-3 sm:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-3xl font-bold text-brand-ink">
            Finance
          </h1>
          <p className="text-sm text-brand-ink-soft mt-1">
            {range.label[0].toUpperCase() + range.label.slice(1)} · IST · gross,
            paid, refunds and RTO from the orders ledger. COD in flight is
            all-time.
          </p>
        </div>
        <RangeTabs
          presets={[1, 7, 14, 30, 90]}
          defaultRange={30}
          custom
        />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            Sales including refunded orders
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-brand-ink mt-2 tabular-nums">
            {formatINR(collectedRevenue)}
          </p>
          <p className="text-xs text-brand-ink-soft mt-1">
            {paidCount} paid · incl. since-refunded
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            Active sales value
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-success mt-2 tabular-nums">
            {formatINR(netRevenue)}
          </p>
          <p className="text-xs text-brand-ink-soft mt-1">
            sales − {refundCount} refund{refundCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            Refunds
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-brand-ink mt-2 tabular-nums">
            {formatINR(refundValue)}
          </p>
          <p className="text-xs text-brand-ink-soft mt-1">
            {refundCount} orders
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            COD in flight
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-brand-ink mt-2 tabular-nums">
            {formatINR(codInFlightValue)}
          </p>
          <p className="text-xs text-brand-ink-soft mt-1">
            {codInFlightCount} shipments, not yet collected
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            RTO value
          </p>
          <p
            className={`font-display text-xl sm:text-2xl font-bold mt-2 tabular-nums ${
              rtoCount > 0 ? "text-brand-red" : "text-brand-ink"
            }`}
          >
            {formatINR(rtoValue)}
          </p>
          <p className="text-xs text-brand-ink-soft mt-1">
            {rtoCount} returned to origin
          </p>
        </div>
      </div>

      {/* Revenue by payment method */}
      <div className="bg-white rounded-2xl border border-brand-line">
        <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-brand-line">
          <h2 className="font-semibold text-brand-ink">
            Sales value by payment method{" "}
            <span className="text-brand-ink-soft font-normal">
              — {range.label}, paid
            </span>
          </h2>
        </div>
        {isEmpty || methodRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-brand-ink-soft">
            No orders in this window yet.
          </p>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-mono uppercase tracking-wider text-brand-ink-soft border-b border-brand-line">
                  <th className="text-left px-3 sm:px-5 py-3 font-semibold">Method</th>
                  <th className="text-right px-3 sm:px-5 py-3 font-semibold">Orders</th>
                  <th className="text-right px-3 sm:px-5 py-3 font-semibold whitespace-nowrap">
                    Paid revenue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {methodRows.map((m) => (
                  <tr key={m.method}>
                    <td className="px-3 sm:px-5 py-2.5 sm:py-3 font-semibold text-brand-ink">
                      {m.method}
                    </td>
                    <td className="px-3 sm:px-5 py-2.5 sm:py-3 text-right tabular-nums text-brand-ink-soft">
                      {m.paidCount}
                    </td>
                    <td className="px-3 sm:px-5 py-2.5 sm:py-3 text-right tabular-nums font-semibold whitespace-nowrap text-brand-ink">
                      {formatINR(m.paidRevenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-brand-ink-soft">
        Sales are order values by current status, not verified cash receipts. Active sales
        exclude fully refunded orders and can include uncollected COD. Partial refunds and courier settlements need separate reconciliation. RTO value is the <b>order value</b> of returns, not
        the freight loss — true reverse-logistics cost isn&rsquo;t tracked in the
        orders table. Figures come straight from the orders ledger;
        settlement/GST reconciliation against Razorpay is not wired yet.
      </p>
    </div>
  );
}
