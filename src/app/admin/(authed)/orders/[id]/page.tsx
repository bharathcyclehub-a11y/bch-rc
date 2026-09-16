import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Check,
  ChevronLeft,
  ExternalLink,
  FileText,
  MessageCircle,
} from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, customers, events, notificationsOutbox, coupons } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { formatINR, formatIST } from "@/lib/utils";
import { OrderStatusBadge } from "@/components/admin/Badge";
import { OFFERS, bundleDiscountInr, bundleTierLabel } from "@/lib/config";
import { orderConfirmationWaLink } from "@/lib/wa";
import { ShipButton } from "./ShipButton";
import OrderActions from "./OrderActions";
import CodVerifyActions from "./CodVerifyActions";
import FulfillmentPanel from "./FulfillmentPanel";
import type { FulfillmentTarget } from "./actions";

/** Forward-only fulfilment targets still available from the current status. */
const FULFILLMENT_RANK: Record<string, number> = {
  PAID: 1,
  PACKED: 2,
  SHIPPED: 3,
  DELIVERED: 4,
};
const ALL_TARGETS: { target: FulfillmentTarget; rank: number }[] = [
  { target: "PACKED", rank: 2 },
  { target: "SHIPPED", rank: 3 },
  { target: "DELIVERED", rank: 4 },
];
const CANCELLABLE_STATUSES = [
  "PENDING",
  "PENDING_COD_VERIFICATION",
  "PAID",
  "PACKED",
];

type OrderItem = {
  skuId: string;
  variantSlug: string | null;
  name: string;
  image: string | null;
  unitPriceInr: number;
  qty: number;
  lineTotalInr: number;
};

