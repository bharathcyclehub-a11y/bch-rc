import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import {
  PAID_STATUSES,
  PENDING_STATUSES,
  type OrderStatus,
} from "@/lib/order-status";
import { formatINR } from "@/lib/utils";
import { CustomersExport } from "./CustomersExport";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Customer views — the fix for "429 customers" being a meaningless number.
 *
 * A `customers` row is minted on the FIRST CHECKOUT ATTEMPT (upsert by phone in
 * /api/orders/create), not on the first payment. So the raw table counts anyone
 * who ever typed a phone number into checkout — including people whose card
 * failed and people who abandoned the cart. Before this, the list joined ALL
 * order rows with no status filter, so "Spent" summed failed/abandoned/returned
 * attempts as if they were revenue: the top "spender" (₹21,394) turned out to
 * have zero paid orders.
 *
 * Each view scopes BOTH the customer set and the Orders/Spent columns to one
 * status bucket, so "Spent" always means "money in this bucket" and never mixes
 * banked revenue with attempts. `paid` is the default because that's the only
 * view where Spent is true lifetime value.
 */
const VIEWS = {
  paid: {
    label: "Paid",
    sub: "Real revenue · paid + in-fulfilment",
    statuses: [...PAID_STATUSES],
  },
  pending: {
    label: "Pending",
    sub: "Checkout open, not yet paid",
    statuses: [...PENDING_STATUSES],
  },
  failed: {
    label: "Failed",
    sub: "Payment attempted, declined",
    statuses: ["FAILED"],
    danger: true,
  },
  cancelled: {
    label: "Cancelled",
    sub: "Cancelled before dispatch",
    statuses: ["CANCELLED"],
    danger: true,
  },
  returned: {
    label: "Returned",
    sub: "Shipped, came back (RTO)",
    statuses: ["RETURNED"],
    danger: true,
  },
  refunded: {
    label: "Refunded",
    sub: "Money returned to customer",
    statuses: ["REFUNDED"],
    danger: true,
  },
  abandoned: {
    label: "Abandoned",
    sub: "Left the cart, never paid",
    statuses: ["ABANDONED"],
    danger: true,
  },
  all: {
    label: "All",
    sub: "Everyone who gave a phone number",
    statuses: null, // no status filter — every order row, and every customer
  },
} as const satisfies Record<
  string,
  {
    label: string;
    sub: string;
    statuses: readonly OrderStatus[] | null;
    danger?: boolean;
  }
>;

type ViewKey = keyof typeof VIEWS;

const VIEW_ORDER = [
  "paid",
  "pending",
  "failed",
  "cancelled",
  "returned",
  "refunded",
  "abandoned",
  "all",
] as const satisfies readonly ViewKey[];

const DEFAULT_VIEW: ViewKey = "paid";

function isViewKey(v: string | undefined): v is ViewKey {
  return v !== undefined && v in VIEWS;
}

