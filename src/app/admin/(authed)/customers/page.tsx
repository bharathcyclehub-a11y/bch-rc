import Link from "next/link";
import { ChevronRight, SearchX, Users } from "lucide-react";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { PAID_STATUSES, PENDING_STATUSES, VALID_ORDER_STATUSES, type OrderStatus } from "@/lib/order-status";
import { customerSegmentOf, HIGH_VALUE_INR, INACTIVE_DAYS, NEW_CUSTOMER_DAYS } from "@/lib/admin/status";
import { formatMonthYear, formatPhone, formatRelative, plural, requestTime } from "@/lib/admin/format";
import { cn, formatINR } from "@/lib/utils";
import { Avatar } from "@/components/admin/Avatar";
import { SegmentBadge } from "@/components/admin/Badge";
import { ButtonLink } from "@/components/admin/Button";
import { EmptyState } from "@/components/admin/EmptyState";
import { UrlFilters, type FilterDef } from "@/components/admin/Filters";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { Panel } from "@/components/admin/Panel";
import { SearchForm } from "@/components/admin/SearchForm";
import { RowLink, Table, TBody, TD, TH, THead, TR } from "@/components/admin/Table";
import { Tabs } from "@/components/admin/Tabs";
import { CustomerRowActions } from "./CustomerRowActions";
import { CustomersExport } from "./CustomersExport";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DAY_MS = 86_400_000;

const SEGMENTS = ["all", "repeat", "high", "new", "inactive"] as const;
type Segment = (typeof SEGMENTS)[number];

const SORTS = ["ltv", "orders", "recent", "newest"] as const;
type Sort = (typeof SORTS)[number];

const SEGMENT_LABEL: Record<Segment, string> = {
  all: "All",
  repeat: "Repeat",
  high: "High value",
  new: `New (${NEW_CUSTOMER_DAYS} days)`,
  inactive: `Inactive (${INACTIVE_DAYS}+ days)`,
};

const SORT_PHRASE: Record<Sort, string> = {
  ltv: "ranked by lifetime value",
  orders: "ranked by orders",
  recent: "sorted by last order",
  newest: "newest first",
};

const SORT_FILTER: FilterDef = {
  key: "sort",
  label: "Sort",
  anyValue: "ltv",
  options: [
    { value: "ltv", label: "Lifetime value" },
    { value: "orders", label: "Orders" },
    { value: "recent", label: "Last order" },
    { value: "newest", label: "Newest" },
  ],
};

/**
 * Status views: narrow the list to customers with at least one order in a
 * status bucket (e.g. who failed payment, who abandoned). Lifetime value stays
 * paid-only, so a Failed-view customer can correctly show ₹0.
 */
const VIEWS = {
  all: { label: "Any status", statuses: null },
  paid: { label: "Paid", statuses: PAID_STATUSES },
  pending: { label: "Pending", statuses: PENDING_STATUSES },
  failed: { label: "Failed", statuses: ["FAILED"] },
  cancelled: { label: "Cancelled", statuses: ["CANCELLED"] },
  returned: { label: "Returned", statuses: ["RETURNED"] },
  refunded: { label: "Refunded", statuses: ["REFUNDED"] },
  abandoned: { label: "Abandoned", statuses: ["ABANDONED"] },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] | null }>;
type View = keyof typeof VIEWS;
const VIEW_KEYS = Object.keys(VIEWS) as View[];

const VIEW_FILTER: FilterDef = {
  key: "view",
  label: "Status",
  anyValue: "all",
  options: VIEW_KEYS.map((v) => ({ value: v, label: VIEWS[v].label })),
};

type ListState = { q: string; segment: Segment; sort: Sort; view: View };
type SearchParams = Record<string, string | string[] | undefined>;

// ── SQL building blocks ─────────────────────────────────────────────────────
// Every value below is a bound parameter (status names, cutoffs, thresholds);
// nothing user-supplied is interpolated into the query text.

