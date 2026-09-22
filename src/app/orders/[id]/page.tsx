/**
 * Order success page — shown after Razorpay verify succeeds or COD confirms.
 * Public-safe (no PII beyond masked phone). Reads from /api/orders/[id].
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle2, Clock, Package, Receipt, Truck } from "lucide-react";
import { eq } from "drizzle-orm";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PurchaseTrackingPing from "@/components/PurchaseTrackingPing";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { THEME } from "@/lib/theme";
import { waLink, OFFERS, bundleDiscountInr, bundleTierLabel } from "@/lib/config";
import { formatINR, formatIST } from "@/lib/utils";
import { orderEtaText } from "@/lib/serviceability";
import { db } from "@/db";
import { orders } from "@/db/schema";

type OrderItem = {
  skuId: string;
  variantSlug: string | null;
  name: string;
  image: string | null;
  unitPriceInr: number;
  qty: number;
  lineTotalInr: number;
};

async function getOrder(id: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  return order ?? null;
}

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  const isCod = order.paymentMethod === "COD";
  // Partial-prepaid COD: customer paid the confirmation fee online and owes
  // the balance at the door. Drives the split receipt UI.
  const codPartial = isCod && order.confirmationFeeInr > 0;
  // Prepaid order whose capture hasn't landed yet (webhook lag). Don't claim
  // "Payment successful!" until the money is actually confirmed.
  const awaitingCapture = !isCod && order.paymentStatus !== "CAPTURED";
  // COD orders sit unverified until our team rings the customer to confirm
  // (kills prank orders). Don't claim "Order confirmed!" until that happens.
  const awaitingCodVerification =
    isCod && order.status === "PENDING_COD_VERIFICATION";
  const items = order.items as OrderItem[];
  const shippingAddr = order.shippingAddress as {
    city?: string;
    pincode?: string;
    phone?: string;
  };
  const maskedPhone = shippingAddr?.phone
    ? `••••• ${String(shippingAddr.phone).slice(-4)}`
    : null;
  const etaText = orderEtaText(shippingAddr?.pincode, order);
  const paidAtText = order.paidAt
    ? formatIST(order.paidAt, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  // GA4/Meta/CAPI Purchase event — fires once when the page mounts, gated
  // by sessionStorage(orderId) so a refresh doesn't re-fire. We only ping
  // for orders that have actually settled (prepaid: CAPTURED, COD: address
  // verified) so failed/abandoned orders don't pollute the conversion
  // signal Meta uses to bid on ads.
  const settled =
    ["PAID", "PACKED", "SHIPPED", "DELIVERED"].includes(order.status) &&
    (order.paymentStatus === "CAPTURED" || order.paymentMethod === "COD");
  const contactEmail =
    (order.shippingAddress as { email?: string | null } | null)?.email ?? null;
  const contactPhone =
    (order.shippingAddress as { phone?: string | null } | null)?.phone ?? null;

  return (
    <>
      {settled && (
        <PurchaseTrackingPing
          orderId={order.id}
          totalInr={order.totalInr}
          itemCount={items.reduce((n, i) => n + i.qty, 0)}
          paymentMethod={order.paymentMethod}
          email={contactEmail}
          phone={contactPhone}
          contents={items.map((i) => ({
            sku: i.skuId,
            quantity: i.qty,
            item_price: i.unitPriceInr,
            name: i.name,
          }))}
        />
      )}
      <AnnouncementBar />
      <Header />

      <main className="flex-1 bg-brand-cream">
        <section className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          {/* Success header */}
          <div className="bg-white rounded-2xl border border-brand-line p-6 sm:p-8 text-center">
            <div
              className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
                awaitingCapture || awaitingCodVerification
                  ? "bg-gold/10 text-gold"
                  : "bg-success/10 text-success"
              }`}
            >
              {awaitingCapture || awaitingCodVerification ? (
                <Clock size={32} />
              ) : (
                <CheckCircle2 size={32} />
              )}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-brand-ink">
              {awaitingCapture
                ? "Order received — confirming payment"
                : awaitingCodVerification
                  ? "Order received — we'll call to confirm"
                  : isCod
                    ? "Order confirmed!"
                    : "Payment successful!"}
            </h1>
            <p className="text-brand-ink-soft mt-2">
              {awaitingCapture
                ? "Your payment is being confirmed by the bank — this usually takes a few seconds. We've saved your order; refresh to see the latest status."
                : awaitingCodVerification
                  ? "Our team will ring you within 24 hrs to confirm before dispatch. Please pick up when we call from a Bangalore number."
                  : isCod
                    ? "We'll dispatch from Yelahanka in 24 hrs."
                    : "Thanks for your order. Dispatch from Yelahanka in 24 hrs."}
            </p>

            <div className="mt-6 inline-flex flex-col items-center gap-1 px-5 py-3 rounded-xl bg-brand-cream border border-brand-line">
              <span className="text-[10px] font-mono uppercase tracking-widest text-brand-ink-soft">
                Order ID
              </span>
              <span className="font-mono font-bold text-lg text-brand-ink">
                {order.id}
              </span>
            </div>

            {etaText && order.status !== "DELIVERED" && (
              <p className="mt-4 inline-flex items-center justify-center gap-1.5 text-sm text-brand-ink">
                <Truck size={15} className="text-brand-red" aria-hidden />
                Estimated delivery {etaText}
              </p>
            )}

            <p className="text-xs text-brand-ink-soft mt-4">
              Save this — you&apos;ll need it to track or claim a replacement.
            </p>
          </div>

          {/* Summary */}
          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5 sm:p-6">
            <h2 className="font-semibold text-brand-ink mb-4">Order summary</h2>
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div
                  key={`${item.skuId}-${item.variantSlug ?? "default"}-${idx}`}
                  className="flex items-center gap-3"
                >
                  {item.image && (
                    <div className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-brand-line bg-brand-cream">
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-brand-ink truncate">
                      {item.name}
                    </div>
                    <div className="text-sm text-brand-ink-soft">
                      Qty {item.qty} · {formatINR(item.unitPriceInr)} each
                    </div>
                  </div>
                  <div className="font-semibold text-brand-ink">
                    {formatINR(item.lineTotalInr)}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-brand-line mt-5 pt-4 space-y-1.5 text-sm text-brand-ink">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatINR(order.subtotalInr)}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span className={order.shippingInr === 0 ? "text-success" : ""}>
                  {order.shippingInr === 0
                    ? "FREE"
                    : formatINR(order.shippingInr)}
                </span>
              </div>
              {order.codFeeInr > 0 && (
                <div className="flex justify-between">
                  <span>COD fee</span>
                  <span>{formatINR(order.codFeeInr)}</span>
                </div>
              )}
              {/* Discount breakdown — derived from items + payment method so
                  the customer sees each bonus separately instead of a single
                  opaque "Discount -₹398" line. Sum equals order.discountInr. */}
              {(() => {
                const items = (order.items as OrderItem[]) ?? [];
                const cartQty = items.reduce((n, i) => n + i.qty, 0);
                const prepaidBonus =
                  order.paymentMethod !== "COD" ? OFFERS.prepaidDiscountINR : 0;
                const bundleBonus = bundleDiscountInr(cartQty, order.subtotalInr);
                const bundleName = bundleTierLabel(cartQty);
                const couponBonus = Math.max(
                  0,
                  order.discountInr - prepaidBonus - bundleBonus,
                );
                return (
                  <>
                    {prepaidBonus > 0 && (
                      <div className="flex justify-between text-success">
                        <span>Online-pay bonus</span>
                        <span>-{formatINR(prepaidBonus)}</span>
                      </div>
                    )}
                    {bundleBonus > 0 && (
                      <div className="flex justify-between text-success">
                        <span>
                          Bundle bonus{bundleName ? ` (${bundleName})` : ""}
                        </span>
                        <span>-{formatINR(bundleBonus)}</span>
                      </div>
                    )}
                    {couponBonus > 0 && (
                      <div className="flex justify-between text-success">
                        <span>
                          Coupon{order.couponCode ? ` (${order.couponCode})` : ""}
                        </span>
                        <span>-{formatINR(couponBonus)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="flex justify-between font-bold text-base text-brand-ink pt-2 border-t border-brand-line mt-2">
                <span>Total</span>
                <span>{formatINR(order.totalInr)}</span>
              </div>

              {/* Partial-prepaid COD split — reassure the buyer they paid the
                  small confirmation amount now and owe the balance at the door.
                  Mirrors the admin panel so customer + operator see the same
                  numbers. */}
              {isCod && order.confirmationFeeInr > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-brand-line space-y-1.5">
                  <div className="flex justify-between text-success">
                    <span>Paid now (online)</span>
                    <span className="tabular-nums font-semibold">
                      {formatINR(order.confirmationFeeInr)}
                    </span>
                  </div>
                  <div className="flex justify-between text-brand-ink font-semibold">
                    <span>Pay on delivery (cash)</span>
                    <span className="tabular-nums">
                      {formatINR(order.totalInr - order.confirmationFeeInr)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Payment receipt — gives the buyer a reconcilable reference. */}
          <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <Receipt size={18} className="text-brand-red" />
              <h2 className="font-semibold text-brand-ink">Payment receipt</h2>
            </div>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt className="text-brand-ink-soft">Method</dt>
                <dd className="text-brand-ink font-medium">
                  {isCod ? "Cash on Delivery" : "Paid online (UPI / card)"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-brand-ink-soft">Status</dt>
                <dd
                  className={
                    awaitingCapture
                      ? "text-gold font-medium"
                      : "text-success font-medium"
                  }
                >
                  {codPartial
                    ? "Confirmed — balance on delivery"
                    : isCod
                      ? "To be collected on delivery"
                      : awaitingCapture
                        ? "Confirming…"
                        : "Paid"}
                </dd>
              </div>
              {/* Show the Razorpay ref + paid-on for full-prepaid AND for
                  partial-prepaid COD (the confirmation fee is a real online
                  payment with a reconcilable transaction id). */}
              {(!isCod || codPartial) && order.razorpayPaymentId && (
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-ink-soft">Transaction ref</dt>
                  <dd className="text-brand-ink font-mono text-xs break-all text-right">
                    {order.razorpayPaymentId}
                  </dd>
                </div>
              )}
              {paidAtText && (!isCod || codPartial) && (
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-ink-soft">Paid on</dt>
                  <dd className="text-brand-ink">{paidAtText}</dd>
                </div>
              )}
              {codPartial ? (
                <>
                  <div className="flex justify-between gap-3 border-t border-brand-line pt-2 mt-2 font-semibold text-success">
                    <dt>Paid online</dt>
                    <dd className="tabular-nums">
                      {formatINR(order.confirmationFeeInr)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold">
                    <dt className="text-brand-ink">Due on delivery</dt>
                    <dd className="text-brand-ink tabular-nums">
                      {formatINR(order.totalInr - order.confirmationFeeInr)}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between gap-3 border-t border-brand-line pt-2 mt-2 font-semibold">
                  <dt className="text-brand-ink">
                    {isCod ? "Amount due" : "Amount paid"}
                  </dt>
                  <dd className="text-brand-ink">{formatINR(order.totalInr)}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Ships to */}
          {(shippingAddr?.city || shippingAddr?.pincode) && (
            <div className="mt-6 bg-white rounded-2xl border border-brand-line p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-3">
                <Package size={18} className="text-brand-red" />
                <h2 className="font-semibold text-brand-ink">Shipping to</h2>
              </div>
              <p className="text-sm text-brand-ink-soft">
                {shippingAddr.city} · {shippingAddr.pincode}
              </p>
              {maskedPhone && (
                <p className="text-sm text-brand-ink-soft mt-1">
                  Contact: {maskedPhone}
                </p>
              )}
            </div>
          )}

          {/* CTAs */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Link
              href={`/track?id=${order.id}`}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-brand-ink text-white px-5 py-3 rounded-xl font-semibold hover:bg-brand-ink-soft transition-colors"
            >
              <Package size={16} /> Track order
            </Link>
            <a
              href={waLink(
                `Hi, I just placed order ${order.id}. Quick question:`,
              )}
              target="_blank"
              rel="noopener"
              className="flex-1 inline-flex items-center justify-center gap-2 bg-whatsapp-green text-white px-5 py-3 rounded-xl font-semibold hover:bg-whatsapp-green-hover transition-colors"
            >
              <WhatsAppIcon size={16} /> WhatsApp us
            </a>
          </div>

          {/* R03 - Spares reorder lane. Most cars need replacement drift
              wheels in ~2 weeks of tile use; battery degrades in ~6 months.
              Surfaced HERE because the order success page is the only
              moment the buyer is already on the brand site post-purchase.
              Spares ship from the same Yelahanka warehouse - we add the
              line item to their existing customer record + reuse the
              shipping address. Returning-customer welcome-back code
              PRC_RETURN10 (10% off spares) hidden until R01 / repeat-order
              loop is wired; for now WhatsApp-to-reorder is the path since
              the catalogue + Razorpay can take a phone order in 60s. */}
          <div className="mt-6 bg-brand-cream border border-brand-line rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-lg bg-brand-red-soft text-brand-red flex items-center justify-center">
                <Package size={18} aria-hidden />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-brand-ink text-sm sm:text-base">
                  Need spares later?
                </h3>
                <p className="text-xs sm:text-sm text-brand-ink-soft mt-1 leading-snug">
                  Spare drift wheels (₹99), batteries (₹199), shells (₹99)
                  in stock. WhatsApp the part you need — we dispatch from
                  Bangalore in 24 hrs to the same address.
                </p>
                <a
                  href={waLink(
                    `Hi, I'd like to reorder spares for order ${order.id}. Please send the list of available parts + prices.`,
                  )}
                  target="_blank"
                  rel="noopener"
                  className="mt-3 inline-flex items-center gap-2 bg-brand-ink text-white px-4 py-2 rounded-full text-xs sm:text-sm font-semibold hover:bg-brand-ink-soft transition-colors"
                >
                  <WhatsAppIcon size={14} /> Reorder spares on WhatsApp
                </a>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/"
              className="text-sm text-brand-ink-soft hover:text-brand-ink underline-offset-4 hover:underline"
            >
              ← Back to {THEME.brandName}
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
