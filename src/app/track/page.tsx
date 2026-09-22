"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  Package,
  Truck,
  CheckCircle2,
  Search,
  AlertCircle,
} from "lucide-react";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppFab from "@/components/WhatsAppFab";
import CartDrawer from "@/components/CartDrawer";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { THEME } from "@/lib/theme";
import { waLink } from "@/lib/config";

type Step = {
  key: "placed" | "packed" | "shipped" | "delivered";
  label: string;
  sub: string;
  icon: typeof Package;
};

const STEPS: Step[] = [
  {
    key: "placed",
    label: "Order placed",
    sub: "Confirmed + payment verified",
    icon: CheckCircle2,
  },
  {
    key: "packed",
    label: "Packed",
    sub: "Boxed at Yelahanka warehouse",
    icon: Package,
  },
  {
    key: "shipped",
    label: "Shipped",
    sub: "Handed to the courier — on its way",
    icon: Truck,
  },
  {
    key: "delivered",
    label: "Delivered",
    sub: "Enjoy your drift!",
    icon: CheckCircle2,
  },
];

type OrderApiResponse = {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  courierName: string | null;
  trackingUrl: string | null;
  awbCode: string | null;
  paymentReference: string | null;
  etaText: string | null;
  placedAt: string;
  paidAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
};

/** Map DB status → which pipeline step is "current" (active) */
function statusToStepIndex(status: string): number {
  switch (status) {
    case "PENDING":
      return -1; // payment not yet captured
    case "PAID":
      return 0; // placed/confirmed
    case "PACKED":
      return 1;
    case "SHIPPED":
      return 2;
    case "DELIVERED":
      return 3;
    case "CANCELLED":
    case "FAILED":
    case "ABANDONED":
      return -2; // special — show error
    default:
      return 0;
  }
}