export default async function AdminOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAdmin();
  const { id } = await params;

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order || !ctx.siteIds.includes(order.siteId)) notFound();

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId));

  const orderEvents = await db
    .select()
    .from(events)
    .where(eq(events.orderId, id))
    .orderBy(desc(events.createdAt));

  const notifs = await db
    .select({
      template: notificationsOutbox.template,
      channel: notificationsOutbox.channel,
      deliveryStatus: notificationsOutbox.deliveryStatus,
      sentAt: notificationsOutbox.sentAt,
    })
    .from(notificationsOutbox)
    .where(eq(notificationsOutbox.orderId, id))
    .orderBy(desc(notificationsOutbox.createdAt));

  // A won-bargain coupon is SKU-bound, and its price is FINAL — order creation
  // zeroes the prepaid + bundle discounts for it. The summary below must know
  // that, or it back-solves a fictional split out of a discount that was never
  // stacked (showed a real ₹799 bargain as "bundle ₹610 + prepaid ₹100 + ₹89").
  const [couponRow] = order.couponCode
    ? await db
        .select({ constraintSkuId: coupons.constraintSkuId })
        .from(coupons)
        .where(eq(coupons.code, order.couponCode))
    : [];
  const isBargainOrder = couponRow?.constraintSkuId != null;

  const items = order.items as OrderItem[];
  const addr = order.shippingAddress as Record<string, string>;

  const currentRank = FULFILLMENT_RANK[order.status] ?? 0;
  const nextTargets: FulfillmentTarget[] =
    currentRank > 0
      ? ALL_TARGETS.filter((t) => t.rank > currentRank).map((t) => t.target)
      : [];
  const canCancel = CANCELLABLE_STATUSES.includes(order.status);
  const isCodPending = order.status === "PENDING_COD_VERIFICATION";
  const terminal =
    order.status === "CANCELLED" ||
    order.status === "REFUNDED" ||
    !!order.cancelledAt;

  const notifBounced = notifs.some(
    (n) => n.deliveryStatus === "bounced" || n.deliveryStatus === "complained",
  );

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Back + header */}
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-ink"
      >
        <ChevronLeft size={16} /> All orders
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
            <h1 className="font-display text-lg sm:text-2xl font-bold text-brand-ink font-mono break-all">
              {order.id}
            </h1>
            <OrderStatusBadge status={order.status} />
            <span className="bg-brand-cream text-brand-ink-soft text-[10px] font-mono uppercase tracking-widest font-semibold px-2 py-1 rounded-full border border-brand-line">
              {order.paymentMethod} · {order.paymentStatus}
            </span>
          </div>
          {/* Site id is admin plumbing — desktop only */}
          <p className="text-xs sm:text-sm text-brand-ink-soft mt-0.5 sm:mt-1">
            Placed {formatIST(order.placedAt)}
            <span className="hidden sm:inline"> · Site: {order.siteId}</span>
          </p>
        </div>
        <Link
          href={`/admin/orders/${order.id}/invoice`}
          target="_blank"
          rel="noopener"
          className="shrink-0 inline-flex items-center gap-1.5 bg-white border border-brand-line hover:border-brand-ink text-brand-ink text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
        >
          <FileText size={13} /> Print invoice
        </Link>
      </div>

      {/* Status progress — visible at a glance, no scroll */}
      <ProgressStrip order={order} terminal={terminal} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 items-start">
        {/* ── Main column ── */}
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          {/* Items + totals */}
          <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
            <h2 className="font-semibold text-brand-ink mb-2 sm:mb-3 text-sm sm:text-base">
              Items{" "}
              <span className="text-brand-ink-soft font-normal text-xs sm:text-sm">
                · {items.reduce((n, i) => n + i.qty, 0)} unit
                {items.reduce((n, i) => n + i.qty, 0) === 1 ? "" : "s"}
              </span>
            </h2>
            <ul className="space-y-2 sm:space-y-3">
              {items.map((item, idx) => (
                <li
                  key={`${item.skuId}-${item.variantSlug ?? "default"}-${idx}`}
                  className="flex items-center gap-2.5 sm:gap-3"
                >
                  {item.image && (
                    <div className="relative w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg overflow-hidden border border-brand-line bg-brand-cream">
                      <Image src={item.image} alt={item.name} fill sizes="48px" className="object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-brand-ink text-sm truncate">{item.name}</div>
                    <div className="text-[11px] sm:text-xs text-brand-ink-soft mt-0.5">
                      {item.skuId}
                      {item.variantSlug ? ` · ${item.variantSlug}` : ""} · ×{item.qty} · {formatINR(item.unitPriceInr)}
                    </div>
                  </div>
                  <div className="font-semibold text-brand-ink tabular-nums text-sm">
                    {formatINR(item.lineTotalInr)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-brand-line mt-3 pt-2.5 sm:mt-4 sm:pt-3 space-y-1 sm:space-y-1.5 text-[13px] sm:text-sm text-brand-ink">
              <Row label="Subtotal" value={formatINR(order.subtotalInr)} />
              <Row label="Shipping" value={order.shippingInr === 0 ? "FREE" : formatINR(order.shippingInr)} />
              {order.codFeeInr > 0 && <Row label="COD fee" value={formatINR(order.codFeeInr)} />}
              {order.discountInr > 0 && (() => {
                const cartQty = items.reduce((n, i) => n + i.qty, 0);
                // Bargain price is final: nothing stacks, so the whole discount IS the coupon.
                const prepaidBonus = isBargainOrder
                  ? 0
                  : order.paymentMethod !== "COD"
                    ? OFFERS.prepaidDiscountINR
                    : 0;
                const bundleBonus = isBargainOrder
                  ? 0
                  : bundleDiscountInr(cartQty, order.subtotalInr);
                const bundleName = bundleTierLabel(cartQty);
                const couponBonus = Math.max(0, order.discountInr - prepaidBonus - bundleBonus);
                return (
                  <>
                    {bundleBonus > 0 && <Row label={`Bundle offer${bundleName ? ` (${bundleName})` : ""}`} value={`-${formatINR(bundleBonus)}`} green />}
                    {prepaidBonus > 0 && <Row label="Prepaid (pay-online) discount" value={`-${formatINR(prepaidBonus)}`} green />}
                    {couponBonus > 0 && (
                      <Row
                        label={
                          order.couponCode
                            ? `Coupon (${order.couponCode})${isBargainOrder ? " · negotiated price" : ""}`
                            : "Coupon"
                        }
                        value={`-${formatINR(couponBonus)}`}
                        green
                      />
                    )}
                  </>
                );
              })()}
              <div className="flex justify-between font-bold text-base text-brand-ink pt-2 border-t border-brand-line mt-2">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(order.totalInr)}</span>
              </div>
            </div>

            {order.paymentMethod === "COD" && order.confirmationFeeInr > 0 && (
              <div className="mt-4 rounded-xl border border-brand-line bg-brand-cream p-3.5">
                <div className="text-[11px] font-mono uppercase tracking-widest text-brand-ink-soft mb-2.5">
                  COD payment split
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5 text-brand-ink">
                      <span className="inline-block w-2 h-2 rounded-full bg-success" aria-hidden />
                      Paid online (confirmation)
                    </span>
                    <span className="tabular-nums font-semibold text-success">
                      {formatINR(order.confirmationFeeInr)}
                      {order.paymentStatus === "CAPTURED" ? " ✓" : ""}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-brand-line">
                    <span className="flex items-center gap-1.5 font-semibold text-brand-ink">
                      <span className="inline-block w-2 h-2 rounded-full bg-brand-red" aria-hidden />
                      Collect on delivery (cash)
                    </span>
                    <span className="tabular-nums font-bold text-brand-ink text-base">
                      {formatINR(order.totalInr - order.confirmationFeeInr)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Fulfillment refs + create-shipment */}
          <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
            <h2 className="font-semibold text-brand-ink mb-2 sm:mb-3 text-sm sm:text-base">Fulfillment</h2>
            <dl className="text-[13px] sm:text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1 sm:gap-y-1.5">
              {/* Shiprocket ref + Method (already in the header badge) are
                  desktop-only — mobile keeps just AWB + courier */}
              <Field label="Shiprocket" value={order.shiprocketOrderId} className="hidden sm:flex" />
              <Field label="AWB" value={order.awbCode} mono />
              <Field label="Courier" value={order.courierName} />
              <Field label="Method" value={order.paymentMethod} className="hidden sm:flex" />
            </dl>
            {order.trackingUrl && (
              <a
                href={order.trackingUrl}
                target="_blank"
                rel="noopener"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-brand-red hover:underline font-semibold"
              >
                Courier tracking <ExternalLink size={12} />
              </a>
            )}
            {(order.status === "PAID" || (order.status === "PACKED" && !order.awbCode)) && (
              <div className="pt-3 mt-3 border-t border-brand-line">
                <ShipButton orderId={order.id} hasShipment={!!order.shiprocketOrderId} />
              </div>
            )}
          </div>

          {/* Payment refs — method/status already sit in the header badge and
              the Razorpay ids are look-up data, so on mobile the whole card
              collapses to one row; desktop keeps the open card. */}
          <details className="sm:hidden bg-white rounded-2xl border border-brand-line group">
            <summary className="flex items-center justify-between cursor-pointer list-none px-3 py-3 font-semibold text-brand-ink text-sm">
              <span>Payment refs</span>
              <span className="text-xs text-brand-ink-soft group-open:hidden">Show</span>
              <span className="text-xs text-brand-ink-soft hidden group-open:inline">Hide</span>
            </summary>
            <dl className="text-[13px] px-3 pb-3 border-t border-brand-line pt-2.5 grid gap-y-1">
              <Field label="Method" value={order.paymentMethod} />
              <Field label="Status" value={order.paymentStatus} />
              <Field label="Razorpay order" value={order.razorpayOrderId} mono />
              <Field label="Razorpay payment" value={order.razorpayPaymentId} mono />
            </dl>
          </details>
          <div className="hidden sm:block bg-white rounded-2xl border border-brand-line p-5">
            <h2 className="font-semibold text-brand-ink mb-3">Payment</h2>
            <dl className="text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              <Field label="Method" value={order.paymentMethod} />
              <Field label="Status" value={order.paymentStatus} />
              <Field label="Razorpay order" value={order.razorpayOrderId} mono />
              <Field label="Razorpay payment" value={order.razorpayPaymentId} mono />
            </dl>
          </div>

          {/* Notifications */}
          {notifs.length > 0 && (
            <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
              <h2 className="font-semibold text-brand-ink mb-2 sm:mb-3 text-sm sm:text-base">Notifications</h2>
              <ul className="space-y-1.5 sm:space-y-2 text-[13px] sm:text-sm">
                {notifs.map((n, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-brand-ink-soft">
                      {n.template} <span className="text-[11px] font-mono uppercase">· {n.channel}</span>
                    </span>
                    <DeliveryBadge status={n.deliveryStatus} />
                  </li>
                ))}
              </ul>
              {notifBounced && (
                <p className="mt-3 text-xs text-brand-red font-medium">
                  ⚠️ A confirmation didn&rsquo;t reach the customer — follow up by phone/WhatsApp.
                </p>
              )}
            </div>
          )}

          {/* Event log — collapsed by default to save space */}
          <details className="bg-white rounded-2xl border border-brand-line group">
            <summary className="flex items-center justify-between cursor-pointer list-none px-3 sm:px-5 py-3 sm:py-3.5 font-semibold text-brand-ink">
              <span>
                Event log{" "}
                <span className="text-brand-ink-soft font-normal text-sm">· {orderEvents.length}</span>
              </span>
              <span className="text-xs text-brand-ink-soft group-open:hidden">Show</span>
              <span className="text-xs text-brand-ink-soft hidden group-open:inline">Hide</span>
            </summary>
            <div className="px-3 sm:px-5 pb-4 border-t border-brand-line pt-3">
              {orderEvents.length === 0 ? (
                <p className="text-sm text-brand-ink-soft">No events yet.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {orderEvents.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-3 border-l-2 border-brand-line pl-3">
                      <span className="font-mono text-brand-ink-soft shrink-0">
                        {formatIST(e.createdAt, { timeStyle: "medium", hour12: false })}
                      </span>
                      <span className="font-mono font-semibold text-brand-ink uppercase tracking-wider shrink-0">
                        {e.type}
                      </span>
                      <span className="text-brand-ink-soft truncate">
                        {typeof e.payload === "object" && e.payload ? JSON.stringify(e.payload).slice(0, 80) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </div>

        {/* ── Sticky rail: actions + customer + address ── */}
        <div className="space-y-3 sm:space-y-4 lg:sticky lg:top-[4.5rem] self-start">
          {isCodPending && <CodVerifyActions orderId={order.id} />}

          <FulfillmentPanel
            orderId={order.id}
            awbCode={order.awbCode}
            courierName={order.courierName}
            trackingUrl={order.trackingUrl}
            nextTargets={nextTargets}
            canCancel={canCancel}
          />

          {customer && (
            <div className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
              <h2 className="font-semibold text-brand-ink mb-2 sm:mb-3 text-sm sm:text-base">Customer</h2>
              <div className="text-[13px] sm:text-sm text-brand-ink space-y-0.5">
                <div className="font-semibold">{customer.name ?? addr.fullName}</div>
                <div className="text-brand-ink-soft">{customer.phone}</div>
                {customer.email && <div className="text-brand-ink-soft break-all">{customer.email}</div>}
                <Link
                  href={`/admin/customers/${customer.id}`}
                  className="inline-block text-xs text-brand-red hover:underline mt-1"
                >
                  {customer.totalOrders} orders · {formatINR(customer.totalSpentInr)} lifetime →
                </Link>
              </div>
              {(() => {
                const waHref = orderConfirmationWaLink(
                  order,
                  customer.phone ?? addr.phone,
                  customer.name ?? addr.fullName,
                );
                return waHref ? (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener"
                    className="mt-3 w-full inline-flex items-center justify-center gap-1.5 bg-whatsapp-green hover:bg-whatsapp-green-hover text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                  >
                    <MessageCircle size={14} /> Send confirmation
                  </a>
                ) : null;
              })()}

              <div className="mt-2.5 pt-2.5 sm:mt-3 sm:pt-3 border-t border-brand-line text-[13px] sm:text-sm text-brand-ink-soft leading-relaxed">
                <div className="text-[11px] font-mono uppercase tracking-widest text-brand-ink-soft mb-1">
                  Ship to
                </div>
                <span className="text-brand-ink font-medium">{addr.fullName}</span>
                <br />
                {addr.line1}
                {addr.line2 && (<><br />{addr.line2}</>)}
                <br />
                {addr.city}, {addr.state} {addr.pincode}
                <br />
                {addr.phone}
              </div>
            </div>
          )}

          <OrderActions
            orderId={order.id}
            initialNotes={order.notes}
            canRefund={
              !!order.razorpayPaymentId &&
              order.paymentStatus !== "REFUNDED" &&
              order.status !== "REFUNDED"
            }
            refundAmountLabel={formatINR(order.totalInr)}
          />
        </div>
      </div>
    </div>
  );
}

/** Horizontal Placed→Paid→Packed→Shipped→Delivered progress with IST dates. */
function ProgressStrip({
  order,
  terminal,
}: {
  order: {
    status: string;
    placedAt: Date | null;
    paidAt: Date | null;
    packedAt: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
  };
  terminal: boolean;
}) {
  const steps = [
    { label: "Placed", at: order.placedAt },
    { label: "Paid", at: order.paidAt },
    { label: "Packed", at: order.packedAt },
    { label: "Shipped", at: order.shippedAt },
    { label: "Delivered", at: order.deliveredAt },
  ];
  return (
    <div className="bg-white rounded-2xl border border-brand-line px-2 py-2.5 sm:px-4 sm:py-4 overflow-x-auto no-scrollbar">
      {/* All 5 steps fit 375px without scrolling: smaller dots + labels and
          no per-step dates on mobile (dates return at sm:). */}
      <ol className="flex items-start sm:min-w-[420px]">
        {steps.map((s, i) => {
          const done = !!s.at;
          const nextDone = i < steps.length - 1 && !!steps[i + 1].at;
          return (
            <li key={s.label} className="relative flex-1 last:flex-none flex flex-col items-center px-0.5 sm:px-1">
              {i < steps.length - 1 && (
                <span
                  className={`absolute top-2.5 sm:top-3 left-1/2 h-0.5 w-full ${nextDone ? "bg-success" : "bg-brand-line"}`}
                  aria-hidden
                />
              )}
              <span
                className={`relative z-10 grid place-items-center h-5 w-5 sm:h-6 sm:w-6 rounded-full ${
                  done ? "bg-success text-white" : "bg-brand-cream border border-brand-line text-brand-ink-soft"
                }`}
              >
                {done ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-brand-ink-soft/40" />}
              </span>
              <span className={`mt-1 sm:mt-1.5 text-[10px] sm:text-[11px] font-semibold ${done ? "text-brand-ink" : "text-brand-ink-soft"}`}>
                {s.label}
              </span>
              <span className="hidden sm:block text-[10px] text-brand-ink-soft tabular-nums h-3.5">
                {s.at ? formatIST(s.at, { day: "2-digit", month: "short" }) : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {terminal && (
        <p className="mt-3 pt-3 border-t border-brand-line text-xs font-semibold text-brand-red">
          {order.status === "REFUNDED"
            ? "Order refunded"
            : `Order cancelled${order.cancelledAt ? ` · ${formatIST(order.cancelledAt)}` : ""}`}
        </p>
      )}
    </div>
  );
}

function DeliveryBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    delivered: { bg: "bg-success/15", fg: "text-success", label: "Delivered" },
    sent: { bg: "bg-blue-100", fg: "text-blue-700", label: "Sent" },
    delayed: { bg: "bg-amber-100", fg: "text-amber-700", label: "Delayed" },
    bounced: { bg: "bg-red-100", fg: "text-red-700", label: "Bounced" },
    complained: { bg: "bg-red-100", fg: "text-red-700", label: "Spam" },
    pending: { bg: "bg-brand-line/40", fg: "text-brand-ink-soft", label: "Pending" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`text-[10px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${s.bg} ${s.fg}`}>
      {s.label}
    </span>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className={`flex justify-between ${green ? "text-success" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  className = "",
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex justify-between gap-2 min-w-0 ${className}`}>
      <dt className="text-brand-ink-soft shrink-0">{label}</dt>
      <dd className={`text-brand-ink text-right truncate ${mono ? "font-mono text-xs" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}
