import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  CreditCard,
  HelpCircle,
  LogOut,
  MapPin,
  Package,
  RefreshCw,
  Ticket,
} from "lucide-react";
import { getSupportSession, maskEmail } from "@/lib/support/session";
import { ORDER_ID_RE, normaliseOrderId } from "@/lib/support/verify";
import {
  ORDER_STATUS_CUSTOMER,
  getOwnedOrder,
  itemValue,
  listCustomerOrders,
  listOrderTickets,
  maskedShipping,
  orderItems,
  paymentSummary,
} from "@/lib/support/customer-queries";
import { loadPolicy } from "@/lib/support/config";
import { DEFAULT_POLICY, TICKET_STATUS_LABEL, checkEligibility, isTicketStatus, type Eligibility } from "@/lib/support/rules";
import { getPublicTrackingView } from "@/lib/tracking/view";
import { formatINR } from "@/lib/utils";
import SupportShell from "../../_components/SupportShell";
import { Eyebrow, Notice, StatusPill, btnOutline, cardClass, fmtDate } from "../../_components/ui";
import { signOutSupportAction } from "../actions";
import OrderTracking from "./OrderTracking";

export const metadata: Metadata = {
  title: { absolute: "Your order — PRC Support" },
  robots: { index: false },
};

type Next = "" | "claim" | "refund" | "delivery";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function VerifiedOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const orderId = normaliseOrderId(id.slice(0, 20));
  const n = first(sp.next);
  const next: Next = n === "claim" || n === "refund" || n === "delivery" ? n : "";
  if (!ORDER_ID_RE.test(orderId)) redirect("/support/order");
  const back = `/support/order?id=${encodeURIComponent(orderId)}${next ? `&next=${next}` : ""}`;

  // Ownership is checked on the server, every request: session AND the
  // order's customer must match. Anything else goes back to verification.
  const session = await getSupportSession();
  if (!session) redirect(back);
  const order = await getOwnedOrder(orderId, session.customerId);
  if (!order) redirect(back);

  const now = new Date();
  const [policy, tracking, tickets, others] = await Promise.all([
    loadPolicy().catch(() => DEFAULT_POLICY),
    getPublicTrackingView(order.id, now).catch(() => null),
    listOrderTickets(order.id, session.customerId),
    listCustomerOrders(session.customerId, 11),
  ]);
  const items = orderItems(order);
  const ship = maskedShipping(order);
  const pay = paymentSummary(order);
  const elig = checkEligibility({
    category: "DAMAGED_PRODUCT",
    orderStatus: order.status,
    deliveredAt: order.deliveredAt,
    now,
    policy,
  });
  const delivered = order.status === "DELIVERED";
  const q = (extra: string) => `/support/new?order=${encodeURIComponent(order.id)}&${extra}`;

  const actions: Array<{ key: Next | "other"; label: string; hint: string; href: string; icon: typeof Package }> = [
    {
      key: "delivery",
      label: "Report a delivery problem",
      hint: delivered ? "Marked delivered but not received, or wrong status" : "Delayed or tracking looks wrong",
      href: q(`category=${delivered ? "ORDER_NOT_RECEIVED" : "DELIVERY_DELAYED"}`),
      icon: AlertTriangle,
    },
    {
      key: "claim",
      label: "Return / replace an item",
      hint: "Damaged, not working, wrong or missing",
      href: q("group=PRODUCT"),
      icon: RefreshCw,
    },
    {
      key: "refund",
      label: "Payment or refund question",
      hint: "Payment status, double charge, refund progress",
      href: q("group=MONEY"),
      icon: CreditCard,
    },
    { key: "other", label: "Something else", hint: "Any other question about this order", href: q("category=GENERAL"), icon: HelpCircle },
  ];
  const suggested = actions.find((a) => a.key === next);
  const otherOrders = others.filter((o) => o.id !== order.id).slice(0, 10);

  return (
    <SupportShell crumbs={[{ label: "Find order", href: "/support/order" }, { label: order.id }]}>
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header>
          <Eyebrow>Verified order</Eyebrow>
          <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-brand-ink font-mono break-all">{order.id}</h1>
          <p className="mt-1 text-sm text-brand-ink-soft">Placed {fmtDate(order.placedAt)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 text-tone-pos font-semibold">
              <BadgeCheck size={16} aria-hidden />
              Verified as {maskEmail(session.email)}
            </span>
            <form action={signOutSupportAction}>
              <button
                type="submit"
                className="inline-flex min-h-12 items-center gap-1.5 font-semibold text-brand-ink-soft underline underline-offset-4 hover:text-brand-ink"
              >
                <LogOut size={14} aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </header>

        {suggested && (
          <Link
            href={suggested.href}
            className="flex min-h-14 items-center gap-3 rounded-2xl bg-brand-ink p-4 text-white hover:bg-brand-ink-soft"
          >
            <suggested.icon size={20} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-mono uppercase tracking-widest text-white/70">Continue</span>
              <span className="block font-semibold">{suggested.label}</span>
            </span>
            <ArrowRight size={18} aria-hidden className="shrink-0" />
          </Link>
        )}

        {/* ── Status summary ─────────────────────────────────────────── */}
        <section aria-label="Order summary" className={`${cardClass} bg-brand-cream`}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-brand-ink-soft">Order status</dt>
              <dd className="mt-0.5 font-semibold text-brand-ink">{ORDER_STATUS_CUSTOMER[order.status] ?? order.status}</dd>
              {order.deliveredAt && <dd className="text-xs text-brand-ink-soft">Delivered {fmtDate(order.deliveredAt)}</dd>}
            </div>
            <div>
              <dt className="text-brand-ink-soft">Payment</dt>
              <dd className="mt-0.5 font-semibold text-brand-ink">{pay.label}</dd>
              {pay.detail && <dd className="text-xs text-brand-ink-soft">{pay.detail}</dd>}
            </div>
            <div>
              <dt className="text-brand-ink-soft">Order total</dt>
              <dd className="mt-0.5 font-semibold text-brand-ink">{formatINR(order.totalInr)}</dd>
            </div>
            {order.invoiceNumber && (
              <div>
                <dt className="text-brand-ink-soft">Invoice number</dt>
                <dd className="mt-0.5 font-mono font-semibold text-brand-ink break-all">{order.invoiceNumber}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* ── Items + replacement eligibility ────────────────────────── */}
        <section aria-labelledby="items-heading" className={cardClass}>
          <h2 id="items-heading" className="font-display text-lg font-bold text-brand-ink">
            Items
          </h2>
          <p className="mt-1 text-sm text-brand-ink-soft">{elig.message}</p>
          <ul className="mt-4 divide-y divide-brand-line">
            {items.map((it) => (
              <li key={it.key} className="py-4 first:pt-0 last:pb-0">
                <div className="flex gap-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-brand-line bg-brand-cream">
                    {it.image ? (
                      <Image src={it.image} alt="" fill sizes="64px" className="object-cover" />
                    ) : (
                      <Package size={24} aria-hidden className="absolute inset-0 m-auto text-brand-ink-soft" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-brand-ink break-words">{it.name}</p>
                    <p className="text-sm text-brand-ink-soft">
                      {[it.variantName, `Qty ${it.qty}`].filter(Boolean).join(" · ")}
                    </p>
                    <ItemEligibility elig={elig} />
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-brand-ink">{formatINR(it.lineTotalInr)}</p>
                </div>
                <Link
                  href={q(`group=PRODUCT&item=${encodeURIComponent(itemValue(it))}`)}
                  className="mt-2 inline-flex min-h-12 items-center gap-1 text-sm font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
                >
                  Report a problem with this item
                  <ChevronRight size={16} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Get help ───────────────────────────────────────────────── */}
        <section id="get-help" aria-labelledby="get-help-heading" className="scroll-mt-24">
          <h2 id="get-help-heading" className="font-display text-lg font-bold text-brand-ink">
            Get help with this order
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {actions.map((a) => {
              const Icon = a.icon;
              const isSuggested = a.key === next;
              return (
                <li key={a.key}>
                  <Link
                    href={a.href}
                    className={`flex h-full min-h-16 items-start gap-3 rounded-2xl border p-4 hover:border-brand-ink ${
                      isSuggested ? "border-brand-red ring-2 ring-brand-red-soft" : "border-brand-line"
                    }`}
                  >
                    <Icon size={20} aria-hidden className="mt-0.5 shrink-0 text-brand-red" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-brand-ink">
                        {a.label}
                        {isSuggested && <span className="sr-only"> (suggested)</span>}
                      </span>
                      <span className="block text-sm text-brand-ink-soft">{a.hint}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── Tracking ───────────────────────────────────────────────── */}
        {tracking ? (
          <div className="-mt-2">
            <OrderTracking initial={tracking} />
          </div>
        ) : (
          <Notice tone="info" title="Tracking isn't available right now">
            Try again in a few minutes, or open{" "}
            <Link href={`/support/track?id=${encodeURIComponent(order.id)}`} className="font-semibold underline">
              order tracking
            </Link>
            .
          </Notice>
        )}

        {/* ── Delivery address (masked) ──────────────────────────────── */}
        <section aria-labelledby="address-heading" className={cardClass}>
          <h2 id="address-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand-ink">
            <MapPin size={18} aria-hidden className="text-brand-red" />
            Delivering to
          </h2>
          <p className="mt-2 text-sm text-brand-ink">
            {ship.firstName && <span className="font-semibold">{ship.firstName}</span>}
            {ship.firstName && (ship.city || ship.state || ship.pincode) ? " · " : ""}
            {[ship.city, ship.state, ship.pincode].filter(Boolean).join(", ")}
          </p>
          {ship.phone && <p className="mt-1 text-sm text-brand-ink-soft">Phone {ship.phone}</p>}
          <p className="mt-2 text-xs text-brand-ink-soft">
            For your privacy we only show part of the address here.
          </p>
        </section>

        {/* ── Tickets for this order ─────────────────────────────────── */}
        <section aria-labelledby="tickets-heading" className={cardClass}>
          <h2 id="tickets-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand-ink">
            <Ticket size={18} aria-hidden className="text-brand-red" />
            Your requests for this order
          </h2>
          {tickets.length === 0 ? (
            <p className="mt-2 text-sm text-brand-ink-soft">No requests yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-brand-line">
              {tickets.map((t) => (
                <li key={t.number}>
                  <Link href={`/support/tickets/${t.number}`} className="flex min-h-14 items-center gap-3 py-2 hover:text-brand-red">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs text-brand-ink-soft">
                        {t.number} · {fmtDate(t.createdAt)}
                      </span>
                      <span className="block font-semibold text-brand-ink break-words">{t.subject}</span>
                    </span>
                    <StatusPill
                      status={t.status}
                      label={isTicketStatus(t.status) ? TICKET_STATUS_LABEL[t.status] : t.status}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Other orders ───────────────────────────────────────────── */}
        {otherOrders.length > 0 && (
          <section aria-labelledby="other-orders-heading" className={cardClass}>
            <h2 id="other-orders-heading" className="font-display text-lg font-bold text-brand-ink">
              Your other orders
            </h2>
            <ul className="mt-3 divide-y divide-brand-line">
              {otherOrders.map((o) => (
                <li key={o.id}>
                  <Link href={`/support/order/${o.id}`} className="flex min-h-14 items-center gap-3 py-2 hover:text-brand-red">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-semibold text-brand-ink">{o.id}</span>
                      <span className="block text-xs text-brand-ink-soft break-words">
                        {fmtDate(o.placedAt)} · {o.statusLabel}
                        {o.firstItemName ? ` · ${o.firstItemName}${o.itemCount > 1 ? ` +${o.itemCount - 1}` : ""}` : ""}
                      </span>
                    </span>
                    <ChevronRight size={18} aria-hidden className="shrink-0 text-brand-ink-soft" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Link href="/support/tickets" className={`${btnOutline} w-full`}>
          All my requests
        </Link>
      </div>
    </SupportShell>
  );
}

function ItemEligibility({ elig }: { elig: Eligibility }) {
  if (!elig.deliveredAt || elig.daysSinceDelivery === null) {
    return <p className="mt-1 text-xs text-brand-ink-soft">Replacement window starts on delivery</p>;
  }
  if (elig.eligible && elig.windowDays !== null) {
    const left = elig.windowDays - elig.daysSinceDelivery;
    return (
      <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-tone-pos-bg px-2 py-0.5 text-xs font-semibold text-tone-pos">
        <BadgeCheck size={12} aria-hidden />
        Replacement window open · {left <= 0 ? "last day" : `${left} day${left === 1 ? "" : "s"} left`}
      </p>
    );
  }
  return (
    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-tone-warn-bg px-2 py-0.5 text-xs font-semibold text-tone-warn">
      <AlertTriangle size={12} aria-hidden />
      Outside the {elig.windowDays}-day window — we&apos;ll still review
    </p>
  );
}