export default async function AdminCustomers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; view?: string }>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;

  const q = (sp.q ?? "").trim();
  const view: ViewKey = isViewKey(sp.view) ? sp.view : DEFAULT_VIEW;
  const statuses = VIEWS[view].statuses;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Server-side search across the three identity columns. Nullable columns
  // (name/email) just don't match on NULL, which is the behaviour we want.
  const searchWhere = q
    ? or(
        ilike(customers.name, `%${q}%`),
        ilike(customers.phone, `%${q}%`),
        ilike(customers.email, `%${q}%`),
      )
    : undefined;

  // Join condition for the selected view. INNER join (not left) so a customer
  // only appears when they actually have an order in this bucket — that's what
  // makes "Paid" a list of real buyers rather than the whole table with ₹0 rows.
  const joinOn = and(
    eq(orders.customerId, customers.id),
    inArray(orders.siteId, ctx.siteIds),
    statuses ? inArray(orders.status, [...statuses]) : undefined,
  );

  // Per-view customer counts for the tab chips — one pass over orders with
  // FILTER clauses, same trick the dashboard uses. Respects the search box.
  const countsFor = (s: readonly OrderStatus[]) =>
    sql<number>`count(distinct ${orders.customerId}) filter (where ${inArray(
      orders.status,
      [...s],
    )})::int`;

  const [list, [{ total }], [counts], [{ allCustomers }]] = await Promise.all([
    db
      .select({
        id: customers.id,
        phone: customers.phone,
        email: customers.email,
        name: customers.name,
        orderCount: sql<number>`count(${orders.id})::int`,
        revenue: sql<number>`coalesce(sum(${orders.totalInr}), 0)::int`,
      })
      .from(customers)
      .innerJoin(orders, joinOn)
      .where(searchWhere)
      .groupBy(customers.id)
      // Tiebreak on createdAt so page boundaries stay stable across requests.
      .orderBy(
        sql`coalesce(sum(${orders.totalInr}), 0) desc, ${customers.createdAt} desc`,
      )
      .limit(PAGE_SIZE)
      .offset(offset),

    // Distinct customers in THIS view — the denominator for pagination.
    statuses
      ? db
          .select({ total: sql<number>`count(distinct ${customers.id})::int` })
          .from(customers)
          .innerJoin(orders, joinOn)
          .where(searchWhere)
      : db
          .select({ total: sql<number>`count(*)::int` })
          .from(customers)
          .where(searchWhere),

    db
      .select({
        paid: countsFor(PAID_STATUSES),
        pending: countsFor(PENDING_STATUSES),
        failed: countsFor(["FAILED"]),
        cancelled: countsFor(["CANCELLED"]),
        returned: countsFor(["RETURNED"]),
        refunded: countsFor(["REFUNDED"]),
        abandoned: countsFor(["ABANDONED"]),
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(and(inArray(orders.siteId, ctx.siteIds), searchWhere)),

    db
      .select({ allCustomers: sql<number>`count(*)::int` })
      .from(customers)
      .where(searchWhere),
  ]);

  const tabCount: Record<ViewKey, number> = {
    paid: counts?.paid ?? 0,
    pending: counts?.pending ?? 0,
    failed: counts?.failed ?? 0,
    cancelled: counts?.cancelled ?? 0,
    returned: counts?.returned ?? 0,
    refunded: counts?.refunded ?? 0,
    abandoned: counts?.abandoned ?? 0,
    all: allCustomers ?? 0,
  };

  const start = total === 0 ? 0 : offset + 1;
  const end = offset + list.length;
  const hasPrev = page > 1;
  const hasNext = offset + list.length < total;

  const buildHref = (next: { view?: ViewKey; page?: number }) => {
    const v = next.view ?? view;
    const p = next.page ?? 1;
    const parts: string[] = [];
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    if (v !== DEFAULT_VIEW) parts.push(`view=${v}`);
    if (p > 1) parts.push(`page=${p}`);
    return `/admin/customers${parts.length ? "?" + parts.join("&") : ""}`;
  };

  const spentLabel = view === "paid" ? "Lifetime value" : "Value at risk";

  return (
    <div className="space-y-3 sm:space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-3xl font-bold text-brand-ink">
            Customers
          </h1>
          <p className="text-sm text-brand-ink-soft mt-1">
            {q
              ? `${total} result${total === 1 ? "" : "s"} for "${q}" in ${VIEWS[view].label}`
              : view === "paid"
                ? `${total} paying customers, ranked by lifetime value.`
                : view === "all"
                  ? `${total} people who reached checkout — most have never paid.`
                  : `${total} customers with ${VIEWS[view].label.toLowerCase()} orders.`}
          </p>
        </div>
        <CustomersExport />
      </div>

      {/* Search — GET form so the query lives in the URL (shareable, back-safe).
          Submitting resets to page 1 by omitting the page param. The hidden
          view field keeps you in the tab you were looking at. */}
      <form
        action="/admin/customers"
        method="GET"
        className="bg-white rounded-2xl border border-brand-line p-1.5 flex items-center gap-1.5"
      >
        {view !== DEFAULT_VIEW && (
          <input type="hidden" name="view" value={view} />
        )}
        <Search size={16} className="text-brand-ink-soft ml-2 shrink-0" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name, phone, or email…"
          className="flex-1 px-2 py-2 text-sm text-brand-ink placeholder:text-brand-ink-soft focus:outline-none bg-transparent"
        />
        {q && (
          <Link
            href={buildHref({})}
            className="text-xs text-brand-ink-soft hover:text-brand-ink px-2"
          >
            Clear
          </Link>
        )}
        <button
          type="submit"
          className="bg-brand-ink text-white text-xs font-semibold uppercase tracking-widest px-3 py-2 rounded-xl"
        >
          Search
        </button>
      </form>

      {/* View tabs — same chip language as the Orders board. */}
      <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden no-scrollbar">
        {VIEW_ORDER.map((key) => {
          const cfg = VIEWS[key];
          return (
            <ViewChip
              key={key}
              href={buildHref({ view: key })}
              label={cfg.label}
              sub={cfg.sub}
              count={tabCount[key]}
              active={view === key}
              danger={"danger" in cfg ? cfg.danger : undefined}
            />
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-brand-line overflow-x-auto no-scrollbar overflow-y-hidden">
        {list.length === 0 ? (
          <div className="px-5 py-10 sm:py-16 text-center">
            <Users size={32} className="text-brand-ink-soft mx-auto mb-2" />
            <p className="text-sm text-brand-ink-soft">
              {q
                ? `No customers match "${q}" in ${VIEWS[view].label}.`
                : `No customers with ${VIEWS[view].label.toLowerCase()} orders.`}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-brand-cream text-xs font-mono uppercase tracking-widest text-brand-ink-soft">
              <tr>
                <th className="px-3 sm:px-5 py-2.5 sm:py-3 text-left">Customer</th>
                <th className="px-3 sm:px-5 py-2.5 sm:py-3 text-left">Phone</th>
                <th className="px-3 sm:px-5 py-2.5 sm:py-3 text-right">Orders</th>
                <th className="px-3 sm:px-5 py-2.5 sm:py-3 text-right">
                  {spentLabel}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line">
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-brand-cream transition-colors">
                  <td className="px-3 sm:px-5 py-2.5 sm:py-3">
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="block font-semibold whitespace-nowrap text-brand-ink hover:text-brand-red"
                    >
                      {c.name ?? "—"}
                    </Link>
                    {c.email && (
                      <div className="text-xs text-brand-ink-soft whitespace-nowrap">
                        {c.email}
                      </div>
                    )}
                  </td>
                  <td className="px-3 sm:px-5 py-2.5 sm:py-3 font-mono whitespace-nowrap text-brand-ink-soft">
                    {c.phone}
                  </td>
                  <td className="px-3 sm:px-5 py-2.5 sm:py-3 text-right tabular-nums">
                    {c.orderCount}
                  </td>
                  <td className="px-3 sm:px-5 py-2.5 sm:py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                    {formatINR(c.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination — only render when there's more than one page. */}
      {(hasPrev || hasNext) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-brand-ink-soft tabular-nums">
            Showing {start}–{end} of {total}
          </p>
          <div className="flex items-center gap-2">
            {hasPrev ? (
              <Link
                href={buildHref({ page: page - 1 })}
                className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink hover:border-brand-ink transition-colors"
              >
                <ChevronLeft size={14} /> Prev
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink-soft opacity-50">
                <ChevronLeft size={14} /> Prev
              </span>
            )}
            {hasNext ? (
              <Link
                href={buildHref({ page: page + 1 })}
                className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink hover:border-brand-ink transition-colors"
              >
                Next <ChevronRight size={14} />
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink-soft opacity-50">
                Next <ChevronRight size={14} />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Status chip for the customer views — mirrors the Orders board chips. */
function ViewChip({
  href,
  label,
  sub,
  count,
  active,
  danger,
}: {
  href: string;
  label: string;
  sub: string;
  count: number;
  active: boolean;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`shrink-0 inline-flex flex-col items-start gap-0.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full sm:rounded-2xl transition-colors sm:min-w-[140px] ${
        active
          ? danger
            ? "bg-brand-red text-white"
            : "bg-brand-ink text-white"
          : "bg-white border border-brand-line text-brand-ink-soft hover:text-brand-ink"
      }`}
    >
      <div className="flex items-center gap-1.5 w-full">
        <span className="text-[13px] sm:text-sm font-semibold">{label}</span>
        <span
          className={`tabular-nums text-xs ${active ? "text-white/70" : "text-brand-ink-soft"}`}
        >
          {count}
        </span>
      </div>
      {/* Explainer sub-line is desktop-only — mobile chips are slim pills */}
      <span
        className={`hidden sm:block text-[10px] font-mono uppercase tracking-widest truncate ${
          active ? "text-white/60" : "text-brand-ink-soft"
        }`}
      >
        {sub}
      </span>
    </Link>
  );
}
