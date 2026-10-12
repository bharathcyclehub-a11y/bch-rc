import Link from "next/link";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  Package,
  Truck,
  CheckCircle2,
  AlertCircle,
  PackageCheck,
  ClipboardList,
  Undo2,
  LayoutList,
} from "lucide-react";
import { db, withDbRetry, DatabaseUnavailableError } from "@/db";
import { orders } from "@/db/schema";
import { orderListColumns } from "@/db/order-columns";
import { isPackAuthenticated } from "@/lib/pack-auth";
import { PackLoginForm } from "./PackLoginForm";
import { PackSignOut } from "./PackSignOut";
import { PackOrderRow } from "./PackOrderRow";
import { PackFilterSelect } from "./PackFilterSelect";

export const dynamic = "force-dynamic";

/**
 * Tabs mirror the Shiprocket order console 1:1 so the operator sees the same
 * lifecycle stages in both places and never gets confused switching over.
 *
 *   Shiprocket          → our status
 *   New                 → PAID, or PACKED without AWB (needs AWB)
 *   Ready to Ship       → PACKED with AWB
 *   Pickups & Manifests → PACKED with AWB (manifest/pickup stage)
 *   In Transit          → SHIPPED
 *   Delivered           → DELIVERED
 *   RTO                 → RETURNED
 *   All                 → every real order
 */
type Tab =
  | "new"
  | "ready"
  | "pickups"
  | "transit"
  | "delivered"
  | "rto"
  | "all";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "new", label: "New" },
  { id: "ready", label: "Ready to Ship" },
  { id: "pickups", label: "Pickups & Manifests" },
  { id: "transit", label: "In Transit" },
  { id: "delivered", label: "Delivered" },
  { id: "rto", label: "RTO" },
  { id: "all", label: "All" },
];

type RangeKey = "7" | "30" | "90" | "all";
type SortKey = "newest" | "oldest";

const RANGE_DAYS: Record<RangeKey, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
};

/**
 * /pack — three-section console for the packing employee.
 *
 * TO PACK     = status PACKED AND awb_code IS NOT NULL.
 * AWB PENDING = status PAID, OR PACKED-without-awb.
 *               (Shiprocket is still creating the AWB, ~30 sec normally.)
 * DISPATCHED  = status SHIPPED, last 24 hours.
 *
 * Why two batches instead of one Promise.all:
 *   The db pool is capped at max=3 per Lambda instance (see src/db/index.ts).
 *   A single Promise.all of 4 queries forces one to wait for a connection,
 *   which under cold-start serialises into 4-5s timeouts when the function
 *   is also negotiating the Supavisor pool. Splitting into [counts] + [rows]
 *   keeps every batch within the pool limit so all queries truly parallelise.
 *
 * Each call goes through withDbRetry so a transient Supavisor connection drop
 * (the "Connection closed" failure mode the db comment documents) becomes
 * one silent retry instead of a hung page.
 */
const LIST_LIMIT = 200;

/** Real orders shown in the "All" tab (excludes dead carts: PENDING/ABANDONED/FAILED). */
const ALL_STATUSES = [
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
] as const;

/** Status filter (no date) for a tab — same logic used by rows + counts. */
function statusFilterFor(tab: Tab): SQL | undefined {
  switch (tab) {
    case "new":
      // Paid but no AWB yet → needs shipping (auto or manual Generate AWB).
      return or(
        eq(orders.status, "PAID"),
        and(eq(orders.status, "PACKED"), isNull(orders.awbCode)),
      );
    case "ready":
      // AWB assigned, label ready, NOT yet manifested → still to hand over.
      return and(
        eq(orders.status, "PACKED"),
        isNotNull(orders.awbCode),
        isNull(orders.manifestedAt),
      );
    case "pickups":
      // Manifest generated → moved out of Ready to Ship, awaiting pickup.
      return and(
        eq(orders.status, "PACKED"),
        isNotNull(orders.awbCode),
        isNotNull(orders.manifestedAt),
      );
    case "transit":
      return eq(orders.status, "SHIPPED");
    case "delivered":
      return eq(orders.status, "DELIVERED");
    case "rto":
      return eq(orders.status, "RETURNED");
    case "all":
      return inArray(orders.status, [...ALL_STATUSES]);
  }
}

/** Column each tab sorts by (newest activity first by default). */
function sortColumn(tab: Tab) {
  if (tab === "transit") return orders.shippedAt;
  if (tab === "delivered" || tab === "rto") return orders.updatedAt;
  if (tab === "new") return orders.paidAt;
  return orders.packedAt;
}

type Counts = Record<Tab, number>;

type LoadResult =
  | { ok: true; counts: Counts; rows: Array<Omit<typeof orders.$inferSelect, "courierRouting">> }
  | { ok: false; error: string };

