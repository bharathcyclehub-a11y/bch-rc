import Link from "next/link";
import { ChevronRight, Download, Inbox, Package, Plus, SearchX } from "lucide-react";
import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { bucketOfStatus, FAILED_STATUSES, PAID_STATUSES, PENDING_STATUSES } from "@/lib/order-status";
import { formatDateTimeShort, formatPhone } from "@/lib/admin/format";
import { PAYMENT_METHOD_LABEL, paymentStateMeta } from "@/lib/admin/status";
import { formatINR } from "@/lib/utils";
import { OrderStatusBadge, Tag } from "@/components/admin/Badge";
import { buttonClass, ButtonLink } from "@/components/admin/Button";
import { EmptyState } from "@/components/admin/EmptyState";
import { UrlFilters, type FilterDef } from "@/components/admin/Filters";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { Panel } from "@/components/admin/Panel";
import { SearchForm } from "@/components/admin/SearchForm";
import { RowLink, Table, TBody, TD, TH, THead, TR } from "@/components/admin/Table";
import { Tabs } from "@/components/admin/Tabs";
import { OrderRowActions } from "./OrderRowActions";

const PAGE_SIZE = 50;

/**
 * Views (tabs). Status sets come from @/lib/order-status so counts agree with
 * analytics:
 *   live    — paid + confirmed COD + anything in fulfilment (the daily work)
 *   pending — prepaid checkout not captured yet + COD awaiting the verify call
 *   failed  — terminal-unhappy incl. post-sale reversals (follow-up bucket)
 *   manual  — created by an admin, any status
 */
const VIEWS = [
  { key: "live", label: "Live", emptyTitle: "No live orders", emptyText: "Paid orders will appear here as customers check out." },
  { key: "pending", label: "Pending", emptyTitle: "No pending orders", emptyText: "UPI carts in progress will appear here." },
  { key: "failed", label: "Failed", emptyTitle: "No failed orders", emptyText: "Nothing to follow up on — clean slate." },
  { key: "manual", label: "Manual", emptyTitle: "No manual orders yet", emptyText: "Orders created by an admin appear here." },
  { key: "all", label: "All", emptyTitle: "No orders yet", emptyText: "Orders appear here as soon as customers check out." },
] as const;
type View = (typeof VIEWS)[number]["key"];
const VIEW_KEYS: readonly View[] = VIEWS.map((v) => v.key);

const METHODS = ["UPI", "CARD", "NETBANKING", "WALLET", "COD"] as const;
type Method = (typeof METHODS)[number];

const RANGES = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" } as const;
type Range = keyof typeof RANGES;
const RANGE_KEYS = Object.keys(RANGES) as Range[];
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

const FILTERS: FilterDef[] = [
  { key: "method", label: "Payment", options: [{ value: "", label: "All" }, ...METHODS.map((m) => ({ value: m, label: methodLabel(m) }))] },
  { key: "range", label: "Date", options: [{ value: "", label: "All time" }, ...RANGE_KEYS.map((r) => ({ value: r, label: RANGES[r] }))] },
];

/** Only the columns the list renders — keeps the items JSONB etc. off the wire. */
const LIST_COLUMNS = {
  id: orders.id, status: orders.status, createdVia: orders.createdVia, placedAt: orders.placedAt,
  shippingAddress: orders.shippingAddress, paymentMethod: orders.paymentMethod, paymentStatus: orders.paymentStatus,
  courierName: orders.courierName, awbCode: orders.awbCode, trackingUrl: orders.trackingUrl, totalInr: orders.totalInr,
};
type OrderRow = Pick<typeof orders.$inferSelect, keyof typeof LIST_COLUMNS>;

type SearchParams = Record<string, string | string[] | undefined>;
type ListState = { view: View; q: string; method: Method | ""; range: Range | "" };

/** Fresh `count(*)` per select — a selected field's SQL carries its decoder, so don't share one instance. */
const countAll = () => sql<number>`count(*)::int`;