/** `array[$1, $2, …]::text[]` of order statuses. */
function statusArray(list: readonly string[]): SQL {
  return sql`array[${sql.join(
    list.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;
}

const IS_VALID = sql`${orders.status}::text = ANY(${statusArray(VALID_ORDER_STATUSES)})`;
const IS_PAID = sql`${orders.status}::text = ANY(${statusArray(PAID_STATUSES)})`;

// Per-customer aggregates over the (site-scoped) left-joined orders. With no
// matching orders the joined columns are NULL, so FILTER drops them: count → 0,
// sum → NULL (coalesced to 0), max → NULL.
const ORDER_COUNT = sql`count(${orders.id}) FILTER (WHERE ${IS_VALID})`;
const PAID_COUNT = sql`count(${orders.id}) FILTER (WHERE ${IS_PAID})`;
const LTV = sql`coalesce(sum(${orders.totalInr}) FILTER (WHERE ${IS_PAID}), 0)`;
const LAST_ORDER = sql`max(${orders.placedAt}) FILTER (WHERE ${IS_VALID})`;

/** HAVING for the status view: at least one order in the bucket. */
function viewHaving(view: View): SQL | undefined {
  const statuses = VIEWS[view].statuses;
  if (!statuses) return undefined;
  return sql`count(${orders.id}) FILTER (WHERE ${orders.status}::text = ANY(${statusArray(statuses)})) > 0`;
}

type SegmentCols = { orderCount: SQL.Aliased | SQL; ltv: SQL.Aliased | SQL; lastOrderAt: SQL.Aliased | SQL };

/**
 * The single definition of each aggregate segment. Used as HAVING on the page
 * query (over the aggregate expressions) and as count(*) FILTER in the tab
 * counts (over the subquery's columns), so a tab count always equals the
 * number of rows its list shows. "new" is a plain column test (WHERE).
 */
function segmentHaving(segment: Segment, c: SegmentCols, inactiveCutoffIso: string): SQL | undefined {
  switch (segment) {
    case "repeat":
      return sql`${c.orderCount} >= 2`;
    case "high":
      return sql`${c.ltv} >= ${HIGH_VALUE_INR}`;
    case "inactive":
      return sql`(${c.orderCount} >= 1 AND ${c.lastOrderAt} < ${inactiveCutoffIso})`;
    default:
      return undefined;
  }
}

function orderByFor(sort: Sort): SQL[] {
  const tiebreak = [desc(customers.createdAt), asc(customers.id)];
  switch (sort) {
    case "orders":
      return [desc(ORDER_COUNT), ...tiebreak];
    case "recent":
      return [sql`${LAST_ORDER} desc nulls last`, ...tiebreak];
    case "newest":
      return tiebreak;
    default:
      return [desc(LTV), ...tiebreak];
  }
}

/** Name / phone / email match. Also matches a phone typed the way we display it ("98201 44102", "+91 …"). */
function searchCondition(q: string): SQL | undefined {
  if (!q) return undefined;
  const conds: SQL[] = [
    ilike(customers.name, `%${q}%`),
    ilike(customers.phone, `%${q}%`),
    ilike(customers.email, `%${q}%`),
  ];
  const digits = q.replace(/\D/g, "");
  const tail = digits.length > 10 ? digits.slice(-10) : digits;
  if (tail.length >= 4 && tail !== q) conds.push(ilike(customers.phone, `%${tail}%`));
  return or(...conds);
}

/** Request clock + the segment cutoffs derived from it. */
function requestClock() {
  const now = requestTime();
  return {
    now,
    newCutoffIso: new Date(now - NEW_CUSTOMER_DAYS * DAY_MS).toISOString(),
    inactiveCutoffIso: new Date(now - INACTIVE_DAYS * DAY_MS).toISOString(),
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireAdmin();
  const sp = await searchParams;

  const state: ListState = {
    q: first(sp.q).trim(),
    segment: pick(SEGMENTS, first(sp.segment), "all"),
    sort: pick(SORTS, first(sp.sort), "ltv"),
    view: pick(VIEW_KEYS, first(sp.view), "all"),
  };
  const page = Math.min(100_000, Math.max(1, Number.parseInt(first(sp.page), 10) || 1));
  const offset = (page - 1) * PAGE_SIZE;
  const { now, newCutoffIso, inactiveCutoffIso } = requestClock();

  // Orders are joined only for the admin's sites; customers themselves are global.
  const joinOn = and(eq(orders.customerId, customers.id), inArray(orders.siteId, ctx.siteIds));
  const searchWhere = searchCondition(state.q);
  const isNew = sql`${customers.createdAt} >= ${newCutoffIso}`;

  // Searched (but unsegmented) aggregate — the base for the tab counts.
  const agg = db
    .select({
      id: customers.id,
      createdAt: customers.createdAt,
      orderCount: ORDER_COUNT.as("order_count"),
      ltv: LTV.as("ltv"),
      lastOrderAt: LAST_ORDER.as("last_order_at"),
    })
    .from(customers)
    .leftJoin(orders, joinOn)
    .where(searchWhere)
    .groupBy(customers.id)
    .having(viewHaving(state.view))
    .as("agg");

  const countIf = (cond: SQL | undefined) =>
    sql<number>`(count(*) FILTER (WHERE ${cond ?? sql`true`}))::int`;

  const [rows, [counts]] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        createdAt: customers.createdAt,
        orderCount: sql<number>`(${ORDER_COUNT})::int`,
        paidCount: sql<number>`(${PAID_COUNT})::int`,
        ltv: sql<number>`(${LTV})::int`,
        lastOrderAt: sql<string | null>`${LAST_ORDER}`,
      })
      .from(customers)
      .leftJoin(orders, joinOn)
      .where(and(searchWhere, state.segment === "new" ? isNew : undefined))
      .groupBy(customers.id)
      .having(
        and(
          segmentHaving(state.segment, { orderCount: ORDER_COUNT, ltv: LTV, lastOrderAt: LAST_ORDER }, inactiveCutoffIso),
          viewHaving(state.view),
        ),
      )
      .orderBy(...orderByFor(state.sort))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({
        all: sql<number>`count(*)::int`,
        repeat: countIf(segmentHaving("repeat", agg, inactiveCutoffIso)),
        high: countIf(segmentHaving("high", agg, inactiveCutoffIso)),
        new: countIf(sql`${agg.createdAt} >= ${newCutoffIso}`),
        inactive: countIf(segmentHaving("inactive", agg, inactiveCutoffIso)),
      })
      .from(agg),
  ]);

  // The tab count for the active segment IS the filtered total: same predicate,
  // same search, so pagination and the tab badge can never disagree.
  const total = counts?.[state.segment] ?? 0;
  const list = rows.map((r) => ({ ...r, lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null }));

  const start = list.length === 0 ? 0 : offset + 1;
  const end = offset + list.length;
  const hasPrev = page > 1;
  const hasNext = end < total;

  const description = state.q
    ? `${plural(total, "result")} for “${state.q}”`
    : `${plural(counts?.all ?? 0, "customer")}${state.view === "all" ? "" : ` with ${VIEWS[state.view].label.toLowerCase()} orders`} · ${plural(counts?.repeat ?? 0, "repeat buyer")} · ${SORT_PHRASE[state.sort]}`;

  return (
    <>
      <PageHeader title="Customers" description={description} actions={<CustomersExport />} />

      <Tabs
        ariaLabel="Customer segments"
        active={state.segment}
        className="mb-4"
        items={SEGMENTS.map((s) => ({
          key: s,
          label: SEGMENT_LABEL[s],
          count: counts?.[s] ?? 0,
          href: customersHref({ ...state, segment: s }),
        }))}
      />

      <div className="mb-4 flex items-center gap-2">
        <SearchForm
          action="/admin/customers"
          defaultValue={state.q}
          placeholder="Search name, phone, email"
          keep={{
            segment: state.segment === "all" ? undefined : state.segment,
            sort: state.sort === "ltv" ? undefined : state.sort,
            view: state.view === "all" ? undefined : state.view,
          }}
          clearHref={customersHref({ ...state, q: "" })}
        />
        <UrlFilters filters={[VIEW_FILTER, SORT_FILTER]} />
      </div>

      <Panel>
        {list.length === 0 ? (
          <ListEmpty state={state} page={page} total={total} />
        ) : (
          <>
            <CustomersTable rows={list} now={now} />
            <CustomerRows rows={list} now={now} />
            <Pagination
              summary={`Showing ${start.toLocaleString("en-IN")}–${end.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
              prevHref={hasPrev ? customersHref({ ...state, page: page - 1 }) : null}
              nextHref={hasNext ? customersHref({ ...state, page: page + 1 }) : null}
            />
          </>
        )}
      </Panel>
    </>
  );
}

