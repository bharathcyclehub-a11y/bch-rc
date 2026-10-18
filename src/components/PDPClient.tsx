"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
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
  Play,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { ALL_SKUS, pdpSpecRows, type Sku } from "@/lib/products";
import { formatINR, calcDiscountPct, cn } from "@/lib/utils";
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
import { useLiveStock } from "@/lib/use-live-stock";
import {
  findComparableAlternatives,
  resolveProductAvailability,
  resolveVariantAvailability,
} from "@/lib/availability";
import { RestockNotifyForm } from "@/components/RestockNotifyModal";

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

function getApprovedActionVideo(sku: Sku): { src: string; caption: string; isExactModel: boolean } {
  if (sku.heroVideo) {
    return {
      src: sku.heroVideo,
      caption: `${sku.name} — Real Action Footage`,
      isExactModel: true,
    };
  }
  if (sku.scale === "1:64") {
    return {
      src: "/ugc/164prccars-00.mp4",
      caption: "Pocket RC 1:64 Scale — Real Tabletop Drift & Action Clip",
      isExactModel: false,
    };
  }
  return {
    src: "/hero/drift-mobile.mp4",
    caption: "Pocket RC Performance Lineup — Real Action Demo",
    isExactModel: false,
  };
}

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
  initialStockMap = null,
}: {
  sku: Sku;
  siteId: string;
  reviews: PdpReviewItem[];
  reviewData: PdpReviewData;
  initialStockMap?: Record<string, number> | null;
}) {
  const baselineRating = baselineRatingFor(sku.id);
  const baselineCount = baselineCountFor(sku.id);
  const ratingValue =
    reviewData.count > 0 ? reviewData.averageRating : baselineRating;
  const ratingCount = reviewData.count > 0 ? reviewData.count : baselineCount;
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [selectedColorSlug, setSelectedColorSlug] = useState<string | null>(
    sku.colors?.[0]?.slug ?? null,
  );
  const [videoPlaying, setVideoPlaying] = useState(false);
  const unavailablePanelRef = useRef<HTMLDivElement>(null);

  const { stockMap, overridesMap } = useLiveStock(initialStockMap);
  const override = overridesMap?.[sku.id];
  const stockLoaded = stockMap !== null;

  const productAvail = useMemo(
    () => resolveProductAvailability(sku, stockMap, override),
    [sku, stockMap, override],
  );

  const selectedAvail = useMemo(
    () => resolveVariantAvailability(sku, selectedColorSlug, stockMap, override),
    [sku, selectedColorSlug, stockMap, override],
  );

  // Auto-select first available colour once live stock loads if the initial colour is sold out
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (!stockMap || didAutoSelectRef.current) return;
    didAutoSelectRef.current = true;
    if (sku.colors && sku.colors.length > 0) {
      const currentVarAvail = resolveVariantAvailability(sku, selectedColorSlug, stockMap, override);
      if (!currentVarAvail.purchasable && productAvail.firstAvailableVariantSlug) {
        setSelectedColorSlug(productAvail.firstAvailableVariantSlug);
        setActiveImage(0);
      }
    }
  }, [stockMap, sku, selectedColorSlug, override, productAvail.firstAvailableVariantSlug]);

  const selectedColor =
    sku.colors?.find((c) => c.slug === selectedColorSlug) ?? null;

  // Authoritative purchasability & quantity cap for BOTH colour and colourless SKUs
  const canPurchase = stockLoaded && selectedAvail.purchasable;
  const outOfStock = stockLoaded && !selectedAvail.purchasable;
  const maxQty = stockLoaded ? Math.max(1, selectedAvail.maxOrderQty) : 1;

  // Keep quantity clamped within available stock
  useEffect(() => {
    if (stockLoaded && selectedAvail.maxOrderQty > 0 && qty > selectedAvail.maxOrderQty) {
      setQty(selectedAvail.maxOrderQty);
    }
  }, [stockLoaded, selectedAvail.maxOrderQty, qty]);

  // Track sold_out_view when a user views an unavailable product/variant
  useEffect(() => {
    if (!stockLoaded) return;
    if (!selectedAvail.purchasable) {
      trackFunnel("sold_out_view", {
        skuId: sku.id,
        variantSlug: selectedColorSlug,
        status: selectedAvail.status,
      });
    }
  }, [stockLoaded, selectedAvail.purchasable, selectedAvail.status, sku.id, selectedColorSlug]);

  const alternatives = useMemo(() => {
    if (!stockMap) return [];
    return findComparableAlternatives(sku, ALL_SKUS, stockMap, overridesMap, 3);
  }, [sku, stockMap, overridesMap]);

  // Consistent pricing presentation: onlinePrice vs COD retailINR vs MRP
  const onlinePrice = Math.max(0, sku.retailINR - 100);
  const onlineSavings = Math.max(0, sku.mrpINR - onlinePrice);
  const onlinePct = calcDiscountPct(sku.mrpINR, onlinePrice);

  const heroSrc = selectedColor?.image ?? sku.heroImage;
  const colorAlts = selectedColor?.altImages ?? [];
  const gallery = sku.colors?.length
    ? [heroSrc, ...colorAlts].filter(Boolean)
    : [heroSrc, ...(sku.altImages ?? [])].filter(Boolean);
  const activeSrc = gallery[activeImage] ?? heroSrc;

  const actionVideo = useMemo(() => getApprovedActionVideo(sku), [sku]);

  function addToCart() {
    if (!canPurchase) return;
    const finalQty = Math.min(qty, selectedAvail.maxOrderQty);
    useCart.getState().add(sku.id, selectedColorSlug, finalQty, selectedAvail.maxOrderQty);
    trackAddToCart({
      sku: sku.id,
      name: sku.name,
      priceInr: sku.retailINR,
      quantity: finalQty,
    });
    trackFunnel("add_to_cart", {
      skuId: sku.id,
      variantSlug: selectedColorSlug,
      qty: finalQty,
      valueInr: sku.retailINR * finalQty,
      via: "pdp",
    });
  }

  function buyNow() {
    if (!canPurchase) return;
    const finalQty = Math.min(qty, selectedAvail.maxOrderQty);
    useCart.getState().add(sku.id, selectedColorSlug, finalQty, selectedAvail.maxOrderQty);
    trackAddToCart({
      sku: sku.id,
      name: sku.name,
      priceInr: sku.retailINR,
      quantity: finalQty,
    });
    trackFunnel("add_to_cart", {
      skuId: sku.id,
      variantSlug: selectedColorSlug,
      qty: finalQty,
      valueInr: sku.retailINR * finalQty,
      via: "pdp_buynow",
    });
    trackInitiateCheckout(sku.retailINR * finalQty);
    router.push("/checkout");
  }

  useEffect(() => {
    recordView(sku.id);
    trackFunnel("product_view", {
      skuId: sku.id,
      name: sku.name,
      priceInr: sku.retailINR,
    });
  }, [sku.id, sku.name, sku.retailINR]);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-12 max-w-6xl mx-auto px-4 py-4 sm:py-8">
        {/* Image gallery + Click-to-play Action Video */}
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto no-scrollbar">
          <div className="aspect-square rounded-2xl overflow-hidden border border-brand-line bg-brand-cream relative">
            <GalleryImage src={activeSrc} sku={sku} alt={sku.name} priority />
            {stockLoaded && !selectedAvail.purchasable && (
              <span className="absolute top-3 left-3 z-10 rounded-md bg-red-600 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-white shadow">
                {selectedAvail.badgeText ?? selectedAvail.label}
              </span>
            )}
            {stockLoaded && selectedAvail.status === "LOW_STOCK" && (
              <span className="absolute top-3 left-3 z-10 rounded-md bg-amber-500 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-zinc-950 shadow">
                {selectedAvail.label}
              </span>
            )}
          </div>

          {gallery.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {gallery.slice(0, 4).map((src, i) => (
                <button
                  key={src + i}
                  type="button"
                  onClick={() => setActiveImage(i)}
                  className={cn(
                    "aspect-square rounded-lg overflow-hidden border-2 transition-all relative bg-white cursor-pointer",
                    activeImage === i
                      ? "border-brand-red"
                      : "border-brand-line hover:border-brand-ink-soft",
                  )}
                  aria-label={`View image ${i + 1}`}
                >
                  <GalleryImage
                    src={src}
                    sku={sku}
                    alt={`${sku.name} view ${i + 1}`}
                    sizes="(min-width: 1024px) 140px, 25vw"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Lightweight click-to-play real RC action video section (Phase 4 & 7) */}
          <div className="rounded-2xl border border-brand-line bg-zinc-950 text-white overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/10 text-xs">
              <span className="font-bold text-white/90 flex items-center gap-1.5">
                <Play size={12} className="text-brand-red fill-brand-red" />
                {actionVideo.caption}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-white/50">
                {actionVideo.isExactModel ? "Exact Model Clip" : "Scale Demo"}
              </span>
            </div>
            {!videoPlaying ? (
              <button
                type="button"
                onClick={() => setVideoPlaying(true)}
                className="group relative flex w-full aspect-video items-center justify-center bg-zinc-900 overflow-hidden cursor-pointer"
                aria-label={`Play action video: ${actionVideo.caption}`}
              >
                <Image
                  src={heroSrc}
                  alt={actionVideo.caption}
                  fill
                  sizes="(min-width: 1024px) 540px, 100vw"
                  className="object-contain opacity-65 transition-transform duration-300 group-hover:scale-105"
                />
                <div className="relative z-10 flex flex-col items-center gap-2">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-red text-white shadow-xl transition-transform group-hover:scale-110">
                    <Play size={24} className="fill-white ml-0.5" />
                  </span>
                  <span className="rounded-full bg-black/75 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
                    Tap to Watch Real RC Action
                  </span>
                </div>
              </button>
            ) : (
              <video
                src={actionVideo.src}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className="w-full aspect-video bg-black object-contain"
              />
            )}
          </div>
        </div>

        {/* Info column */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2 sm:mb-3">
            {sku.badge && (
              <span className="inline-block bg-brand-red text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
                {sku.badge}
              </span>
            )}
            {/* Prominent live availability badge beside title/kicker */}
            <span
              role="status"
              aria-live="polite"
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
                !stockLoaded
                  ? "bg-zinc-100 text-zinc-600"
                  : selectedAvail.status === "IN_STOCK"
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : selectedAvail.status === "LOW_STOCK"
                      ? "bg-amber-100 text-amber-900 border border-amber-300"
                      : selectedAvail.status === "PREORDER"
                        ? "bg-blue-100 text-blue-800 border border-blue-300"
                        : selectedAvail.status === "COMING_SOON"
                          ? "bg-zinc-200 text-zinc-800"
                          : "bg-red-100 text-red-800 border border-red-300",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  !stockLoaded
                    ? "bg-zinc-400"
                    : selectedAvail.status === "IN_STOCK"
                      ? "bg-emerald-600"
                      : selectedAvail.status === "LOW_STOCK"
                        ? "bg-amber-600"
                        : selectedAvail.status === "PREORDER"
                          ? "bg-blue-600"
                          : "bg-red-600",
                )}
              />
              {!stockLoaded ? "Checking stock…" : selectedAvail.label}
            </span>
            <span className="text-[11px] font-mono text-brand-ink-soft">
              SKU: {sku.id}
              {selectedColorSlug ? `-${selectedColorSlug}` : ""}
            </span>
          </div>

          <p className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-red">
            {sku.scale} {sku.kind ?? "die-cast RC"} · {sku.bodyShape.replace(/^1:\d+\s+/i, "")}
          </p>
          <h1 className="text-2xl sm:text-4xl font-bold text-brand-ink mt-0.5 leading-tight text-balance">
            {sku.name}
            {selectedColor ? ` — ${selectedColor.name}` : ""}
          </h1>

          {/* Trust rating row */}
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

          {/* Mixed-colour note for SKUs without colour picker */}
          {!sku.colors?.length && sku.colourNote && (
            <div className="mt-3 sm:mt-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-ink-soft">
                  Colour
                </span>
                <span className="text-xs sm:text-sm font-semibold text-brand-ink">Mixed colour</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-brand-ink-soft sm:text-xs">
                {sku.colourNote}
              </p>
            </div>
          )}

          {/* Inventory-aware colour picker */}
          {sku.colors && sku.colors.length > 0 && (
            <div className="mt-3 sm:mt-5">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-ink-soft">
                  Colour
                </span>
                {selectedColor && (
                  <span className="text-xs sm:text-sm font-semibold text-brand-ink">
                    {selectedColor.name}
                    {stockLoaded && !selectedAvail.purchasable ? (
                      <span className="text-brand-red font-bold">
                        {" "}
                        · {selectedAvail.label}
                      </span>
                    ) : stockLoaded && selectedAvail.status === "LOW_STOCK" ? (
                      <span className="text-amber-700 font-bold">
                        {" "}
                        · {selectedAvail.label}
                      </span>
                    ) : stockLoaded && selectedAvail.purchasable ? (
                      <span className="text-emerald-700 font-semibold">
                        {" "}
                        · In Stock
                      </span>
                    ) : null}
                  </span>
                )}
              </div>
              <div
                role="radiogroup"
                aria-label="Choose colour"
                className="mt-2 flex flex-wrap gap-2.5"
              >
                {sku.colors.map((c) => {
                  const active = c.slug === selectedColorSlug;
                  const cAvail = resolveVariantAvailability(sku, c.slug, stockMap, override);
                  const soldOut = stockLoaded && !cAvail.purchasable;
                  const lowStock = stockLoaded && cAvail.status === "LOW_STOCK";
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => {
                        setSelectedColorSlug(c.slug);
                        setActiveImage(0);
                        if (stockLoaded && cAvail.maxOrderQty > 0) {
                          setQty((q) => Math.min(q, cAvail.maxOrderQty));
                        }
                        trackFunnel("colour_change", {
                          skuId: sku.id,
                          variantSlug: c.slug,
                          status: cAvail.status,
                        });
                      }}
                      role="radio"
                      aria-checked={active}
                      aria-label={`${c.name} — ${stockLoaded ? cAvail.label : "Checking stock"}`}
                      title={`${c.name} (${stockLoaded ? cAvail.label : "Checking stock"})`}
                      className={cn(
                        "w-11 h-11 sm:w-10 sm:h-10 rounded-full border-2 transition-all relative shrink-0 overflow-hidden cursor-pointer",
                        active
                          ? "border-brand-ink ring-2 ring-offset-2 ring-brand-red"
                          : "border-brand-line hover:border-brand-ink-soft active:scale-95",
                        soldOut && !active && "opacity-45",
                      )}
                      style={{ background: swatchBg(c.swatch) }}
                    >
                      {soldOut && (
                        <span
                          aria-hidden
                          className="absolute inset-0 block"
                          style={{
                            background:
                              "linear-gradient(to top right, transparent calc(50% - 1.5px), rgba(220,38,38,0.9) calc(50% - 1.5px), rgba(220,38,38,0.9) calc(50% + 1.5px), transparent calc(50% + 1.5px))",
                          }}
                        />
                      )}
                      {lowStock && !soldOut && (
                        <span
                          aria-hidden
                          className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-1 ring-black/40"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* If selected colour is OOS but other colours are available, surface 1-click switchers */}
              {stockLoaded &&
                !selectedAvail.purchasable &&
                productAvail.availableVariants.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    <span className="font-bold">Available right now in:</span>
                    {productAvail.availableVariants.map((v) => (
                      <button
                        key={v.variantSlug}
                        type="button"
                        onClick={() => {
                          setSelectedColorSlug(v.variantSlug);
                          setActiveImage(0);
                        }}
                        className="rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-2.5 py-0.5 font-extrabold text-amber-950 transition cursor-pointer"
                      >
                        {v.variantName} ({v.label}) →
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* Price & Shipping Offer Block — consistent Online vs COD pricing */}
          <div className="mt-4 rounded-2xl border border-brand-line bg-gradient-to-b from-white to-brand-cream/50 p-4 sm:p-5 shadow-sm">
            <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
              <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-brand-ink">
                {formatINR(onlinePrice)}
              </span>
              <span className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-ink-soft">
                online (UPI / Card)
              </span>
              {onlineSavings > 0 ? (
                <>
                  <span className="text-base sm:text-lg text-brand-ink-soft line-through">
                    {formatINR(sku.mrpINR)}
                  </span>
                  <span className="text-xs sm:text-sm font-bold bg-success text-white px-2.5 py-1 rounded-full shadow-sm">
                    Save {formatINR(onlineSavings)} · {onlinePct}% off
                  </span>
                </>
              ) : (
                <span className="text-xs sm:text-sm font-bold bg-success text-white px-2.5 py-1 rounded-full shadow-sm">
                  Save {formatINR(100)} paying online
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-brand-ink-soft mt-1.5">
              or <strong className="text-brand-ink">{formatINR(sku.retailINR)}</strong> Cash on Delivery · all taxes included
            </p>

            {/* Dynamic variant-aware shipping & stock status */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              {!stockLoaded ? (
                <span className="text-brand-ink-soft">Verifying Bangalore warehouse inventory…</span>
              ) : selectedAvail.purchasable ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                  <Truck size={14} className="shrink-0" />
                  {selectedAvail.status === "PREORDER"
                    ? "Pre-order open — dispatches as soon as batch arrives"
                    : "In stock at Bangalore warehouse — dispatches within 24 hrs"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                  <AlertCircle size={14} className="shrink-0" />
                  {selectedAvail.status === "DISCONTINUED"
                    ? "This model has been retired and is no longer restocked."
                    : selectedAvail.status === "COMING_SOON"
                      ? "Dropping soon — register below for first-batch restock alert."
                      : "Currently out of stock — get notified below or pick an in-stock alternative."}
                </span>
              )}
            </div>

            <EmiBadge priceInr={onlinePrice} variant="pdp" className="mt-3" />

            {(() => {
              const cartTotalForCheck = sku.retailINR;
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

          {/* Purchase Controls OR Sold-Out / Coming-Soon / Discontinued Recovery Panel */}
          <div ref={unavailablePanelRef} className="mt-4 sm:mt-6">
            {!stockLoaded ? (
              <button
                type="button"
                disabled
                className="w-full rounded-xl bg-zinc-200 py-4 text-sm font-bold text-zinc-600 cursor-wait"
              >
                Checking live stock…
              </button>
            ) : canPurchase ? (
              <>
                <div className="flex items-stretch gap-3">
                  <div className="flex items-center border-2 border-brand-line rounded-xl">
                    <button
                      type="button"
                      onClick={() => setQty(Math.max(1, qty - 1))}
                      disabled={qty <= 1}
                      className="w-11 h-11 flex items-center justify-center text-brand-ink-soft hover:text-brand-ink disabled:opacity-40 cursor-pointer"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="w-9 sm:w-10 text-center font-semibold text-brand-ink tabular-nums">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                      disabled={qty >= maxQty}
                      className="w-11 h-11 flex items-center justify-center text-brand-ink-soft hover:text-brand-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      aria-label="Increase quantity"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={addToCart}
                    className="flex-1 bg-white border-2 border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShoppingBag size={16} />
                    Add to Cart
                  </button>
                </div>

                {selectedAvail.availableQty !== null &&
                  selectedAvail.availableQty <= 5 &&
                  qty >= maxQty && (
                    <p className="mt-1.5 text-xs font-semibold text-amber-800">
                      Maximum available stock selected ({maxQty} {maxQty === 1 ? "unit" : "units"} in warehouse).
                    </p>
                  )}

                <button
                  type="button"
                  onClick={buyNow}
                  className="mt-3 w-full bg-brand-red hover:bg-brand-red-hover text-white py-3.5 sm:py-4 rounded-xl font-bold text-base transition-colors animate-heartbeat cursor-pointer"
                >
                  Buy Now · {formatINR(onlinePrice * qty)} Online{" "}
                  <span className="text-xs font-normal opacity-90">
                    ({formatINR(sku.retailINR * qty)} COD)
                  </span>
                </button>
              </>
            ) : (
              <div className="space-y-4">
                {/* Disabled purchase button clearly indicating status */}
                <button
                  type="button"
                  disabled
                  className="w-full rounded-xl bg-zinc-200 border border-zinc-300 text-zinc-600 py-3.5 font-extrabold text-sm uppercase tracking-wider cursor-not-allowed"
                >
                  {selectedAvail.label} — Currently Unavailable
                </button>

                {/* Inline Back-in-Stock Notification Form (for OUT_OF_STOCK & COMING_SOON) */}
                {selectedAvail.status !== "DISCONTINUED" && (
                  <RestockNotifyForm
                    sku={sku}
                    variantSlug={selectedColorSlug}
                    variantName={selectedColor?.name}
                    inline
                  />
                )}

                {/* Comparable In-Stock Alternatives */}
                {alternatives.length > 0 && (
                  <div className="rounded-2xl border border-brand-line bg-brand-cream/60 p-4">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-brand-ink mb-2.5">
                      <Sparkles size={14} className="text-brand-red" />
                      In-Stock Alternatives Ready to Ship Today
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {alternatives.map((alt) => {
                        const altOnline = Math.max(0, alt.retailINR - 100);
                        return (
                          <Link
                            key={alt.id}
                            href={`/product/${alt.slug}`}
                            onClick={() =>
                              trackFunnel("alternative_click", {
                                skuId: sku.id,
                                targetSkuId: alt.id,
                                via: "pdp_alternatives",
                              })
                            }
                            className="flex sm:flex-col items-center sm:items-start gap-2.5 rounded-xl border border-brand-line bg-white p-2.5 hover:border-brand-red transition group"
                          >
                            <div className="relative h-14 w-14 sm:h-24 sm:w-full rounded-lg bg-brand-cream overflow-hidden shrink-0">
                              <Image
                                src={alt.heroImage}
                                alt={alt.name}
                                fill
                                sizes="140px"
                                className="object-contain p-1 group-hover:scale-105 transition-transform"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-mono uppercase text-brand-red">
                                {alt.scale}
                              </div>
                              <div className="text-xs font-bold text-brand-ink group-hover:text-brand-red line-clamp-1">
                                {alt.cardTitle ?? alt.name}
                              </div>
                              <div className="mt-0.5 text-xs font-extrabold text-emerald-700">
                                {formatINR(altOnline)} online →
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reassurance strip */}
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

          {/* Bullets */}
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

          {/* What's in the box */}
          <div className="mt-3 sm:mt-6 bg-brand-cream rounded-xl border border-brand-line p-3 sm:p-5">
            <p className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-red font-semibold">
              What&apos;s in the box
            </p>
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

          {/* Bundle upsell — only shown when current SKU and companion are in stock */}
          <PDPBundleUpsell sku={sku} selectedColorSlug={selectedColorSlug} />

          {/* Trust row */}
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

          {/* Social proof */}
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

          {/* Full specs */}
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

      {/* Per-product reviews */}
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

      {/* Recently-viewed strip */}
      <RecentlyViewed excludeId={sku.id} />

      {/* Mobile + Desktop sticky CTA bar — obeys exact same inventory state */}
      <PDPStickyCTA
        sku={sku}
        selectedColorSlug={selectedColorSlug}
        selectedColorName={selectedColor?.name}
        selectedColorImage={selectedColor?.image}
        disabled={!canPurchase}
        status={selectedAvail.status}
        statusLabel={!stockLoaded ? "Checking stock…" : selectedAvail.label}
        maxOrderQty={selectedAvail.maxOrderQty}
        onUnavailableAction={() => {
          unavailablePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      />
    </>
  );
}
