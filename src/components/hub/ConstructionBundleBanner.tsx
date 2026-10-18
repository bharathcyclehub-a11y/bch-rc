"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap } from "lucide-react";
import { getConstructionBundle, getSkuById } from "@/lib/products";
import { useCart } from "@/lib/cart-store";
import { formatINR, calcDiscountPct } from "@/lib/utils";
import { THEME } from "@/lib/theme";
import { trackAddToCart, trackInitiateCheckout } from "@/lib/analytics-client";
import { trackFunnel } from "@/lib/funnel-client";
import { useLiveStock } from "@/lib/use-live-stock";
import { resolveProductAvailability } from "@/lib/availability";

/**
 * Construction 3-Pack — a COMPACT promo banner with one big CTA that drops the
 * fixed-price bundle SKU (₹4,999 for all three rigs) into the shared cart as a
 * single line item, so checkout hits the exact set price.
 * Validates both the bundle SKU and all 3 component SKUs against live stock.
 */
export default function ConstructionBundleBanner() {
  const router = useRouter();
  const { stockMap, overridesMap } = useLiveStock();
  const bundle = getConstructionBundle();
  if (!bundle) return null;

  const avail = resolveProductAvailability(bundle, stockMap, overridesMap?.[bundle.id]);
  const online = bundle.retailINR - THEME.prepaidDiscountINR;
  const pct = calcDiscountPct(bundle.mrpINR, bundle.retailINR);

  const availableComponents = (bundle.bundleComponentSkuIds ?? [])
    .map((id) => getSkuById(id))
    .filter((s): s is NonNullable<typeof s> =>
      Boolean(s && resolveProductAvailability(s, stockMap, overridesMap?.[s.id]).purchasable),
    );

  const buyNow = () => {
    if (!avail.purchasable) return;
    useCart.getState().add(bundle.id, null, 1, avail.maxOrderQty);
    trackAddToCart({ sku: bundle.id, name: bundle.name, priceInr: bundle.retailINR, quantity: 1 });
    trackFunnel("add_to_cart", { skuId: bundle.id, qty: 1, valueInr: bundle.retailINR, via: "bundle_banner" });
    trackInitiateCheckout(online);
    router.push("/checkout");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-line bg-brand-ink text-white shadow-md">
      <div className="grid sm:grid-cols-5">
        <div className="relative aspect-[16/10] bg-black sm:col-span-2 sm:aspect-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bundle.heroImage}
            alt="Construction 3-Pack — Mining Truck, Excavator and Forklift"
            className={`h-full w-full object-cover ${!avail.purchasable && stockMap ? "opacity-75 saturate-50" : ""}`}
          />
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow ${
              !avail.purchasable && stockMap ? "bg-zinc-800 text-white" : "bg-brand-red text-white"
            }`}
          >
            {!avail.purchasable && stockMap ? "Bundle Sold Out" : "3-Pack deal"}
          </span>
        </div>

        <div className="flex flex-col justify-center gap-1.5 p-4 sm:col-span-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-extrabold uppercase leading-tight sm:text-2xl">
              Construction <span className="text-brand-red">3-Pack</span>
            </h3>
            {stockMap && avail.status === "LOW_STOCK" && (
              <span className="rounded-full bg-amber-500/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                {avail.label}
              </span>
            )}
          </div>
          <p className="text-xs text-white/60 sm:text-sm">
            Mining Truck + Excavator + Forklift — all three in one order.
          </p>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-display text-2xl font-extrabold sm:text-3xl">{formatINR(bundle.retailINR)}</span>
            <span className="text-sm text-white/45 line-through">{formatINR(bundle.mrpINR)}</span>
            <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-white">
              {pct}% off · save {formatINR(bundle.mrpINR - bundle.retailINR)}
            </span>
          </div>

          {!stockMap ? (
            <button
              type="button"
              disabled
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-white/15 px-5 py-3 text-sm font-bold text-white/60 cursor-wait"
            >
              Checking stock…
            </button>
          ) : avail.purchasable ? (
            <button
              type="button"
              onClick={buyNow}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-brand-red px-5 py-3 text-sm font-bold text-white shadow-lg animate-heartbeat sm:text-base cursor-pointer"
            >
              <Zap size={16} aria-hidden />
              Buy all 3 — {formatINR(bundle.retailINR)}
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="inline-flex items-center gap-2 rounded-xl bg-red-500/15 border border-red-400/30 px-3.5 py-2 text-xs font-semibold text-red-200">
                3-Pack temporarily unavailable (one or more rigs out of stock).
              </div>
              {availableComponents.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-white/60">Available individually:</span>
                  {availableComponents.map((comp) => (
                    <Link
                      key={comp.id}
                      href={`/product/${comp.slug}`}
                      className="rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-1 font-bold text-amber-300 transition"
                    >
                      {comp.name} →
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