// ── Views ───────────────────────────────────────────────────────────────────

type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  createdAt: Date;
  orderCount: number;
  paidCount: number;
  ltv: number;
  lastOrderAt: Date | null;
};

// Compact cell padding keeps all nine columns inside a 1280px viewport with the
// 240px sidebar; the first/last cells keep the panel's 16px inset.
const CELL = "px-3 first:pl-4 last:pr-4";

function CustomersTable({ rows, now }: { rows: CustomerRow[]; now: number }) {
  return (
    <Table className="hidden md:block">
      <THead>
        <TH className={CELL}>Customer</TH>
        <TH className={CELL}>Phone</TH>
        <TH align="right" className={CELL}>
          Orders
        </TH>
        <TH align="right" className={cn(CELL, "whitespace-normal")}>
          Lifetime value
        </TH>
        <TH align="right" className={cn(CELL, "hidden whitespace-normal xl:table-cell")}>
          Avg order
        </TH>
        <TH className={cn(CELL, "hidden whitespace-normal lg:table-cell")}>Last order</TH>
        <TH className={cn(CELL, "hidden whitespace-normal xl:table-cell")}>Customer since</TH>
        <TH className={CELL}>Segment</TH>
        <TH className={cn(CELL, "w-12")}>
          <span className="sr-only">Actions</span>
        </TH>
      </THead>
      <TBody>
        {rows.map((c) => (
          <TR key={c.id}>
            {/* 28% + max-w-0: flexible but capped (wide screens spread the rest); truncates. */}
            <TD className={cn(CELL, "w-[28%] max-w-0")}>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={c.name} />
                <div className="min-w-0">
                  <RowLink href={`/admin/customers/${c.id}`} className="block truncate">
                    {c.name?.trim() || "Anonymous customer"}
                  </RowLink>
                  {c.email && <p className="truncate text-xs text-admin-muted">{c.email}</p>}
                </div>
              </div>
            </TD>
            <TD nowrap className={cn(CELL, "font-mono text-brand-ink-soft")}>
              {formatPhone(c.phone)}
            </TD>
            <TD align="right" nowrap className={CELL}>
              {c.orderCount.toLocaleString("en-IN")}
            </TD>
            <TD align="right" nowrap className={cn(CELL, "font-semibold", c.ltv === 0 && "font-normal text-admin-muted")}>
              {formatINR(c.ltv)}
            </TD>
            <TD align="right" nowrap className={cn(CELL, "hidden text-brand-ink-soft xl:table-cell")}>
              {c.paidCount > 0 ? formatINR(Math.round(c.ltv / c.paidCount)) : "—"}
            </TD>
            <TD nowrap className={cn(CELL, "hidden lg:table-cell")}>
              {c.lastOrderAt ? formatRelative(c.lastOrderAt, now) : <span className="text-admin-muted">—</span>}
            </TD>
            <TD nowrap className={cn(CELL, "hidden text-brand-ink-soft xl:table-cell")}>
              {formatMonthYear(c.createdAt)}
            </TD>
            <TD nowrap className={CELL}>
              <SegmentBadge segment={customerSegmentOf(c.orderCount, c.lastOrderAt, now)} />
            </TD>
            <TD interactive className={cn(CELL, "py-0 text-right")}>
              <CustomerRowActions id={c.id} name={c.name} phone={c.phone} email={c.email} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** Phones: one panel of divided rows; the whole row opens the profile. */
function CustomerRows({ rows, now }: { rows: CustomerRow[]; now: number }) {
  return (
    <ul className="divide-y divide-admin-line md:hidden">
      {rows.map((c) => (
        <li key={c.id}>
          <Link
            href={`/admin/customers/${c.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-admin-subtle"
          >
            <Avatar name={c.name} className="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-ink">
                  {c.name?.trim() || "Anonymous customer"}
                </p>
                <p
                  className={cn(
                    "shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-brand-ink",
                    c.ltv === 0 && "font-normal text-admin-muted",
                  )}
                >
                  {formatINR(c.ltv)}
                </p>
              </div>
              <p className="mt-0.5 whitespace-nowrap font-mono text-xs text-admin-muted">{formatPhone(c.phone)}</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-xs text-admin-muted">
                  {plural(c.orderCount, "order")} ·{" "}
                  {c.lastOrderAt
                    ? formatRelative(c.lastOrderAt, now)
                    : `Joined ${formatMonthYear(c.createdAt)}`}
                </p>
                <span className="shrink-0">
                  <SegmentBadge segment={customerSegmentOf(c.orderCount, c.lastOrderAt, now)} />
                </span>
              </div>
            </div>
            <ChevronRight size={16} aria-hidden className="shrink-0 text-admin-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ListEmpty({ state, page, total }: { state: ListState; page: number; total: number }) {
  if (total > 0 && page > 1) {
    return (
      <EmptyState
        icon={Users}
        title="No more customers"
        description={`This list has ${plural(total, "customer")}; page ${page.toLocaleString("en-IN")} is past the end.`}
        action={
          <ButtonLink href={customersHref({ ...state, page: 1 })} size="sm">
            Back to first page
          </ButtonLink>
        }
      />
    );
  }
  if (state.q) {
    return (
      <EmptyState
        icon={SearchX}
        title={`No customers match “${state.q}”`}
        description={
          state.segment === "all"
            ? "Check the spelling, or search by phone number or email instead."
            : `Nothing in ${SEGMENT_LABEL[state.segment]} matches. Try All customers or a different search.`
        }
        action={
          <ButtonLink href={customersHref({ ...state, q: "" })} size="sm">
            Clear search
          </ButtonLink>
        }
      />
    );
  }
  if (state.segment !== "all") {
    return (
      <EmptyState
        icon={Users}
        title={`No customers in ${SEGMENT_LABEL[state.segment]}`}
        description="Nobody fits this segment right now."
        action={
          <ButtonLink href={customersHref({ ...state, segment: "all" })} size="sm">
            View all customers
          </ButtonLink>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={Users}
      title="No customers yet"
      description="Customers appear here after their first checkout."
    />
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** List URL with defaults omitted (segment=all, sort=ltv, page=1). */
function customersHref(s: ListState & { page?: number }): string {
  const params = new URLSearchParams();
  if (s.q) params.set("q", s.q);
  if (s.segment !== "all") params.set("segment", s.segment);
  if (s.sort !== "ltv") params.set("sort", s.sort);
  if (s.view !== "all") params.set("view", s.view);
  if (s.page && s.page > 1) params.set("page", String(s.page));
  const qs = params.toString();
  return qs ? `/admin/customers?${qs}` : "/admin/customers";
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function pick<T extends string>(allowed: readonly T[], raw: string, fallback: T): T {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
