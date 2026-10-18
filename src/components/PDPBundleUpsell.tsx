"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, Plus } from "lucide-react";
import type { Sku } from "@/lib/products";
import { getVisibleProducts } from "@/lib/products";
import { formatINR, cn } from "@/lib/utils";
import { useCart } from "@/lib/cart-store";
import { bundleDiscountInr } from "@/lib/config";
import { useLiveStock } from "@/lib/use-live-stock";
import { resolveProductAvailability } from "@/lib/availability";

/**
 * "Pair it" bundle module — sits below the Buy Now button on the PDP.
 * Uses live stock to ensure neither the primary SKU nor the recommended
 * companion SKU is out of stock.
 */
export default function PDPBundleUpsell({
  sku,
  selectedColorSlug,
}: {
  sku: Sku;
  selectedColorSlug?: string | null;
}) {
  const router = useRouter();
  const { stockMap, overridesMap } = useLiveStock();

  const currentAvail = useMemo(
    () => resolveProductAvailability(sku, stockMap, overridesMap?.[sku.id]),
    [sku, stockMap, overridesMap],
  );

  const availableOthers = useMemo(() => {
    if (!stockMap) return [];
    return getVisibleProducts().filter((p) => {
      if (p.id === sku.id || p.id === "construction-3pack") return false;
      const avail = resolveProductAvailability(p, stockMap, overridesMap?.[p.id]);
      return avail.purchasable;
    });
  }, [sku.id, stockMap, overridesMap]);

  const [includePair, setIncludePair] = useState(true);
  const [pair, setPair] = useState<Sku | null>(null);

  useEffect(() => {
    if (availableOthers.length > 0) {
      setPair((prev) => {
        if (prev && availableOthers.some((o) => o.id === prev.id)) return prev;
        return availableOthers[Math.floor(Math.random() * availableOthers.length)];
      });
    } else {
      setPair(null);
    }
  }, [availableOthers]);

  // Do not render the bundle upsell if the current SKU is unavailable or no in-stock companion exists
  if (!stockMap || !currentAvail.purchasable || !pair) return null;

  const pairAvail = resolveProductAvailability(pair, stockMap, overridesMap?.[pair.id]);
  if (!pairAvail.purchasable) return null;

  const pairSavings = bundleDiscountInr(2, sku.retailINR + pair.retailINR);
  const singleTotal = sku.retailINR;
  const pairTotal = sku.retailINR + pair.retailINR - pairSavings;
  const finalTotal = includePair ? pairTotal : singleTotal;

  function addBundle() {
    if (!currentAvail.purchasable || !pair) return;
    const cart = useCart.getState();
    const primaryVariant = selectedColorSlug ?? currentAvail.firstAvailableVariantSlug;
    cart.add(sku.id, primaryVariant, 1, currentAvail.maxOrderQty);
    if (includePair && pairAvail.purchasable) {
      cart.add(pair.id, pairAvail.firstAvailableVariantSlug, 1, pairAvail.maxOrderQty);
    }
    router.push("/checkout");
  }

  return (
    <div className="mt-6 border-2 border-brand-red/20 rounded-xl overflow-hidden bg-brand-red/5">
      <div className="px-3 py-2 sm:px-4 sm:py-3 bg-brand-red text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest bg-white text-brand-red px-2 py-0.5 rounded-full">
            Best Deal
          </span>
          <span className="text-[13px] sm:text-sm font-bold">
            Pair it · save {formatINR(pairSavings)}
          </span>
        </div>
        <span className="text-xs font-mono uppercase tracking-widest opacity-90">
          1 + 1
        </span>
      </div>

      <div className="p-3 space-y-2.5 sm:p-4 sm:space-y-3">
        {/* This SKU row */}
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-lg overflow-hidden bg-white border border-brand-line">
            <Image
              src={sku.heroImage}
              alt={sku.name}
              fill
              sizes="56px"
              className="object-contain"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-ink truncate">
              {sku.name}
            </p>
            <p className="text-xs text-brand-ink-soft">{formatINR(sku.retailINR)}</p>
          </div>
          <Check size={18} className="text-success shrink-0" />
        </div>

        {/* Plus divider */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-brand-line" />
          <Plus size={14} className="text-brand-ink-soft" />
          <div className="flex-1 h-px bg-brand-line" />
        </div>

        {/* Pair-with SKU row — toggleable */}
        <button
          type="button"
          onClick={() => setIncludePair((v) => !v)}
          className={cn(
            "w-full flex items-center gap-3 p-2 rounded-lg border-2 transition-colors text-left cursor-pointer",
            includePair
              ? "border-brand-red bg-white"
              : "border-brand-line bg-white/50",
          )}
        >
          <div className="relative w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-lg overflow-hidden bg-white border border-brand-line">
            <Image
              src={pair.heroImage}
              alt={pair.name}
              fill
              sizes="56px"
              className="object-contain"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-ink truncate">
              {pair.name}
            </p>
            <p className="text-xs text-brand-ink-soft">
              {formatINR(pair.retailINR)}
              <span className="ml-2 text-success font-semibold">
                save {formatINR(pairSavings)} together
              </span>
            </p>
          </div>
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
              includePair
                ? "bg-brand-red border-brand-red text-white"
                : "border-brand-line",
            )}
          >
            {includePair && <Check size={12} strokeWidth={3} />}
          </div>
        </button>

        {/* Total + CTA */}
        <div className="pt-1 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-brand-ink-soft">
              Bundle price (COD)
            </p>
            <p className="text-lg sm:text-xl font-bold text-brand-ink leading-none">
              {formatINR(finalTotal)}
              {includePair && (
                <span className="ml-2 text-xs font-mono text-success">
                  −{formatINR(pairSavings)}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={addBundle}
            className="bg-brand-ink hover:bg-black text-white px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl font-bold text-sm transition-colors cursor-pointer"
          >
            {includePair ? "Buy bundle" : "Buy single"} →
          </button>
        </div>
      </div>
    </div>
  );
}