async function loadTabData(
  tab: Tab,
  range: RangeKey,
  sort: SortKey,
): Promise<LoadResult> {
  // Date window applies to every tab + the counts, mirroring Shiprocket's
  // "Last 30 days" filter. Computed once per request (Date.now is fine here).
  const days = RANGE_DAYS[range];
  const dateFilter: SQL | undefined = days
    ? gte(orders.placedAt, new Date(Date.now() - days * 24 * 60 * 60 * 1000))
    : undefined;

  const statusFilter = statusFilterFor(tab);
  const rowsWhere =
    dateFilter && statusFilter
      ? and(statusFilter, dateFilter)
      : (statusFilter ?? dateFilter);

  const col = sortColumn(tab);
  const orderBy = sort === "oldest" ? asc(col) : desc(col);

  try {
    // ROWS — the active tab's list.
    const rows = await withDbRetry(
      () =>
        db
          .select(orderListColumns)
          .from(orders)
          .where(rowsWhere)
          .orderBy(orderBy)
          .limit(LIST_LIMIT),
      "pack:rows",
    );

    // COUNTS — one grouped query for all tabs (pool-friendly: 1 round trip).
    const grouped = await withDbRetry(
      () =>
        db
          .select({
            status: orders.status,
            noAwb: sql<boolean>`${orders.awbCode} IS NULL`,
            notManifested: sql<boolean>`${orders.manifestedAt} IS NULL`,
            count: sql<number>`count(*)::int`,
          })
          .from(orders)
          .where(dateFilter)
          .groupBy(
            orders.status,
            sql`${orders.awbCode} IS NULL`,
            sql`${orders.manifestedAt} IS NULL`,
          ),
      "pack:counts",
    );

    const counts: Counts = {
      new: 0, ready: 0, pickups: 0, transit: 0,
      delivered: 0, rto: 0, all: 0,
    };
    for (const g of grouped) {
      const n = g.count;
      if (g.status === "PAID" || (g.status === "PACKED" && g.noAwb)) {
        counts.new += n;
      }
      if (g.status === "PACKED" && !g.noAwb) {
        // Manifested → Pickups & Manifests; not yet → Ready to Ship.
        if (g.notManifested) counts.ready += n;
        else counts.pickups += n;
      }
      if (g.status === "SHIPPED") counts.transit += n;
      if (g.status === "DELIVERED") counts.delivered += n;
      if (g.status === "RETURNED") counts.rto += n;
      if ((ALL_STATUSES as readonly string[]).includes(g.status)) {
        counts.all += n;
      }
    }

    return { ok: true, counts, rows };
  } catch (err) {
    const msg =
      err instanceof DatabaseUnavailableError
        ? "Database is temporarily unavailable. Refresh in a moment."
        : err instanceof Error
          ? err.message
          : "Failed to load.";
    return { ok: false, error: msg };
  }
}

