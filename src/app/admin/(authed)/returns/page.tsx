import Link from "next/link";
import { and, desc, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { formatINR, formatIST } from "@/lib/utils";
import { resolveAdminRange } from "@/lib/admin-range";
import { RangeTabs } from "../RangeTabs";

export const dynamic = "force-dynamic";

type ReturnStatus = "RETURNED" | "REFUNDED" | "CANCELLED";

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "CANCELLED"
      ? "bg-brand-ink-soft/10 text-brand-ink-soft"
      : "bg-brand-red/10 text-brand-red"; // RETURNED + REFUNDED
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full ${tone}`}
    >
      {status}
    </span>
  );
}

export default async function AdminReturns({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;

  // This page had NO window at all — every figure was all-time, so the RTO rate
  // could never show whether returns were getting better or worse. Same parser
  // as Finance and the dashboard, so a given preset means the same span here.
  const range = resolveAdminRange(sp, { defaultDays: 30 });

  // Windowed on placedAt (not on when the return happened) so the RTO rate is
  // returns ÷ dispatches for the SAME cohort of orders — comparing returns
  // recorded this month against orders placed this month would flatter a
  // growing month and punish a shrinking one.
  const windowWhere = and(
    inArray(orders.siteId, ctx.siteIds),
    gte(orders.placedAt, range.from),
    range.to ? lt(orders.placedAt, range.to) : undefined,
  );

  const [agg, list] = await Promise.all([
    db
      .select({
        returnedCount: sql<number>`count(*) filter (where ${orders.status} = 'RETURNED')::int`,
        returnedValue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${orders.status} = 'RETURNED'),0)::int`,
        refundedCount: sql<number>`count(*) filter (where ${orders.status} = 'REFUNDED')::int`,
        refundedValue: sql<number>`coalesce(sum(${orders.totalInr}) filter (where ${orders.status} = 'REFUNDED'),0)::int`,
        cancelledCount: sql<number>`count(*) filter (where ${orders.status} = 'CANCELLED')::int`,
        dispatched: sql<number>`count(*) filter (where ${orders.status} in ('SHIPPED','DELIVERED','RETURNED'))::int`,
      })
      .from(orders)
      .where(windowWhere)
      .then((r) => r[0]),
    db
      .select({
        id: orders.id,
        siteId: orders.siteId,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        totalInr: orders.totalInr,
        awbCode: orders.awbCode,
        placedAt: orders.placedAt,
        shippingAddress: orders.shippingAddress,
      })
      .from(orders)
      .where(
        and(
          windowWhere,
          inArray(orders.status, [
            "RETURNED",
            "REFUNDED",
            "CANCELLED",
          ] as ReturnStatus[]),
        ),
      )
      .orderBy(desc(orders.placedAt))
      .limit(100),
  ]);

  const returnedCount = agg?.returnedCount ?? 0;
  const returnedValue = agg?.returnedValue ?? 0;
  const refundedCount = agg?.refundedCount ?? 0;
  const refundedValue = agg?.refundedValue ?? 0;
  const cancelledCount = agg?.cancelledCount ?? 0;
  const dispatched = agg?.dispatched ?? 0;

  const rtoRatePct =
    dispatched > 0 ? Math.round((returnedCount / dispatched) * 100) : null;

  return (
    <div className="space-y-3 sm:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-3xl font-bold text-brand-ink">
            Returns / RTO
          </h1>
          <p className="text-sm text-brand-ink-soft mt-1">
            Return-to-origin, refunds and cancellations — kept distinct, from the
            orders ledger. {range.label[0].toUpperCase() + range.label.slice(1)},
            by order date.
          </p>
        </div>
        <RangeTabs presets={[7, 14, 30, 90]} defaultRange={30} custom />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            RTO rate
          </div>
          <div
            className={`font-display text-xl sm:text-3xl font-bold mt-2 tabular-nums ${
              rtoRatePct != null && rtoRatePct > 15
                ? "text-brand-red"
                : "text-brand-ink"
            }`}
          >
            {rtoRatePct ?? "—"}%
          </div>
          <div className="text-xs text-brand-ink-soft mt-1">
            {returnedCount} of {dispatched} dispatched
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            RTO value
          </div>
          <div className="font-display text-xl sm:text-3xl font-bold mt-2 tabular-nums text-brand-ink">
            {formatINR(returnedValue)}
          </div>
          <div className="text-xs text-brand-ink-soft mt-1">
            returned to origin (freight loss)
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            Refunds
          </div>
          <div className="font-display text-xl sm:text-3xl font-bold mt-2 tabular-nums text-brand-ink">
            {formatINR(refundedValue)}
          </div>
          <div className="text-xs text-brand-ink-soft mt-1">
            {refundedCount} orders
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
          <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-brand-ink-soft">
            Cancelled
          </div>
          <div className="font-display text-xl sm:text-3xl font-bold mt-2 tabular-nums text-brand-ink">
            {cancelledCount}
          </div>
          <div className="text-xs text-brand-ink-soft mt-1">before dispatch</div>
        </div>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-brand-line overflow-hidden">
          <p className="px-5 py-10 text-center text-sm text-brand-ink-soft">
            No returns, refunds or cancellations yet. ✅
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-brand-line overflow-hidden">
          <div className="px-3.5 py-3 sm:px-5 sm:py-4 border-b border-brand-line">
            <h2 className="font-semibold text-brand-ink">
              Return &amp; refund orders
            </h2>
          </div>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-mono uppercase tracking-wider text-brand-ink-soft border-b border-brand-line">
                  <th className="text-left px-3.5 sm:px-5 py-2 whitespace-nowrap">Order</th>
                  <th className="text-left px-3.5 sm:px-5 py-2 whitespace-nowrap">Customer</th>
                  <th className="hidden sm:table-cell text-left px-5 py-2">AWB</th>
                  <th className="hidden sm:table-cell text-left px-5 py-2">Payment</th>
                  <th className="text-right px-3.5 sm:px-5 py-2 whitespace-nowrap">Total</th>
                  <th className="text-left px-3.5 sm:px-5 py-2 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {list.map((o) => {
                  const addr = o.shippingAddress as {
                    fullName?: string;
                    phone?: string;
                  };
                  return (
                    <tr key={o.id}>
                      <td className="px-3.5 sm:px-5 py-3 whitespace-nowrap">
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="font-mono font-semibold text-brand-ink hover:text-brand-red"
                        >
                          {o.id}
                        </Link>
                        <div className="text-xs text-brand-ink-soft mt-0.5">
                          {formatIST(o.placedAt)}
                        </div>
                      </td>
                      <td className="px-3.5 sm:px-5 py-3 text-brand-ink whitespace-nowrap">
                        {addr.fullName ?? "—"}
                      </td>
                      <td className="hidden sm:table-cell px-5 py-3 font-mono text-xs text-brand-ink-soft">
                        {o.awbCode ?? "—"}
                      </td>
                      <td className="hidden sm:table-cell px-5 py-3 text-brand-ink-soft">
                        {o.paymentMethod}
                      </td>
                      <td className="px-3.5 sm:px-5 py-3 text-right tabular-nums text-brand-ink whitespace-nowrap">
                        {formatINR(o.totalInr)}
                      </td>
                      <td className="px-3.5 sm:px-5 py-3">
                        <StatusPill status={o.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