export default function TrackPage() {
  const searchParams = useSearchParams();
  const initialId = searchParams.get("id") ?? "";

  const [input, setInput] = useState(initialId);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<OrderApiResponse | null>(null);

  async function fetchOrder(id: string) {
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      const res = await fetch(`/api/orders/${id}`);
      if (res.status === 404) {
        setError("No order found with that ID. Double-check the WhatsApp confirmation.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't fetch your order. Try again or WhatsApp us.");
        return;
      }
      const data = (await res.json()) as OrderApiResponse;
      setOrder(data);
    } catch {
      setError("Network error. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch if landing with ?id=PRC-XXXXXXXX
  useEffect(() => {
    if (initialId) {
      const id = initialId.trim().toUpperCase();
      if (/^PRC-[A-Z0-9]{4,12}$/.test(id)) fetchOrder(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = input.trim().toUpperCase();
    if (!id) {
      setError("Enter an order ID to track.");
      return;
    }
    if (!/^PRC-[A-Z0-9]{4,12}$/.test(id)) {
      setError(
        "Order IDs look like PRC-XXXXXXXX (the format on your WhatsApp confirmation).",
      );
      return;
    }
    fetchOrder(id);
  }

  const currentStep = order ? statusToStepIndex(order.status) : -1;
  const isCancelled = currentStep === -2;
  const isPending = order?.status === "PENDING";

  return (
    <>
      <AnnouncementBar />
      <Header />
      <nav className="border-b border-brand-line bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-ink"
          >
            <ChevronLeft size={16} />
            Back to store
          </Link>
        </div>
      </nav>

      <main className="flex-1 bg-white">
        <section className="max-w-3xl mx-auto px-4 py-8 sm:py-14">
          <p className="text-xs font-mono font-bold uppercase tracking-widest text-brand-red">
            Track your order
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-brand-ink mt-2 text-balance">
            Where&apos;s my drift?
          </h1>
          <p className="text-base text-brand-ink-soft mt-3 leading-relaxed">
            Enter the order ID from your WhatsApp / SMS confirmation. Looks like{" "}
            <span className="font-mono text-brand-ink">PRC-XXXXXXXX</span>.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1">
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-ink-soft pointer-events-none"
              />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="PRC-A1B2C3D4"
                aria-label="Order ID"
                className="w-full pl-11 pr-4 py-3 sm:py-4 rounded-xl border-2 border-brand-line focus:border-brand-red focus:outline-none text-brand-ink placeholder:text-brand-ink-soft/50 font-mono text-base uppercase tracking-widest"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-brand-red hover:bg-brand-red-hover disabled:opacity-50 text-white px-6 py-3 sm:py-4 rounded-xl font-bold text-base transition-colors"
            >
              {loading ? "Searching..." : "Track"}
            </button>
          </form>

          {error && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-brand-red font-medium">
              <AlertCircle size={14} />
              {error}
            </p>
          )}

          {order && (
            <div className="mt-8 border border-brand-line rounded-2xl p-5 sm:p-7 bg-white">
              <div className="flex items-baseline justify-between gap-3 mb-5">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-brand-ink-soft">
                    Order
                  </p>
                  <p className="font-display text-xl font-bold text-brand-ink font-mono mt-0.5">
                    {order.id}
                  </p>
                </div>
                {isCancelled ? (
                  <span className="bg-brand-red/10 text-brand-red text-[11px] font-mono uppercase tracking-widest font-semibold px-2.5 py-1 rounded-full">
                    {order.status}
                  </span>
                ) : isPending ? (
                  <span className="bg-gold/10 text-gold text-[11px] font-mono uppercase tracking-widest font-semibold px-2.5 py-1 rounded-full">
                    Payment pending
                  </span>
                ) : (
                  <span className="bg-success/10 text-success text-[11px] font-mono uppercase tracking-widest font-semibold px-2.5 py-1 rounded-full">
                    Active
                  </span>
                )}
              </div>

              {isCancelled ? (
                <p className="text-sm text-brand-ink-soft">
                  This order is {order.status.toLowerCase()}. WhatsApp us if you
                  think this is wrong.
                </p>
              ) : isPending ? (
                <p className="text-sm text-brand-ink-soft">
                  Your payment hasn&apos;t been captured yet. If you completed
                  the payment, please wait a few seconds and refresh. If
                  you&apos;d like to retry, WhatsApp us with the order ID.
                </p>
              ) : (
                <ol className="space-y-3">
                  {STEPS.map((step, i) => {
                    const done = i <= currentStep;
                    const active = i === currentStep;
                    const Icon = step.icon;
                    return (
                      <li
                        key={step.key}
                        className={`flex items-start gap-4 p-3 rounded-xl border transition-colors ${
                          active
                            ? "border-brand-red bg-brand-red-soft"
                            : done
                              ? "border-success/30 bg-success/5"
                              : "border-brand-line bg-white"
                        }`}
                      >
                        <span
                          className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                            active
                              ? "bg-brand-red text-white"
                              : done
                                ? "bg-success text-white"
                                : "bg-brand-cream text-brand-ink-soft"
                          }`}
                        >
                          <Icon size={16} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-semibold ${
                              done || active
                                ? "text-brand-ink"
                                : "text-brand-ink-soft"
                            }`}
                          >
                            {step.label}
                          </p>
                          <p className="text-xs text-brand-ink-soft mt-0.5">
                            {step.sub}
                          </p>
                        </div>
                        {active && (
                          <span className="text-[10px] font-mono uppercase tracking-widest text-brand-red font-bold animate-pulse">
                            Now
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}

              {/* Delivery expectation — only while in flight. */}
              {!isCancelled &&
                !isPending &&
                order.etaText &&
                order.status !== "DELIVERED" && (
                  <div className="mt-5 pt-5 border-t border-brand-line">
                    <p className="text-sm text-brand-ink">
                      <span className="text-brand-ink-soft">Expected delivery: </span>
                      <span className="font-semibold">{order.etaText}</span>
                    </p>
                  </div>
                )}

              {/* Courier details. Shown as soon as an AWB exists — even if the
                  courier's public tracking URL hasn't propagated yet, so the
                  buyer isn't left at a dead end. */}
              {(order.awbCode || order.courierName) && (
                <div className="mt-5 pt-5 border-t border-brand-line">
                  <p className="text-xs text-brand-ink-soft">
                    Courier:{" "}
                    <span className="font-semibold text-brand-ink">
                      {order.courierName ?? "Assigned"}
                    </span>
                    {order.awbCode && (
                      <>
                        {" · "}AWB{" "}
                        <span className="font-mono text-brand-ink">
                          {order.awbCode}
                        </span>
                      </>
                    )}
                  </p>
                  {order.trackingUrl ? (
                    <a
                      href={order.trackingUrl}
                      target="_blank"
                      rel="noopener"
                      className="mt-3 inline-flex items-center gap-2 bg-brand-ink hover:bg-brand-ink-soft text-white px-4 py-2.5 rounded-full font-semibold text-sm transition-colors"
                    >
                      Track on courier site
                    </a>
                  ) : (
                    <p className="mt-2 text-xs text-brand-ink-soft">
                      Live courier tracking link will appear here shortly. Use the
                      AWB above on the courier&apos;s site, or WhatsApp us.
                    </p>
                  )}
                </div>
              )}

              {/* Payment reference — reconcilable proof for prepaid orders. */}
              {order.paymentReference && (
                <div className="mt-5 pt-5 border-t border-brand-line">
                  <p className="text-xs text-brand-ink-soft">
                    Payment reference:{" "}
                    <span className="font-mono text-brand-ink break-all">
                      {order.paymentReference}
                    </span>
                  </p>
                </div>
              )}

              <div className="mt-5 pt-5 border-t border-brand-line">
                <p className="text-xs text-brand-ink-soft">
                  Need help? WhatsApp us with your order ID and we&apos;ll check
                  with the courier directly.
                </p>
                <a
                  href={waLink(`Hi, I need an update on my order ${order.id}.`)}
                  target="_blank"
                  rel="noopener"
                  className="mt-3 inline-flex items-center gap-2 bg-whatsapp-green hover:bg-whatsapp-green-hover text-white px-4 py-2.5 rounded-full font-semibold text-sm transition-colors"
                >
                  <WhatsAppIcon size={16} />
                  Chat about this order
                </a>
              </div>
            </div>
          )}

          {/* Sub-help block */}
          <div className="mt-10 border-t border-brand-line pt-6">
            <p className="text-xs font-mono font-bold uppercase tracking-widest text-brand-red">
              Can&apos;t find your order ID?
            </p>
            <p className="text-sm text-brand-ink-soft mt-2 leading-relaxed">
              Check the WhatsApp confirmation we sent to{" "}
              <span className="font-semibold text-brand-ink">
                {THEME.phoneDisplay}
              </span>{" "}
              after your order. The ID is in the first message and looks like{" "}
              <span className="font-mono text-brand-ink">PRC-XXXXXXXX</span>.
              <br />
              <br />
              Still stuck? WhatsApp us your name + delivery PIN and we&apos;ll
              find it.
            </p>
          </div>
        </section>
      </main>

      <Footer />
      <WhatsAppFab />
      <CartDrawer />
    </>
  );
}
