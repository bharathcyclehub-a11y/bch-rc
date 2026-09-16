"use client";

import { Fragment, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Minus,
  Plus,
  ShoppingBag,
  Truck,
  Shield,
  RotateCw,
  Check,
  Lock,
  BadgeCheck,
} from "lucide-react";
import { pdpSpecRows, type Sku } from "@/lib/products";
import { formatINR, calcDiscountPct, cn } from "@/lib/utils";

// SKUs without color variants don't track per-unit stock — cap them at a sane
// per-order quantity so the stepper still has an upper bound.
const NO_VARIANT_MAX_QTY = 10;
// Threshold under which we surface a "Only N left" scarcity nudge.
const LOW_STOCK_THRESHOLD = 5;
import { useCart } from "@/lib/cart-store";
import { ProductPlaceholder } from "@/components/ProductPlaceholder";
import PDPStickyCTA from "@/components/PDPStickyCTA";
import { Skeleton } from "@/components/Skeleton";
import { EmiBadge } from "@/components/EmiBadge";
import { Stars } from "@/components/Stars";
import {
  PdpReviews,
  type PdpReviewItem,
  type PdpReviewData,
} from "@/components/PdpReviews";
import { TRUST } from "@/lib/config";
import { baselineRatingFor, baselineCountFor } from "@/lib/reviews-baseline";
import { recordView } from "@/lib/recently-viewed";
import {
  trackAddToCart,
  trackInitiateCheckout,
} from "@/lib/analytics-client";
import { trackFunnel } from "@/lib/funnel-client";

// Below-fold sections — split into their own JS chunks so the buy-box +
// gallery don't wait on their bundle. Skeletons hold the layout so scrolling
// down doesn't jolt the page when the chunk arrives.
const PDPBundleUpsell = dynamic(() => import("@/components/PDPBundleUpsell"), {
  loading: () => <Skeleton className="h-72 w-full my-8" />,
});
const RecentlyViewed = dynamic(() => import("@/components/RecentlyViewed"), {
  loading: () => <Skeleton className="h-72 w-full my-8" />,
  ssr: false,
});

function swatchBg(swatch: string): string {
  if (swatch.startsWith("gradient:")) {
    return `linear-gradient(135deg, ${swatch.slice("gradient:".length)})`;
  }
  return swatch;
}

/**
 * Gallery image with graceful fallback — uses next/image and degrades to the
 * colored SVG placeholder if the file 404s. Lets us list altImages that don't
 * exist yet without breaking the page.
 */
function GalleryImage({
  src,
  sku,
  alt,
  priority,
  sizes = "(min-width: 1024px) 600px, 100vw",
}: {
  src: string;
  sku: Sku;
  alt: string;
  priority?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ProductPlaceholder sku={sku} showLabel={false} />;
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      quality={85}
      className="object-contain object-center"
      priority={priority}
      onError={() => setFailed(true)}
    />
  );
}