export default async function AdminOrdersList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireAdmin();
  const params = await searchParams;

  // 1-based page. Anything non-numeric / < 1 falls back to page 1.
  const page = Math.max(1, Math.floor(Number(first(params.page))) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const state: ListState = {
    view: pick(VIEW_KEYS, first(params.view)) || "live",
    q: first(params.q).trim(),
    method: pick(METHODS, first(params.method)),
    range: pick(RANGE_KEYS, first(params.range)),
  };
  const { view, q, method, range } = state;
  const filtered = Boolean(q || method || range);

  const inScope = inArray(orders.siteId, ctx.siteIds);

  // List filter: site scope + the view's status set, then the URL filters and
  // search. Filters narrow the list only — tab counts stay global.
  const conditions: SQL[] = [inScope];
  if (view === "live") conditions.push(inArray(orders.status, [...PAID_STATUSES]));
  else if (view === "pending") conditions.push(inArray(orders.status, [...PENDING_STATUSES]));
  else if (view === "failed") conditions.push(inArray(orders.status, [...FAILED_STATUSES]));
  else if (view === "manual") conditions.push(eq(orders.createdVia, "ADMIN_MANUAL"));
  if (method) conditions.push(eq(orders.paymentMethod, method));
  const since = placedSince(range);
  if (since) conditions.push(gte(orders.placedAt, since));
  if (q) conditions.push(searchCondition(q));

  const [bucketRows, [{ count: manualCount }], [{ count: toShip }], fetched] = await Promise.all([
    // Every bucket from one grouped query, whichever view is active.
    db.select({ status: orders.status, count: countAll() }).from(orders).where(inScope).groupBy(orders.status),
    // Manual cuts across statuses, so it's counted separately.
    db.select({ count: countAll() }).from(orders).where(and(inScope, eq(orders.createdVia, "ADMIN_MANUAL"))),
    // Paid but not yet handed to a courier.
    db.select({ count: countAll() }).from(orders).where(and(inScope, eq(orders.status, "PAID"), isNull(orders.awbCode))),
    // PAGE_SIZE + 1 tells us whether a next page exists without a count query.
    db
      .select(LIST_COLUMNS)
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.placedAt))
      .limit(PAGE_SIZE + 1)
      .offset(offset),
  ]);

  const counts: Record<View, number> = { live: 0, pending: 0, failed: 0, manual: manualCount, all: 0 };
  let codVerify = 0;
  for (const row of bucketRows) {
    counts.all += row.count;
    const bucket = bucketOfStatus(row.status);
    if (bucket !== "other") counts[bucket] += row.count;
    if (row.status === "PENDING_COD_VERIFICATION") codVerify = row.count;
  }

  const hasNext = fetched.length > PAGE_SIZE;
  const rows = hasNext ? fetched.slice(0, PAGE_SIZE) : fetched;
  const shown = `Showing ${fmt(offset + 1)}–${fmt(offset + rows.length)}`;
  // The total is only known for an unfiltered view (the tab count).
  const summary = filtered ? `${shown}${hasNext ? "+" : ""}` : `${shown} of ${fmt(counts[view])}`;
  const context = q
    ? `Results for “${q}”`
    : `${fmt(counts.live)} live · ${fmt(toShip)} to ship · ${fmt(codVerify)} COD to verify`;

  return (
    <>
      <PageHeader
        title="Orders"
        description={<span className="block truncate">{context}</span>}
        actions={
          <>
            {/* Plain <a download>: a real file download, not a client navigation. */}
            <a
              href="/api/admin/export?dataset=orders"
              download
              title="Download all orders as CSV"
              className={buttonClass({ className: "max-md:w-11 max-md:px-0" })}
            >
              <Download size={15} aria-hidden />
              <span className="max-md:sr-only">Export</span>
            </a>
            <ButtonLink href="/admin/orders/new" variant="primary" className="max-sm:w-11 max-sm:px-0" icon={<Plus size={15} aria-hidden />}>
              <span className="max-sm:sr-only">New manual order</span>
            </ButtonLink>
          </>
        }
      />

      <Tabs
        ariaLabel="Order views"
        active={view}
        items={VIEWS.map((v) => ({ key: v.key, label: v.label, count: counts[v.key], href: ordersHref({ ...state, view: v.key }) }))}
      />

      <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
        <SearchForm
          action="/admin/orders"
          defaultValue={q}
          placeholder="Search order, name, phone or AWB"
          keep={{ view: view === "live" ? undefined : view, method, range }}
          clearHref={ordersHref({ ...state, q: "" })}
          className="max-md:flex-none md:max-w-lg"
        />
        <UrlFilters filters={FILTERS} />
      </div>

      <Panel className="mt-4">
        {rows.length === 0 ? (
          <ListEmpty page={page} state={state} filtered={filtered} />
        ) : (
          <>
            <OrdersTable rows={rows} />
            <OrderCards rows={rows} />
            <Pagination
              summary={summary}
              prevHref={page > 1 ? ordersHref({ ...state, page: page - 1 }) : null}
              nextHref={hasNext ? ordersHref({ ...state, page: page + 1 }) : null}
            />
          </>
        )}
      </Panel>
    </>
  );
}

