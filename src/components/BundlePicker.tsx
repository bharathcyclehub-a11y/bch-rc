"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check, ShoppingBag, Plus, Sparkles, X } from "lucide-react";
import { BUNDLE_TIERS, bundleDiscountPct } from "@/lib/config";
import { cn, formatINR } from "@/lib/utils";
import { ALL_SKUS, Sku } from "@/lib/products";
import { useLiveStock } from "@/lib/use-live-stock";
import { resolveProductAvailability } from "@/lib/availability";
import { useCart } from "@/lib/cart-store";
import { trackAddToCart } from "@/lib/analytics-client";
import { trackFunnel } from "@/lib/funnel-client";

const TIER_BY_QTY: Record<2 | 3 | 4, { pct: number }> = {
  2: { pct: BUNDLE_TIERS.find((t) => t.minQty === 2)?.pct ?? 5 },
  3: { pct: BUNDLE_TIERS.find((t) => t.minQty === 3)?.pct ?? 10 },
  4: { pct: BUNDLE_TIERS.find((t) => t.minQty === 4)?.pct ?? 15 },
};

type BundleOption = {
  qty: 2 | 3 | 4;
  label: string;
  savePct: number;
  badge?: "MOST POPULAR" | "BEST VALUE";
  sub: string;
  cars: { src: string; alt: string }[];
};

const CAR_BMW = { src: "/products/PRC-bmw.webp", alt: "Pocket BMW" };
const CAR_PORSCHE = { src: "/products/PRC-porsche.webp", alt: "Pocket Porsche" };
const CAR_MONSTER = { src: "/products/PRC-monster.webp", alt: "Pocket Monster Truck" };
const CAR_16 = { src: "/store16-images/drift-inferno/1-hero.webp", alt: "Drift Inferno 1:16" };

const OPTIONS: BundleOption[] = [
  {
    qty: 2,
    label: "Mix any 2",
    savePct: TIER_BY_QTY[2].pct,
    badge: "MOST POPULAR",
    sub: "Gift + keep",
    cars: [CAR_PORSCHE, CAR_16],
  },
  {
    qty: 3,
    label: "Mix any 3",
    savePct: TIER_BY_QTY[3].pct,
    sub: "Race night",
    cars: [CAR_BMW, CAR_PORSCHE, CAR_16],
  },
  {
    qty: 4,
    label: "Mix any 4+",
    savePct: TIER_BY_QTY[4].pct,
    badge: "BEST VALUE",
    sub: "Full garage",
    cars: [CAR_BMW, CAR_PORSCHE, CAR_MONSTER, CAR_16],
  },
];

