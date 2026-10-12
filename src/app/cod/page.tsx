import Link from "next/link";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { events, orders } from "@/db/schema";
import { orderListColumns } from "@/db/order-columns";
import { isCodAuthenticated } from "@/lib/cod-auth";
import { CodLoginForm } from "./CodLoginForm";
import { CodOrderCard } from "./CodOrderCard";
import { CodSignOut } from "./CodSignOut";

export const dynamic = "force-dynamic";

type Tab = "pending" | "approved" | "rejected";

/**
 * /cod — three-section operator console for the COD verification flow.
 *
 *   Pending   = status PENDING_COD_VERIFICATION. Operator calls the customer
 *               then clicks Confirm or Reject.
 *   Approved  = COD order that came through this flow and was confirmed
 *               (event COD_VERIFIED logged at confirm time). Listed so the
 *               operator can scan recent confirmations and trace a callback.
 *   Rejected  = COD order ended in CANCELLED via /cod (event COD_REJECTED
 *               for operator-reject, COD_AUTO_REJECTED for the 48h sweeper).
 *               Listed so a manually-rejected order can be looked up if the
 *               customer calls back to dispute.
 *
 * The approved/rejected buckets are capped at 100 rows each — enough for a
 * working window, bounded so the page stays fast.
 */
const LIST_LIMIT = 100;

async function loadTabData(tab: Tab) {
  const pendingFilter = and(
    eq(orders.status, "PENDING_COD_VERIFICATION"),
    eq(orders.paymentMethod, "COD"),
  );
  const approvedFilter = and(
    eq(orders.paymentMethod, "COD"),
    inArray(
      orders.id,
      db
        .select({ id: events.orderId })
        .from(events)
        .where(eq(events.type, "COD_VERIFIED")),
    ),
  );
  const rejectedFilter = and(
    eq(orders.paymentMethod, "COD"),
    eq(orders.status, "CANCELLED"),
    inArray(
      orders.id,
      db
        .select({ id: events.orderId })
        .from(events)
        .where(inArray(events.type, ["COD_REJECTED", "COD_AUTO_REJECTED"])),
    ),
  );

  // Counts in parallel — one count(*) per bucket. Cheap, bounded by index hits.
  const countOf = async (filter: ReturnType<typeof and>) => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(filter);
    return count;
  };

  const [pendingCount, approvedCount, rejectedCount, rows] = await Promise.all([
    countOf(pendingFilter),
    countOf(approvedFilter),
    countOf(rejectedFilter),
    tab === "pending"
      ? db.select(orderListColumns).from(orders).where(pendingFilter).orderBy(asc(orders.placedAt))
      : tab === "approved"
        ? db
            .select(orderListColumns)
            .from(orders)
            .where(approvedFilter)
            .orderBy(desc(orders.paidAt))
            .limit(LIST_LIMIT)
        : db
            .select(orderListColumns)
            .from(orders)
            .where(rejectedFilter)
            .orderBy(desc(orders.cancelledAt))
            .limit(LIST_LIMIT),
  ]);

  // For the Rejected tab, fetch which reject events exist per order so the
  // card can label "operator" vs "auto-expiry". One round-trip; mapped client-
  // side. For other tabs this is skipped.
  let rejectKindById = new Map<string, "operator" | "auto">();
  if (tab === "rejected" && rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const rejectEvents = await db
      .select({ orderId: events.orderId, type: events.type })
      .from(events)
      .where(
        and(
          inArray(events.orderId, ids),
          inArray(events.type, ["COD_REJECTED", "COD_AUTO_REJECTED"]),
        ),
      );
    for (const e of rejectEvents) {
      if (!e.orderId) continue;
      // Operator action wins over auto-expiry if both somehow exist (shouldn't,
      // but be defensive — the manual reject is the truer signal).
      const prior = rejectKindById.get(e.orderId);
      const kind = e.type === "COD_REJECTED" ? "operator" : "auto";
      if (prior !== "operator") rejectKindById.set(e.orderId, kind);
    }
  }

  return { pendingCount, approvedCount, rejectedCount, rows, rejectKindById };
}

export default async function CodConsole({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await isCodAuthenticated())) {
    return <CodLoginForm />;
  }

  const params = await searchParams;
  const tab: Tab =
    params.tab === "approved"
      ? "approved"
      : params.tab === "rejected"
        ? "rejected"
        : "pending";

  const { pendingCount, approvedCount, rejectedCount, rows, rejectKindById } =
    await loadTabData(tab);

  const emptyCopy =
    tab === "pending"
      ? {
          title: "All clear",
          body: "No COD orders waiting for verification.",
        }
      : tab === "approved"
        ? {
            title: "No approvals yet",
            body: "Confirmed COD orders will show up here.",
          }
        : {
            title: "Nothing rejected",
            body: "Rejected COD orders will show up here.",
          };

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-[#0b0b0c] text-white sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="font-display font-bold text-lg">
            PRC Cars <span className="text-brand-red">COD</span>
          </div>
          <CodSignOut />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold">COD orders</h1>
          <p className="text-sm text-brand-ink-soft mt-1">
            {tab === "pending"
              ? "Call the customer, verify they really placed this order, then Confirm. Reject for fake/prank orders — inventory is returned and no email is sent."
              : tab === "approved"
                ? "COD orders confirmed via this console. Shipment was created and the customer notified."
                : "COD orders rejected via this console. Inventory was released; the customer was not notified."}
          </p>
        </div>

        <div className="flex gap-2 mb-5 border-b border-brand-line overflow-x-auto overflow-y-hidden no-scrollbar">
          <TabLink href="/cod" active={tab === "pending"} count={pendingCount}>
            Pending
          </TabLink>
          <TabLink
            href="/cod?tab=approved"
            active={tab === "approved"}
            count={approvedCount}
          >
            Approved
          </TabLink>
          <TabLink
            href="/cod?tab=rejected"
            active={tab === "rejected"}
            count={rejectedCount}
          >
            Rejected
          </TabLink>
        </div>

        {rows.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center">
            <p className="text-lg font-semibold">{emptyCopy.title}</p>
            <p className="text-sm text-brand-ink-soft mt-1">{emptyCopy.body}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((o) => (
              <CodOrderCard
                key={o.id}
                mode={tab}
                order={{
                  id: o.id,
                  totalInr: o.totalInr,
                  subtotalInr: o.subtotalInr,
                  shippingInr: o.shippingInr,
                  codFeeInr: o.codFeeInr,
                  discountInr: o.discountInr,
                  couponCode: o.couponCode,
                  placedAt: o.placedAt,
                  paidAt: o.paidAt,
                  cancelledAt: o.cancelledAt,
                  awbCode: o.awbCode,
                  courierName: o.courierName,
                  trackingUrl: o.trackingUrl,
                  shippingAddress: o.shippingAddress,
                  items: o.items,
                }}
                rejectKind={rejectKindById.get(o.id) ?? null}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TabLink({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`shrink-0 px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold inline-flex items-center gap-2 transition-colors ${
        active
          ? "border-brand-red text-brand-ink"
          : "border-transparent text-brand-ink-soft hover:text-brand-ink"
      }`}
    >
      {children}
      <span
        className={`text-xs font-mono px-2 py-0.5 rounded-full ${
          active
            ? "bg-brand-red text-white"
            : "bg-brand-line text-brand-ink-soft"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}