// ── Table (md+) ─────────────────────────────────────────────────────────────

function OrdersTable({ rows }: { rows: OrderRow[] }) {
  return (
    <Table className="max-md:hidden">
      <THead>
        <TH className="pl-4 pr-3">Order</TH>
        <TH className="px-3">Date</TH>
        <TH className="px-3">Customer</TH>
        <TH className="hidden px-3 lg:table-cell">Payment</TH>
        <TH className="px-3">Status</TH>
        <TH className="hidden px-3 xl:table-cell">Shipping</TH>
        <TH align="right" className="px-3">Amount</TH>
        <TH className="pl-1 pr-2"><span className="sr-only">Actions</span></TH>
      </THead>
      <TBody>
        {rows.map((o) => {
          const c = customerOf(o.shippingAddress);
          return (
            <TR key={o.id}>
              <TD nowrap className="pl-4 pr-3">
                <RowLink href={`/admin/orders/${o.id}`} className="font-mono">{o.id}</RowLink>
                {o.createdVia === "ADMIN_MANUAL" && <div className="mt-1"><Tag>Manual</Tag></div>}
              </TD>
              <TD nowrap className="px-3 tabular-nums text-brand-ink-soft">{formatDateTimeShort(o.placedAt)}</TD>
              {/* 28% + max-w-0: flexible but capped (wide screens spread the rest); truncates. */}
              <TD className="w-[28%] max-w-0 px-3">
                <div className="truncate font-medium" title={c.name}>{c.name}</div>
                {c.contact && <div className="truncate font-mono text-xs text-admin-muted">{c.contact}</div>}
              </TD>
              <TD nowrap className="hidden px-3 lg:table-cell">
                <div>{methodLabel(o.paymentMethod)}</div>
                <div className="text-xs text-admin-muted">{paymentStateMeta(o.paymentMethod, o.paymentStatus).label}</div>
              </TD>
              <TD nowrap className="px-3"><OrderStatusBadge status={o.status} /></TD>
              <TD className="hidden px-3 xl:table-cell">
                {!o.courierName && !o.awbCode && <span className="text-admin-muted">—</span>}
                {o.courierName && <div className="max-w-36 truncate" title={o.courierName}>{o.courierName}</div>}
                {o.awbCode && <div className="max-w-36 truncate font-mono text-xs text-admin-muted">{o.awbCode}</div>}
              </TD>
              <TD align="right" nowrap className="px-3 font-semibold">{formatINR(o.totalInr)}</TD>
              <TD interactive className="pl-1 pr-2">
                <OrderRowActions orderId={o.id} phone={c.phone || null} trackingUrl={o.trackingUrl} />
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

// ── Row cards (phones) ──────────────────────────────────────────────────────

function OrderCards({ rows }: { rows: OrderRow[] }) {
  return (
    <ul className="divide-y divide-admin-line md:hidden">
      {rows.map((o) => (
        <li key={o.id}>
          <Link href={`/admin/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-admin-subtle">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-[13px] font-semibold text-brand-ink">{o.id}</span>
                {o.createdVia === "ADMIN_MANUAL" && <Tag className="shrink-0">Manual</Tag>}
                <span className="ml-auto shrink-0 pl-2 text-sm font-semibold tabular-nums text-brand-ink">
                  {formatINR(o.totalInr)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm text-brand-ink">{customerOf(o.shippingAddress).name}</p>
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <OrderStatusBadge status={o.status} />
                <span className="truncate text-xs text-admin-muted">{methodLabel(o.paymentMethod)}</span>
              </div>
              <p className="mt-1.5 truncate text-xs tabular-nums text-admin-muted">
                {formatDateTimeShort(o.placedAt)}
                {o.awbCode && <> · AWB <span className="font-mono">{o.awbCode}</span></>}
              </p>
            </div>
            <ChevronRight size={16} aria-hidden className="shrink-0 text-admin-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ── Empty states ────────────────────────────────────────────────────────────

function ListEmpty({ page, state, filtered }: { page: number; state: ListState; filtered: boolean }) {
  if (page > 1) {
    const back = <ButtonLink href={ordersHref(state)} size="sm">Back to page 1</ButtonLink>;
    return <EmptyState icon={Inbox} title="You've reached the end" description="There are no more orders past this page." action={back} />;
  }
  if (filtered) {
    const clear = <ButtonLink href={ordersHref({ view: state.view })} size="sm">Clear search and filters</ButtonLink>;
    const title = state.q ? `No orders match “${state.q}”` : "No orders match these filters";
    return <EmptyState icon={SearchX} title={title} description="Try a different search or clear the filters." action={clear} />;
  }
  const v = VIEWS.find((x) => x.key === state.view) ?? VIEWS[0];
  return <EmptyState icon={Package} title={v.emptyTitle} description={v.emptyText} />;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 19_800_000; // UTC+05:30

/** Lower bound on placedAt: "today" = since midnight IST; the rest are rolling windows. */
function placedSince(range: Range | ""): Date | null {
  if (!range) return null;
  const now = Date.now();
  if (range === "today") return new Date(Math.floor((now + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);
  return new Date(now - RANGE_DAYS[range] * DAY_MS);
}

/**
 * Match order id, AWB, or a field inside the shipping_address JSONB. Drizzle
 * has no JSONB helper, so this is raw `sql` — every value is a bound
 * parameter, never interpolated into the query text.
 */
function searchCondition(q: string): SQL {
  const like = `%${q}%`;
  return or(
    sql`${orders.id} ILIKE ${like}`,
    sql`${orders.shippingAddress}->>'fullName' ILIKE ${like}`,
    sql`${orders.shippingAddress}->>'email' ILIKE ${like}`,
    sql`${orders.shippingAddress}->>'phone' ILIKE ${like}`,
    sql`${orders.shippingAddress}->>'pincode' ILIKE ${like}`,
    sql`${orders.awbCode} ILIKE ${like}`,
  )!;
}

/** List URL; the default view and page 1 are omitted. */
function ordersHref(s: Partial<ListState> & { page?: number }): string {
  const sp = new URLSearchParams();
  if (s.view && s.view !== "live") sp.set("view", s.view);
  if (s.q) sp.set("q", s.q);
  if (s.method) sp.set("method", s.method);
  if (s.range) sp.set("range", s.range);
  if (s.page && s.page > 1) sp.set("page", String(s.page));
  const qs = sp.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}

/** Display fields from the shipping-address snapshot (JSONB — shape can drift). */
function customerOf(address: unknown) {
  const a = (address && typeof address === "object" ? address : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  const phone = text(a.phone);
  const contact = [phone && formatPhone(phone), text(a.pincode)].filter(Boolean).join(" · ");
  return { name: text(a.fullName) || "—", phone, contact };
}

/** `raw` if it's one of `allowed`, else "" (unknown URL values are ignored). */
function pick<T extends string>(allowed: readonly T[], raw: string): T | "" {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : "";
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function methodLabel(method: string): string {
  return PAYMENT_METHOD_LABEL[method] ?? method;
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
