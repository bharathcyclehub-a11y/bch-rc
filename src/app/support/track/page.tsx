import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppFab from "@/components/WhatsAppFab";
import CartDrawer from "@/components/CartDrawer";
import { THEME } from "@/lib/theme";
import TrackClient, { TrackFormFallback } from "./TrackClient";

export const metadata: Metadata = {
  title: { absolute: "Track your order — PRC Support" },
  description: "Check the delivery status of your Pocket RC Cars order with your PRC order ID.",
  alternates: { canonical: "/support/track" },
};

export default function SupportTrackPage() {
  return (
    <>
      <AnnouncementBar />
      <Header />
      <nav aria-label="Breadcrumb" className="border-b border-brand-line bg-white">
        <ol className="max-w-3xl mx-auto px-4 flex items-center gap-1 text-sm">
          <li>
            <Link
              href="/support"
              className="inline-flex items-center gap-1 min-h-12 text-brand-ink-soft hover:text-brand-ink"
            >
              <ChevronLeft size={16} aria-hidden />
              Support
            </Link>
          </li>
          <li aria-hidden className="text-neutral-400">
            /
          </li>
          <li>
            <span aria-current="page" className="font-semibold text-brand-ink">
              Track order
            </span>
          </li>
        </ol>
      </nav>

      <main className="flex-1 bg-white">
        <section className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
          <p className="text-xs font-mono font-bold uppercase tracking-widest text-brand-red">
            Track your order
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-brand-ink mt-2 text-balance">
            Where&apos;s my order?
          </h1>
          <p className="text-base text-brand-ink-soft mt-3 leading-relaxed">
            Enter the order ID from your WhatsApp / SMS confirmation. Looks like{" "}
            <span className="font-mono text-brand-ink">PRC-XXXXXXXX</span>.
          </p>

          <Suspense fallback={<TrackFormFallback />}>
            <TrackClient />
          </Suspense>

          <div className="mt-10 border-t border-brand-line pt-6">
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-brand-red">
              Can&apos;t find your order ID?
            </h2>
            <p className="text-sm text-brand-ink-soft mt-2 leading-relaxed">
              Check the WhatsApp confirmation we sent from{" "}
              <span className="font-semibold text-brand-ink">{THEME.phoneDisplay}</span> after your
              order. The ID is in the first message and looks like{" "}
              <span className="font-mono text-brand-ink">PRC-XXXXXXXX</span>.
            </p>
            <p className="text-sm text-brand-ink-soft mt-3 leading-relaxed">
              Still stuck? WhatsApp us your name + delivery PIN and we&apos;ll find it.
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