export default function PDPClient({
  sku,
  siteId,
  reviews,
  reviewData,
}: {
  sku: Sku;
  siteId: string;
  reviews: PdpReviewItem[];
  reviewData: PdpReviewData;
}) {
  // Per-product rating: real average once approved reviews exist, else a
  // deterministic per-SKU baseline (4.5–4.9) so each product shows a distinct
  // star row instead of an identical 4.7 across the whole catalog.
  const baselineRating = baselineRatingFor(sku.id);
  const baselineCount = baselineCountFor(sku.id);
  const ratingValue =
    reviewData.count > 0 ? reviewData.averageRating : baselineRating;
  const ratingCount = reviewData.count > 0 ? reviewData.count : baselineCount;
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [selectedColorSlug, setSelectedColorSlug] = useState<string | null>(
    sku.colors?.[0]?.slug ?? null
  );

  // DB inventory is the single source of truth for stock. Fetch the live map
  // for this SKU on mount; until it loads we stay optimistic (the order-create
  // endpoint is the hard gate, so an optimistic add can never oversell).
  const [stockMap, setStockMap] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stock?skuIds=${encodeURIComponent(sku.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.stock === "object") setStockMap(d.stock);
      })
      .catch(() => {
        /* leave stock optimistic on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [sku.id]);

  const stockLoaded = stockMap !== null;
  // null while loading (treat as available); a number once loaded (0 = sold out).
  const stockOf = (slug: string | null): number | null =>
    stockMap ? stockMap[`${sku.id}:${slug ?? ""}`] ?? 0 : null;

  // Once live stock loads, if the pre-selected colour is sold out, jump to the
  // first in-stock colour so the buyer never lands on an unavailable variant.
  useEffect(() => {
    if (!stockMap || !sku.colors?.length) return;
    if ((stockMap[`${sku.id}:${selectedColorSlug ?? ""}`] ?? 0) > 0) return;
    const firstIn = sku.colors.find(
      (c) => (stockMap[`${sku.id}:${c.slug}`] ?? 0) > 0,
    );
    if (firstIn) {
      setSelectedColorSlug(firstIn.slug);
      setActiveImage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockMap]);

  const selectedColor =
    sku.colors?.find((c) => c.slug === selectedColorSlug) ?? null;
  const hasColors = !!sku.colors?.length;
  const selectedStock = stockOf(selectedColorSlug);
  // Sold out only once live stock has loaded and confirms zero. Colour-less
  // SKUs stay purchasable (the server caps qty).
  const outOfStock = hasColors ? stockLoaded && (selectedStock ?? 0) <= 0 : false;
  // Qty cap: real DB stock once loaded; an optimistic cap while loading.
  const LOADING_MAX = 10;
  const maxQty = hasColors
    ? stockLoaded
      ? Math.max(1, selectedStock ?? 0)
      : LOADING_MAX
    : NO_VARIANT_MAX_QTY;
  const savings = sku.mrpINR - sku.retailINR;
  const pct = calcDiscountPct(sku.mrpINR, sku.retailINR);
  // Gallery: color-specific hero plus per-color alt angles when the
  // selected swatch defines them. Falls back to sku.altImages (shared
  // across colors) only for color-less SKUs — the legacy shared alts
  // were AI-generated and don't match the cleaned real-photo color
  // heros, so colored SKUs MUST use per-color alts.
  const heroSrc = selectedColor?.image ?? sku.heroImage;
  const colorAlts = selectedColor?.altImages ?? [];
  const gallery = sku.colors?.length
    ? [heroSrc, ...colorAlts].filter(Boolean)
    : [heroSrc, ...(sku.altImages ?? [])].filter(Boolean);
  const activeSrc = gallery[activeImage] ?? heroSrc;

  function addToCart() {
    if (outOfStock) return;
    const finalQty = Math.min(qty, maxQty);
    // `add` opens the drawer itself.
    useCart.getState().add(sku.id, selectedColorSlug, finalQty);
    trackAddToCart({
      sku: sku.id,
      name: sku.name,
      priceInr: sku.retailINR,
      quantity: finalQty,
    });
    trackFunnel("add_to_cart", {
      skuId: sku.id,
      variant: selectedColorSlug,
      qty: finalQty,
      valueInr: sku.retailINR * finalQty,
      via: "pdp",
    });
  }

  function buyNow() {
    if (outOfStock) return;
    const finalQty = Math.min(qty, maxQty);
    useCart.getState().add(sku.id, selectedColorSlug, finalQty);
    trackAddToCart({
      sku: sku.id,
      name: sku.name,
      priceInr: sku.retailINR,
      quantity: finalQty,
    });
    trackFunnel("add_to_cart", {
      skuId: sku.id,
      variant: selectedColorSlug,
      qty: finalQty,
      valueInr: sku.retailINR * finalQty,
      via: "pdp_buynow",
    });
    trackInitiateCheckout(sku.retailINR * finalQty);
    router.push("/checkout");
  }

  // Track this SKU as recently viewed for the "Pick up where you left off"
  // strip — fires once when the PDP mounts.
  useEffect(() => {
    recordView(sku.id);
    trackFunnel("product_view", {
      skuId: sku.id,
      name: sku.name,
      priceInr: sku.retailINR,
    });
  }, [sku.id]);

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-12 max-w-6xl mx-auto px-4 py-4 sm:py-8">
      {/* Image gallery. On mobile this is just a normal block — no sticky,
          no overflow scroll, no aspect-ratio mismatch. The card is always
          square so the 1:1 source images fill it edge-to-edge with no
          "floating" white margin. */}
      <div className="space-y-3 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto no-scrollbar">
        <div className="aspect-square rounded-2xl overflow-hidden border border-brand-line bg-brand-cream relative">
          <GalleryImage src={activeSrc} sku={sku} alt={sku.name} priority />
        </div>
        {gallery.length > 1 && (
          <div className="grid grid-cols-4 gap-2">
            {gallery.slice(0, 4).map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setActiveImage(i)}
                className={cn(
                  "aspect-square rounded-lg overflow-hidden border-2 transition-all relative bg-white",
                  activeImage === i
                    ? "border-brand-red"
                    : "border-brand-line hover:border-brand-ink-soft"
                )}
                aria-label={`View image ${i + 1}`}
              >
                <GalleryImage src={src} sku={sku} alt={`${sku.name} view ${i + 1}`} sizes="(min-width: 1024px) 140px, 25vw" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Info column */}
      <div>
        {sku.badge && (
          <span className="inline-block bg-brand-red text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-2 sm:mb-3">
            {sku.badge}
          </span>
        )}
        {/* Single kicker line: scale + the product's own body class. The
            bodyShape sometimes already carries the scale (e.g. "1:16 Drift
            Car"), so strip a leading scale token to avoid "1:16 · 1:16 Drift
            Car". One line only — Google still indexes scale + class here. */}
        <p className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-red">
          {sku.kind === "Ride-on" ? "Ride-on" : `${sku.scale} ${sku.kind ?? "die-cast RC"}`} · {sku.bodyShape.replace(/^1:\d+\s+/i, "")}
        </p>
        <h1 className="text-2xl sm:text-4xl font-bold text-brand-ink mt-0.5 leading-tight text-balance">
          {sku.name}
        </h1>

        {/* Trust rating row — highlighted amber pill so the stars read as a
            first-class trust signal. Real average once reviews land, brand
            baseline until then. Links down to the reviews section. */}
        <a
          href="#reviews"
          className="group mt-2.5 inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-amber-50 px-3 py-1.5 transition-colors hover:border-amber-400 hover:bg-amber-100"
        >
          <Stars value={ratingValue} size={17} />
          <span className="text-sm font-extrabold tabular-nums text-brand-ink">
            {ratingValue.toFixed(1)}
          </span>
          <span className="h-3.5 w-px bg-amber-300" aria-hidden />
          <span className="text-xs font-semibold text-amber-700 underline-offset-2 group-hover:underline">
            {reviewData.count > 0
              ? `${ratingCount.toLocaleString("en-IN")} verified review${reviewData.count > 1 ? "s" : ""}`
              : `${ratingCount.toLocaleString("en-IN")} ratings`}
          </span>
        </a>

        <p className="text-sm sm:text-lg text-brand-ink-soft mt-2">{sku.tagline}</p>

        {/* Color picker — moved above price so it's visible in the mobile fold
            without scrolling. Most buyers decide colour before re-checking price. */}
        {sku.colors && sku.colors.length > 0 && (
          <div className="mt-3 sm:mt-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-ink-soft">
                Colour
              </span>
              {selectedColor && (
                <span className="text-xs sm:text-sm font-semibold text-brand-ink">
                  {selectedColor.name}
                  {stockLoaded && (selectedStock ?? 0) <= 0 ? (
                    <span className="text-brand-red font-normal"> · Sold out</span>
                  ) : stockLoaded &&
                    (selectedStock ?? 0) <= LOW_STOCK_THRESHOLD ? (
                    <span className="text-brand-red font-normal">
                      {" "}
                      · Only {selectedStock} left
                    </span>
                  ) : null}
                </span>
              )}
            </div>
            <div
              role="radiogroup"
              aria-label="Choose colour"
              className="mt-2 flex flex-wrap gap-2"
            >
              {sku.colors.map((c) => {
                const active = c.slug === selectedColorSlug;
                const cStock = stockOf(c.slug);
                const soldOut = stockLoaded && (cStock ?? 0) <= 0;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    // Always selectable — a sold-out colour can still be
                    // previewed (swap the hero + gallery); only the Buy/Add
                    // buttons stay disabled for it. This keeps colours
                    // browseable even when live stock is 0 (or unavailable).
                    onClick={() => {
                      setSelectedColorSlug(c.slug);
                      setActiveImage(0);
                      // Clamp the chosen qty to the new colour's live stock.
                      setQty((q) =>
                        cStock != null ? Math.min(q, Math.max(1, cStock)) : q,
                      );
                    }}
                    role="radio"
                    aria-checked={active}
                    aria-label={soldOut ? `${c.name} — sold out` : c.name}
                    title={soldOut ? `${c.name} — sold out` : c.name}
                    className={cn(
                      "w-11 h-11 sm:w-10 sm:h-10 rounded-full border-2 transition-colors relative shrink-0 overflow-hidden",
                      active
                        ? "border-brand-ink ring-2 ring-offset-1 ring-brand-red"
                        : "border-brand-line hover:border-brand-ink-soft active:scale-95",
                      soldOut && !active && "opacity-50"
                    )}
                    style={{ background: swatchBg(c.swatch) }}
                  >
                    {soldOut && (
                      // Diagonal strike-through so a sold-out swatch reads as
                      // unavailable even on similar colours.
                      <span
                        aria-hidden
                        className="absolute inset-0 block"
                        style={{
                          background:
                            "linear-gradient(to top right, transparent calc(50% - 1px), rgba(120,120,120,0.9) calc(50% - 1px), rgba(120,120,120,0.9) calc(50% + 1px), transparent calc(50% + 1px))",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}


        {/* Price block - W05 dual price (online / COD) consistent with the
            home SkuLineup. Big number = online price (the "from" anchor);
            sub-line names the COD ceiling so a COD buyer doesn't hit a
            +₹100 surprise at checkout. Grouped in an "offer card" so price,
            EMI and free-ship read as one cohesive deal. */}
        <div className="mt-4 rounded-2xl border border-brand-line bg-gradient-to-b from-white to-brand-cream/50 p-4 sm:p-5 shadow-sm">
          <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
            <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-brand-ink">
              {formatINR(sku.retailINR - 100)}
            </span>
            <span className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-ink-soft">
              online
            </span>
            {savings > 0 ? (
              <>
                <span className="text-base sm:text-lg text-brand-ink-soft line-through">
                  {formatINR(sku.mrpINR)}
                </span>
                <span className="text-xs sm:text-sm font-bold bg-success text-white px-2.5 py-1 rounded-full shadow-sm">
                  Save {formatINR(savings + 100)} · {pct}% off
                </span>
              </>
            ) : (
              // No MRP above the selling price — only the prepaid saving is real.
              <span className="text-xs sm:text-sm font-bold bg-success text-white px-2.5 py-1 rounded-full shadow-sm">
                Save {formatINR(100)} paying online
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-brand-ink-soft mt-1.5">
            or {formatINR(sku.retailINR)} cash on delivery · all taxes included
          </p>

          <EmiBadge priceInr={sku.retailINR - 100} variant="pdp" className="mt-3" />

          {/* X15 - Free-ship progress band. Free-ship threshold is ₹1,099;
              the BMW lands right at it on COD, the F1/Monster clear it,
              the cheaper SKUs sit just under. Visual progress so the
              buyer SEES how close they are to FREE shipping rather than
              reading static "Free over ₹1,099" boilerplate. */}
          {(() => {
            const cartTotalForCheck = sku.retailINR; // single-SKU PDP
            const threshold = 1099;
            const gap = Math.max(0, threshold - cartTotalForCheck);
            const pctReached = Math.min(100, (cartTotalForCheck / threshold) * 100);
            if (gap === 0) {
              return (
                <div className="mt-3 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-success">
                  <Check size={15} strokeWidth={3} className="shrink-0" />
                  Free shipping unlocked
                </div>
              );
            }
            return (
              <div className="mt-3">
                <div className="text-xs sm:text-sm text-brand-ink">
                  Add {formatINR(gap)} more → FREE shipping
                </div>
                <div className="h-1 bg-brand-line rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="h-full bg-brand-red transition-[width] duration-300"
                    style={{ width: `${pctReached}%` }}
                  />
                </div>
              </div>
            );
          })()}
        </div>

        {/* Bullets — check chips read as "included / true", cleaner than a
            wall of identical ⚡ icons. */}
        <ul className="mt-4 grid gap-2 sm:mt-6 sm:gap-2.5">
          {sku.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[13px] text-brand-ink sm:gap-2.5 sm:text-sm">
              <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-brand-red/10 sm:h-5 sm:w-5">
                <Check size={12} strokeWidth={3} className="text-brand-red" />
              </span>
              <span className="leading-snug">{b}</span>
            </li>
          ))}
        </ul>

        {/* X16 - "What's in the box" — substitutes for an in-hand/box-shot
            until we shoot one. Lists the contents the OfferStack value
            stack also names, so the buyer can confirm what arrives without
            scrolling to value-stack. */}
        <div className="mt-3 sm:mt-6 bg-brand-cream rounded-xl border border-brand-line p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-red font-semibold">
            What&apos;s in the box
          </p>
          {/* 2 columns on mobile too — halves the card height */}
          <ul className="mt-1.5 sm:mt-2 grid grid-cols-2 gap-x-3 sm:gap-x-4 gap-y-1 sm:gap-y-1.5 text-[11px] sm:text-sm text-brand-ink">
            {sku.inBox ? (
              sku.inBox.map((item) => <li key={item}>· {item}</li>)
            ) : (
              <>
                <li>· Die-cast {sku.scale} drift car (assembled)</li>
                <li>· 2.4 GHz remote</li>
                <li>· USB-C cable + battery</li>
                <li>· Spare drift wheel set</li>
                <li>· Quick-start guide</li>
                <li>· Premium gift-ready box</li>
              </>
            )}
          </ul>
        </div>

        {/* Qty + CTAs */}
        <div className="mt-3 sm:mt-7 flex items-stretch gap-3">
          <div className="flex items-center border-2 border-brand-line rounded-xl">
            <button
              type="button"
              onClick={() => setQty(Math.max(1, qty - 1))}
              className="w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center text-brand-ink-soft hover:text-brand-ink"
              aria-label="Decrease quantity"
            >
              <Minus size={16} />
            </button>
            <span className="w-8 sm:w-10 text-center font-semibold text-brand-ink">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              disabled={qty >= maxQty}
              className="w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center text-brand-ink-soft hover:text-brand-ink disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Increase quantity"
            >
              <Plus size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={addToCart}
            disabled={outOfStock}
            className="flex-1 bg-white border-2 border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-brand-ink"
          >
            <ShoppingBag size={16} />
            Add to Cart
          </button>
        </div>
        <button
          type="button"
          onClick={buyNow}
          disabled={outOfStock}
          className={cn(
            "mt-3 w-full bg-brand-red hover:bg-brand-red-hover text-white py-3.5 sm:py-4 rounded-xl font-bold text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-red",
            !outOfStock && "animate-heartbeat",
          )}
        >
          {outOfStock ? "Sold out" : `Buy Now · ${formatINR(sku.retailINR * qty)}`}
        </button>

        {/* Reassurance strip at the decision moment — secure pay, genuine
            product, COD. Kills the last "is this legit?" hesitation. */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] sm:text-xs text-brand-ink-soft">
          <span className="inline-flex items-center gap-1.5">
            <Lock size={13} className="text-success" /> 100% secure payment
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck size={13} className="text-success" /> Genuine product
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Truck size={13} className="text-success" /> Pan-India COD
          </span>
        </div>

        {/* Bundle upsell at the decision moment — directly below Buy Now */}
        <PDPBundleUpsell sku={sku} />

        {/* Trust row — icons in soft circles; compact single row on mobile. */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:mt-6 sm:gap-2.5">
          {[
            { icon: Truck, title: "Ships in 24 hrs", sub: "from Bangalore" },
            { icon: RotateCw, title: "7-Day Free", sub: "Replacement" },
            sku.specs.minAge !== undefined
              ? { icon: Shield, title: `Age ${sku.specs.minAge}+`, sub: "Recommended" }
              : { icon: Shield, title: "Pan-India", sub: "Cash on delivery" },
          ].map(({ icon: Icon, title, sub }) => (
            <div
              key={title}
              className="flex flex-col items-center rounded-xl border border-brand-line bg-white p-2 transition-colors hover:border-brand-red/40 sm:p-3"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-red/10 sm:h-9 sm:w-9">
                <Icon className="h-3.5 w-3.5 text-brand-red sm:h-[17px] sm:w-[17px]" />
              </span>
              <p className="mt-1.5 text-[10px] font-semibold text-brand-ink leading-tight sm:mt-2 sm:text-[11px]">
                {title}
              </p>
              <p className="text-[9px] text-brand-ink-soft sm:text-[10px]">{sub}</p>
            </div>
          ))}
        </div>

        {/* Social proof — real order volume + rating as one trust bar. */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl bg-brand-cream border border-brand-line px-4 py-2.5 text-center text-xs">
          <Stars value={ratingValue} size={14} />
          <span className="font-bold text-brand-ink">{ratingValue.toFixed(1)}/5</span>
          <span className="text-brand-ink-soft">·</span>
          <span className="text-brand-ink-soft">
            Trusted by{" "}
            <span className="font-semibold text-brand-ink">
              {TRUST.ordersShipped.toLocaleString("en-IN")}+
            </span>{" "}
            happy buyers across India
          </span>
        </div>

        {/* X16 - Spec table open by default. Reviewer flagged it as
            invisible (the buyer never saw specs without expanding). Now
            visible at first scroll so the "is this a real RC car?" doubt
            is answered by the data. Still collapsible if buyers want to
            close it. */}
        <details
          open
          className="mt-6 border border-brand-line rounded-xl overflow-hidden"
        >
          <summary className="px-5 py-4 font-semibold text-brand-ink cursor-pointer bg-brand-cream">
            Full specs
          </summary>
          <div className="px-5 py-4 text-sm">
            <dl className="grid grid-cols-2 gap-y-2">
              {pdpSpecRows(sku).map((row) => (
                <Fragment key={row.label}>
                  <dt className="text-brand-ink-soft">{row.label}</dt>
                  <dd className="text-brand-ink">{row.value}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        </details>
      </div>
    </div>

    {/* Per-product reviews (ratings summary, verified-buyer photos + submit) */}
    <div className="max-w-3xl mx-auto px-4">
      <PdpReviews
        siteId={siteId}
        skuId={sku.id}
        reviews={reviews}
        data={reviewData}
        fallbackRating={baselineRating}
        fallbackCount={baselineCount}
      />
    </div>

    {/* Recently-viewed strip — full-width below the two-column PDP grid.
        Lives OUTSIDE the grid so the sticky image's stacking context
        cannot overlap these cards. */}
    <RecentlyViewed excludeId={sku.id} />

    {/* Desktop sticky CTA bar — slides in after scroll past Buy Now */}
    <PDPStickyCTA
      sku={sku}
      selectedColorSlug={selectedColorSlug}
      selectedColorName={selectedColor?.name}
      disabled={outOfStock}
    />
    </>
  );
}
