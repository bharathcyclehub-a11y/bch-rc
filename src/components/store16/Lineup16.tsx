"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, ShoppingBag } from "lucide-react";
import { STORE16, STORE16_PRODUCTS, formatINR16, type Store16Product } from "@/lib/store16";
import { getSkuBySlug } from "@/lib/products";
import { useLiveStock } from "@/lib/use-live-stock";
import { resolveProductAvailability } from "@/lib/availability";
import { useCart16 } from "@/lib/cart-store";
import { OFFERS } from "@/lib/config";
import { calcDiscountPct } from "@/lib/utils";
import { trackFunnel } from "@/lib/funnel-client";
import { Placeholder16 } from "./Placeholder16";

const PICK_REASONS: Record<string, string> = {
  Drift: "Everyday slider",
  Dares: "Flagship",
};

// MRP anchor + factual badge per series (no social-proof claims).
function cardMeta(p: Store16Product) {
  const mrpINR = p.series === "Dares" ? 4999 : 3999;
  const badge =
    p.series === "Dares" ? "PRO" : p.slug === "drift-inferno" ? "NEW" : null;
  return { mrpINR, badge };
}

function Card16({ p, index }: { p: Store16Product; index: number }) {
  const router = useRouter();
  const { mrpINR, badge } = cardMeta(p);
  const onlinePrice = p.priceINR - OFFERS.prepaidDiscountINR;
  const pct = calcDiscountPct(mrpINR, p.priceINR);

  const trackAdd = () =>
    trackFunnel("add_to_cart", { skuId: p.slug, qty: 1, valueInr: p.priceINR });
  const buyNow = () => {
    useCart16.getState().add(p.slug, null);
    trackAdd();
    router.push("/checkout?store=16");
  };
  const addToCart = () => {
    useCart16.getState().add(p.slug, null); // opens the drawer
    trackAdd();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: "easeOut" }}
      className="group relative flex w-[78%] shrink-0 snap-center flex-col overflow-hidden rounded-2xl border border-brand-line bg-white shadow-md transition-all duration-300 hover:-translate-y-1 hover:border-brand-red/40 hover:shadow-xl sm:w-[260px]"
    >
      {/* whole-card click target → PDP, behind the body */}
      <Link
        href={`/16/${p.slug}`}
        aria-label={`View ${p.name}`}
        className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      />

      <div className="relative">
        {p.heroImage ? (
          <div className="relative aspect-square w-full overflow-hidden bg-brand-cream">
            <Image
              src={p.heroImage}
              alt={p.name}
              fill
              loading="lazy"
              sizes="(max-width: 640px) 78vw, 260px"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </div>
        ) : (
          <Placeholder16
            label={p.name}
            className="aspect-square w-full rounded-none border-0 transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
        {badge && (
          <span className="absolute left-3 top-3 z-10 rounded-full bg-brand-red px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md sm:text-xs">
            {badge}
          </span>
        )}
      </div>

      <div className="pointer-events-none relative z-10 flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="-mb-1 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-brand-ink-soft">
            {STORE16.scaleFocus}
          </span>
          <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-widest text-brand-red">
            {PICK_REASONS[p.series] ?? "Pick"}
          </span>
        </div>

        <span className="font-display text-lg font-bold leading-tight text-brand-ink transition-colors group-hover:text-brand-red sm:text-xl">
          {p.name}
        </span>

        <div className="flex items-center gap-2">
          <span
            aria-label={p.colorway}
            className="h-3.5 w-3.5 shrink-0 rounded-full border border-brand-line shadow-sm"
            style={
              p.swatch2
                ? { background: `linear-gradient(135deg, ${p.swatch} 50%, ${p.swatch2} 50%)` }
                : { background: p.swatch }
            }
          />
          <span className="font-mono text-[11px] uppercase tracking-widest text-brand-ink-soft">
            {p.colorway}
          </span>
        </div>

        {/* honest dual price — online anchor + MRP slash + COD ceiling */}
        <div className="-mt-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xl font-bold text-brand-ink sm:text-2xl">
              {formatINR16(onlinePrice)}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-brand-ink-soft">
              online
            </span>
            <span className="text-xs text-brand-ink-soft line-through">
              {formatINR16(mrpINR)}
            </span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-brand-red">
              {pct}% off
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-brand-ink-soft">
            or {formatINR16(p.priceINR)} cash on delivery
          </div>
        </div>

        <div className="pointer-events-auto mt-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              buyNow();
            }}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-red px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-red-hover"
          >
            <Zap size={15} aria-hidden />
            Buy now — {formatINR16(onlinePrice)}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              addToCart();
            }}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-brand-ink/15 bg-white px-4 py-2 text-sm font-semibold text-brand-ink transition-colors hover:border-brand-ink"
          >
            <ShoppingBag size={14} aria-hidden />
            Add to cart
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function Lineup16() {
  const { stockMap, overridesMap } = useLiveStock();
  const visibleProducts = STORE16_PRODUCTS.filter((p) => {
    const sku = getSkuBySlug(p.slug);
    const ov = overridesMap?.[p.slug];
    if (ov?.hidden === true || sku?.hidden) return false;
    if (sku && stockMap !== null) {
      const avail = resolveProductAvailability(sku, stockMap, ov);
      if (!avail.purchasable) return false;
    }
    return true;
  });

  return (
    <section id="lineup" className="bg-brand-cream py-7 sm:py-14">
      <div className="mx-auto max-w-7xl px-5 sm:px-10">
        <div className="mb-6 text-center sm:mb-8">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand-red">
            {STORE16.lineupEyebrow}
          </span>
          <h2 className="mt-2 font-display text-3xl font-bold text-brand-ink sm:text-5xl">
            {STORE16.lineupH2}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-brand-ink-soft">{STORE16.lineupSub}</p>
        </div>

        <div className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto overflow-y-hidden px-5 pb-4 no-scrollbar sm:-mx-10 sm:gap-6 sm:px-10">
          {visibleProducts.map((p, i) => (
            <Card16 key={p.slug} p={p} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