export default async function PackPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; sort?: string }>;
}) {
  if (!(await isPackAuthenticated())) return <PackLoginForm />;

  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab)
    ? (sp.tab as Tab)
    : "new";
  const range: RangeKey = (["7", "30", "90", "all"] as const).includes(
    sp.range as RangeKey,
  )
    ? (sp.range as RangeKey)
    : "30";
  const sort: SortKey = sp.sort === "oldest" ? "oldest" : "newest";

  const result = await loadTabData(tab, range, sort);

  // Error state — render a clear failure UI instead of hanging in loading.tsx
  if (!result.ok) {
    return (
      <div className="min-h-screen bg-brand-cream text-brand-ink flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-red/15 text-brand-red mb-4">
            <AlertCircle size={24} />
          </div>
          <h1 className="text-2xl font-bold">
            Can&rsquo;t load orders right now.
          </h1>
          <p className="text-sm text-brand-ink-soft mt-2">{result.error}</p>
          <Link
            href="/pack"
            className="mt-5 inline-flex items-center gap-1.5 bg-brand-ink hover:bg-brand-ink-soft text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            Try again
          </Link>
        </div>
      </div>
    );
  }

  const { counts, rows } = result;
  const TAB_ICON: Record<Tab, React.ReactNode> = {
    new: <Package size={13} />,
    ready: <PackageCheck size={13} />,
    pickups: <ClipboardList size={13} />,
    transit: <Truck size={13} />,
    delivered: <CheckCircle2 size={13} />,
    rto: <Undo2 size={13} />,
    all: <LayoutList size={13} />,
  };
  // Build a tab href that preserves the current range + sort selection.
  const tabHref = (id: Tab) =>
    `/pack?tab=${id}&range=${range}&sort=${sort}`;

  return (
    <div className="min-h-screen bg-brand-cream text-brand-ink">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-brand-line">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package size={20} className="text-brand-red" />
            <div>
              <h1 className="text-base font-bold leading-tight">
                Packing Console
              </h1>
              <p className="text-xs text-brand-ink-soft leading-tight">
                pocketrccars · pack & ship
              </p>
            </div>
          </div>
          <PackSignOut />
        </div>

        {/* Tabs — mirror Shiprocket's order lifecycle */}
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <TabLink key={t.id} href={tabHref(t.id)} active={tab === t.id}>
              {TAB_ICON[t.id]} {t.label}
              <Count n={counts[t.id]} active={tab === t.id} />
            </TabLink>
          ))}
        </nav>
      </header>

      {/* Filter bar — date range + sort, like Shiprocket's "Last 30 days" */}
      <div className="max-w-5xl mx-auto px-4 pt-4 flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Range"
          current={range}
          tab={tab}
          sort={sort}
          paramKey="range"
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "all", label: "All time" },
          ]}
        />
        <FilterSelect
          label="Sort"
          current={sort}
          tab={tab}
          range={range}
          paramKey="sort"
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
          ]}
        />
        <span className="ml-auto text-xs text-brand-ink-soft">
          {rows.length} order{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Body */}
      <main className="max-w-5xl mx-auto px-4 py-5 space-y-3">
        {rows.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          rows.map((order) => (
            <PackOrderRow
              key={order.id}
              orderId={order.id}
              status={order.status}
              awbCode={order.awbCode}
              courierName={order.courierName}
              courierProvider={order.courierProvider}
              invoiceNumber={order.invoiceNumber}
              placedAt={order.placedAt}
              shippingAddress={
                order.shippingAddress as {
                  fullName: string;
                  phone: string;
                  city: string;
                  state: string;
                  pincode: string;
                  email?: string;
                }
              }
              items={
                order.items as Array<{
                  name: string;
                  qty: number;
                  image?: string | null;
                  skuId?: string;
                  variantSlug?: string | null;
                }>
              }
              paymentMethod={order.paymentMethod}
              totalInr={order.totalInr}
              confirmationFeeInr={order.confirmationFeeInr}
              manifestedAt={order.manifestedAt}
              manifestUrl={order.manifestUrl}
              pickupScheduledAt={order.pickupScheduledAt}
              packedAt={order.packedAt}
              shippedAt={order.shippedAt}
              showActions={tab === "new" || tab === "ready" || tab === "pickups"}
            />
          ))
        )}
      </main>
    </div>
  );
}

/**
 * Server-rendered filter dropdown — a styled <select> that navigates to a new
 * URL on change (client island for the onChange only). Preserves the other
 * params so changing the range doesn't reset the sort and vice-versa.
 */
function FilterSelect({
  label,
  current,
  paramKey,
  options,
  tab,
  range,
  sort,
}: {
  label: string;
  current: string;
  paramKey: "range" | "sort";
  options: ReadonlyArray<{ value: string; label: string }>;
  tab: Tab;
  range?: RangeKey;
  sort?: SortKey;
}) {
  return (
    <PackFilterSelect
      label={label}
      current={current}
      paramKey={paramKey}
      options={options}
      tab={tab}
      range={range ?? "30"}
      sort={sort ?? "newest"}
    />
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap " +
        (active
          ? "text-brand-ink border-brand-red"
          : "text-brand-ink-soft hover:text-brand-ink border-transparent")
      }
    >
      {children}
    </Link>
  );
}

function Count({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] tabular-nums " +
        (active
          ? "bg-brand-red text-white"
          : "bg-brand-line/60 text-brand-ink-soft")
      }
    >
      {n}
    </span>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const messages: Record<Tab, { title: string; sub: string }> = {
    new: {
      title: "No new orders.",
      sub: "Paid orders awaiting an AWB appear here. They auto-assign within ~30 sec; if one is stuck, use Generate AWB.",
    },
    ready: {
      title: "Nothing ready to ship.",
      sub: "Orders with an AWB assigned show here, ready for label, invoice and dispatch.",
    },
    pickups: {
      title: "No pickups or manifests pending.",
      sub: "Once orders have an AWB, print the manifest and schedule the courier pickup from here.",
    },
    transit: {
      title: "Nothing in transit.",
      sub: "Dispatched orders show here until the courier marks them delivered.",
    },
    delivered: {
      title: "No deliveries in this window.",
      sub: "Widen the date range to see older delivered orders.",
    },
    rto: {
      title: "No RTO / returns.",
      sub: "Orders the courier returns to origin appear here.",
    },
    all: {
      title: "No orders in this window.",
      sub: "Widen the date range to see more orders.",
    },
  };
  const m = messages[tab];
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-brand-line">
      <CheckCircle2 size={28} className="mx-auto text-brand-ink-soft/50 mb-3" />
      <p className="font-semibold text-brand-ink">{m.title}</p>
      <p className="text-sm text-brand-ink-soft mt-1 max-w-md mx-auto">{m.sub}</p>
    </div>
  );
}