export default function BundlePicker() {
  const [selectedQty, setSelectedQty] = useState<2 | 3 | 4>(2);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const { stockMap, overridesMap } = useLiveStock();
  const add = useCart((s) => s.add);

  const availableSkus = useMemo(() => {
    if (!stockMap) return [];
    return ALL_SKUS.filter((sku) => {
      if (sku.id === "construction-3pack") return false;
      const avail = resolveProductAvailability(sku, stockMap, overridesMap?.[sku.id]);
      return avail.purchasable;
    });
  }, [stockMap, overridesMap]);

  const pickedSkus = useMemo(
    () =>
      pickedIds
        .map((id) => availableSkus.find((s) => s.id === id))
        .filter((s): s is Sku => Boolean(s)),
    [pickedIds, availableSkus],
  );

  const subtotal = pickedSkus.reduce((acc, s) => acc + s.retailINR, 0);
  const activePct = bundleDiscountPct(pickedSkus.length);
  const discountInr = Math.round((subtotal * activePct) / 100);
  const finalPrice = subtotal - discountInr;

  const handleOpenBuilder = (targetQty: 2 | 3 | 4) => {
    setSelectedQty(targetQty);
    setBuilderOpen(true);
    if (pickedIds.length === 0 && availableSkus.length >= targetQty) {
      setPickedIds(availableSkus.slice(0, targetQty).map((s) => s.id));
    }
  };

  const handleAddSlot = (skuId: string) => {
    setPickedIds((prev) => [...prev, skuId]);
  };

  const handleRemoveSlot = (index: number) => {
    setPickedIds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddBundleToCart = () => {
    if (pickedSkus.length === 0) return;
    for (const sku of pickedSkus) {
      const avail = resolveProductAvailability(sku, stockMap, overridesMap?.[sku.id]);
      if (!avail.purchasable) continue;
      add(sku.id, avail.firstAvailableVariantSlug, 1, avail.maxOrderQty);
      trackAddToCart({
        sku: sku.id,
        name: sku.name,
        priceInr: sku.retailINR,
        quantity: 1,
      });
      trackFunnel("add_to_cart", {
        skuId: sku.id,
        variantSlug: avail.firstAvailableVariantSlug,
        qty: 1,
        valueInr: sku.retailINR,
        via: "bundle_builder",
      });
    }
  };

  const handleScrollToCatalog = () => {
    if (typeof window === "undefined") return;
    const lineup = document.getElementById("hub-shop") ?? document.getElementById("sku");
    if (lineup) {
      lineup.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.location.href = "/#hub-shop";
  };

  return (
    <section id="bundles" className="py-5 sm:py-10 bg-brand-cream">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center">
          <span className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-brand-red">
            Bundle &amp; save
          </span>
          <h2 className="font-display text-xl sm:text-3xl font-bold text-brand-ink mt-1 text-balance">
            More cars. <span className="text-brand-red">Bigger savings.</span>
          </h2>
          <p className="text-brand-ink-soft text-xs sm:text-sm mt-1">
            Mix any in-stock models across scales — discount auto-applies in your cart.
          </p>
        </div>

        {/* Tier cards */}
        <div className="mt-4 sm:mt-10 -mx-4 sm:mx-0 overflow-x-auto overflow-y-hidden sm:overflow-visible snap-x snap-mandatory sm:snap-none no-scrollbar">
          <div className="flex items-start sm:items-stretch sm:grid sm:grid-cols-3 gap-3 sm:gap-6 px-4 sm:px-0 pb-2 sm:pb-0 pt-3 sm:pt-0">
            {OPTIONS.map((opt, i) => {
              const isSelected = opt.qty === selectedQty;
              return (
                <motion.button
                  key={opt.qty}
                  type="button"
                  onClick={() => handleOpenBuilder(opt.qty)}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.08, ease: "easeOut" }}
                  className={cn(
                    "snap-center shrink-0 w-[82%] sm:w-auto relative text-center bg-white rounded-2xl p-4 sm:p-7 border-2 transition-all cursor-pointer",
                    isSelected
                      ? "border-brand-red shadow-2xl scale-[1.02]"
                      : "border-brand-line hover:border-brand-ink/40 hover:shadow-md",
                  )}
                  aria-pressed={isSelected}
                >
                  {opt.badge && (
                    <span
                      className={cn(
                        "absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap",
                        opt.badge === "MOST POPULAR"
                          ? "bg-brand-red text-white"
                          : "bg-brand-ink text-white",
                      )}
                    >
                      {opt.badge}
                    </span>
                  )}

                  <span
                    className={cn(
                      "absolute top-3 right-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors",
                      isSelected
                        ? "border-brand-red bg-brand-red text-white"
                        : "border-brand-line",
                    )}
                    aria-hidden
                  >
                    {isSelected && <Check size={14} strokeWidth={3} />}
                  </span>

                  <span className="block font-mono text-[11px] sm:text-xs uppercase tracking-widest text-brand-ink font-semibold">
                    {opt.sub}
                  </span>

                  <h3 className="font-display text-2xl sm:text-4xl font-bold text-brand-ink mt-2 sm:mt-3">
                    {opt.label}
                  </h3>

                  <div
                    className="mt-2 sm:mt-3 flex items-center justify-center gap-1 sm:gap-1.5"
                    aria-hidden
                  >
                    {opt.cars.map((car, idx) => (
                      <div key={idx} className="flex items-center gap-1 sm:gap-1.5">
                        {idx > 0 && (
                          <Plus
                            size={12}
                            strokeWidth={2.5}
                            className="text-brand-ink-soft shrink-0"
                          />
                        )}
                        <div className="relative w-10 h-10 sm:w-14 sm:h-14 rounded-lg bg-brand-cream border border-brand-line overflow-hidden shrink-0">
                          <Image
                            src={car.src}
                            alt={car.alt}
                            fill
                            sizes="56px"
                            className="object-contain p-0.5"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 sm:mt-4">
                    <div className="font-display text-2xl sm:text-3xl font-bold text-success">
                      Save {opt.savePct}%{opt.qty === 4 ? "+" : ""}
                    </div>
                  </div>

                  <div className="mt-2 inline-block bg-success/10 text-success text-[11px] sm:text-xs font-bold px-2.5 py-1 rounded-full">
                    TAP TO BUILD
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Interactive Mix & Match Bundle Builder */}
        {builderOpen && stockMap && availableSkus.length > 0 && (
          <div className="mt-6 rounded-2xl border-2 border-brand-ink/15 bg-white p-4 sm:p-6 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-line pb-3">
              <div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-brand-red">
                  <Sparkles size={13} /> Interactive Bundle Builder
                </span>
                <h3 className="font-display text-lg sm:text-xl font-extrabold text-brand-ink">
                  Goal: Pick {selectedQty}{selectedQty === 4 ? "+" : ""} in-stock cars ({pickedSkus.length} selected)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBuilderOpen(false)}
                className="text-xs font-semibold text-brand-ink-soft hover:text-brand-ink cursor-pointer"
              >
                Close builder ✕
              </button>
            </div>

            {/* Selected slots */}
            <div className="mt-4">
              <div className="text-xs font-bold uppercase tracking-wider text-brand-ink-soft mb-2">
                Your Bundle Lineup
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {pickedSkus.map((sku, idx) => (
                  <div
                    key={`${sku.id}-${idx}`}
                    className="flex items-center gap-2 rounded-xl border border-brand-line bg-brand-cream/60 pl-2 pr-2.5 py-1.5"
                  >
                    <div className="relative h-9 w-9 rounded-lg bg-white border border-brand-line overflow-hidden shrink-0">
                      <Image src={sku.heroImage} alt={sku.name} fill sizes="36px" className="object-contain p-0.5" />
                    </div>
                    <div className="text-xs">
                      <div className="font-bold text-brand-ink leading-tight">{sku.name}</div>
                      <div className="text-brand-ink-soft">{formatINR(sku.retailINR)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSlot(idx)}
                      aria-label={`Remove ${sku.name} from bundle`}
                      className="ml-1 rounded-full p-1 text-brand-ink-soft hover:bg-black/5 hover:text-brand-ink cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}

                {Array.from({ length: Math.max(0, selectedQty - pickedSkus.length) }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="flex h-12 items-center justify-center rounded-xl border-2 border-dashed border-brand-line px-4 text-xs font-semibold text-brand-ink-soft"
                  >
                    + Pick car #{pickedSkus.length + i + 1} below
                  </div>
                ))}
              </div>
            </div>

            {/* Quick picker of in-stock models */}
            <div className="mt-4">
              <div className="text-xs font-bold uppercase tracking-wider text-brand-ink-soft mb-2">
                Tap an In-Stock Model to Add ({availableSkus.length} ready to ship)
              </div>
              <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-2">
                {availableSkus.slice(0, 14).map((sku) => {
                  const countInBundle = pickedIds.filter((id) => id === sku.id).length;
                  const avail = resolveProductAvailability(sku, stockMap, overridesMap?.[sku.id]);
                  const atLimit = countInBundle >= avail.maxOrderQty;
                  return (
                    <button
                      key={sku.id}
                      type="button"
                      disabled={atLimit}
                      onClick={() => handleAddSlot(sku.id)}
                      className={cn(
                        "flex w-36 shrink-0 flex-col rounded-xl border p-2.5 text-left transition cursor-pointer",
                        countInBundle > 0
                          ? "border-brand-red bg-red-50/40"
                          : "border-brand-line bg-white hover:border-brand-ink/40",
                        atLimit && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <div className="relative h-20 w-full rounded-lg bg-brand-cream overflow-hidden">
                        <Image src={sku.heroImage} alt={sku.name} fill sizes="128px" className="object-contain p-1" />
                        {countInBundle > 0 && (
                          <span className="absolute right-1.5 top-1.5 rounded-full bg-brand-red px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                            ×{countInBundle}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 line-clamp-1 text-xs font-bold text-brand-ink">{sku.name}</div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px]">
                        <span className="font-extrabold text-brand-ink">{formatINR(sku.retailINR)}</span>
                        <span className="font-bold text-brand-red">+ Add</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary & Add Bundle CTA */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-ink p-4 text-white">
              <div>
                <div className="text-xs text-white/70">
                  {pickedSkus.length} {pickedSkus.length === 1 ? "car" : "cars"} selected
                  {activePct > 0 ? ` · ${activePct}% bundle discount unlocked!` : ` · Add ${Math.max(1, 2 - pickedSkus.length)} more to unlock 5% off`}
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-extrabold text-white">
                    {formatINR(finalPrice)}
                  </span>
                  {discountInr > 0 && (
                    <>
                      <span className="text-sm text-white/45 line-through">{formatINR(subtotal)}</span>
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                        Save {formatINR(discountInr)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={pickedSkus.length === 0}
                onClick={handleAddBundleToCart}
                className="inline-flex items-center gap-2 rounded-full bg-brand-red hover:bg-brand-red-hover disabled:opacity-50 px-6 py-3 text-sm font-bold text-white shadow-lg transition cursor-pointer"
              >
                <ShoppingBag size={17} />
                Add {pickedSkus.length} {pickedSkus.length === 1 ? "Car" : "Cars"} to Cart
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 sm:mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          {!builderOpen && (
            <button
              type="button"
              onClick={() => handleOpenBuilder(selectedQty)}
              className="bg-brand-red hover:bg-brand-red-hover text-white px-7 sm:px-8 py-3.5 sm:py-4 rounded-full font-semibold text-base sm:text-lg shadow-2xl transition-colors animate-heartbeat flex items-center gap-2 cursor-pointer"
            >
              <Sparkles size={19} aria-hidden />
              {`Build My Mix ${selectedQty}${selectedQty === 4 ? "+" : ""} Bundle`}
            </button>
          )}
          <button
            type="button"
            onClick={handleScrollToCatalog}
            className="bg-white hover:bg-brand-cream text-brand-ink border border-brand-line px-6 py-3.5 rounded-full font-semibold text-sm sm:text-base transition-colors flex items-center gap-2 cursor-pointer"
          >
            <ShoppingBag size={18} aria-hidden />
            Browse Full Catalog
          </button>
        </div>
        <p className="text-brand-ink text-[10px] sm:text-xs mt-2 font-mono font-medium text-center">
          Free shipping · COD · 24-hr dispatch
        </p>
      </div>
    </section>
  );
}
