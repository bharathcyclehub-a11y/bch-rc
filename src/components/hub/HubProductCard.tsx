"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShoppingBag,
  Check,
  Flame,
  Bell,
  ArrowRightLeft,
  Scale as ScaleIcon,
} from "lucide-react";
import { PRODUCTS, type Sku } from "@/lib/products";
import { formatINR, calcDiscountPct, cn } from "@/lib/utils";
import { useCart } from "@/lib/cart-store";
import { ProductImage } from "@/components/ProductImage";
import { Stars } from "@/components/Stars";
import { EmiBadge } from "@/components/EmiBadge";
import { RestockNotifyModal } from "@/components/RestockNotifyModal";
import { THEME } from "@/lib/theme";
import {
  resolveVariantAvailability,
  resolveProductAvailability,
  findComparableAlternatives,
  applyOverride,
  type ProductOverride,
} from "@/lib/availability";
import { useLiveStock } from "@/lib/use-live-stock";
import { trackAddToCart, trackInitiateCheckout } from "@/lib/analytics-client";
import { trackFunnel } from "@/lib/funnel-client";

/** Swatch token (hex or `gradient:from,to[,...]`) → CSS background. */
export function swatchBg(swatch: string): string {
  if (swatch.startsWith("gradient:")) {
    return `linear-gradient(135deg, ${swatch.slice("gradient:".length)})`;
  }
  return swatch;
}

const EDITORIAL_BADGES = new Set<NonNullable<Sku["badge"]>>(["NEW", "PRO"]);
const SELLING_FAST_UNITS = 10;

function topSellerId(salesMap: Record<string, number> | null): string | null {
  if (!salesMap) return null;
  let best: string | null = null;
  let bestUnits = SELLING_FAST_UNITS - 1;
  for (const [id, units] of Object.entries(salesMap)) {
    if (units > bestUnits) {
      best = id;
      bestUnits = units;
    }
  }
  return best;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function driftChip(raw: string): { label: string; drifts: boolean } | null {
  const [headRaw = "", tailRaw = ""] = raw.split("—").map((s) => s.trim());
  const head = headRaw.toLowerCase();
  const tail = tailRaw.toLowerCase();

  if (!head || head === "n/a" || head === "none") return null;

  if (head.startsWith("no")) {
    return tail ? { label: sentenceCase(tailRaw), drifts: false } : null;
  }

  if (head.startsWith("yes")) {
    if (tail.includes("pro")) return { label: "Pro drift", drifts: true };
    if (tail.includes("fpv")) return { label: "FPV drift", drifts: true };
    return { label: "Drift", drifts: true };
  }

  if (head.includes("esp")) return { label: "ESP drift", drifts: true };
  if (head.includes("pro drift")) return { label: "Pro drift", drifts: true };
  return { label: sentenceCase(headRaw), drifts: false };
}

function kindChip(sku: Sku): string {
  if (sku.category === "construction") return "RC WORK";
  const drift = driftChip(sku.specs.drift ?? "");
  if (drift?.drifts) return "RC DRIFT";
  const label = drift?.label.toLowerCase() ?? "";
  if (label.includes("off-road") || label.includes("all-terrain")) return "RC OFF-ROAD";
  return "RC";
}

export function HubProductCard({
  sku: rawSku,
  stockMap: propStockMap,
  salesMap = null,
  reviewsMap = null,
  override: propOverride,
  overrideMap: propOverrideMap,
  overridesMap: propOverridesMap,
  isCompared = false,
  onToggleCompare,
  className,
}: {
  sku: Sku;
  stockMap: Record<string, number> | null;
  salesMap?: Record<string, number> | null;
  reviewsMap?: Record<string, { count: number; averageRating: number }> | null;
  override?: Partial<ProductOverride>;
  overrideMap?: Record<string, ProductOverride>;
  overridesMap?: Record<string, ProductOverride>;
  isCompared?: boolean;
  onToggleCompare?: (skuId: string) => void;
  className?: string;
}) {
  const router = useRouter();
  const { stockMap: hookStockMap, overrideMap: hookOverrideMap } =
    useLiveStock(propStockMap);

  const stockMap = propStockMap ?? hookStockMap;
  const overrides = propOverrideMap ?? propOverridesMap ?? hookOverrideMap;
  const ov = (propOverride as ProductOverride | undefined) ?? overrides?.[rawSku.id];
  const sku = applyOverride(rawSku, ov);

  const [hovered, setHovered] = useState(false);
  const [slug, setSlug] = useState<string | null>(sku.colors?.[0]?.slug ?? null);
  const [notifyOpen, setNotifyOpen] = useState(false);

  const online = sku.retailINR - THEME.prepaidDiscountINR;
  const hasMrp = sku.mrpINR > sku.retailINR;
  const saveINR = sku.mrpINR - online;
  const offPct = calcDiscountPct(sku.mrpINR, online);

  // Authoritative availability for the whole product & the currently selected colour
  const productAvail = resolveProductAvailability(sku, stockMap, ov);
  const selectedAvail = resolveVariantAvailability(sku, slug, stockMap, ov);

  const comingSoon = productAvail.status === "COMING_SOON";
  const discontinued = productAvail.status === "DISCONTINUED";
  const isPreorder = selectedAvail.status === "PREORDER";
  const stockKnown = selectedAvail.stockKnown;
  const productSoldOut =
    stockKnown && !comingSoon && !discontinued && !productAvail.purchasable;
  const selectedSoldOut =
    stockKnown && !comingSoon && !discontinued && !selectedAvail.purchasable;
  const lowStock = selectedAvail.status === "LOW_STOCK";

  const unitsSold = salesMap?.[sku.id];
  const sellingFast =
    !comingSoon &&
    !discontinued &&
    selectedAvail.purchasable &&
    (unitsSold ?? 0) >= SELLING_FAST_UNITS;
  const isBestSeller =
    !comingSoon &&
    !discontinued &&
    productAvail.purchasable &&
    topSellerId(salesMap) === sku.id;

  const review = reviewsMap?.[sku.id];
  const selectedColor = sku.colors?.find((c) => c.slug === slug) ?? null;
  const title = sku.cardTitle ?? sku.name;

  // Keep cards navigable for SEO and customers arriving through old links
  const pdpHref = `/product/${sku.slug}${slug ? `?color=${encodeURIComponent(slug)}` : ""}`;

  // If the initial default colour is sold out once live stock loads, jump to first in-stock colour
  const [autoSelectedInitial, setAutoSelectedInitial] = useState(false);
  useEffect(() => {
    if (!stockMap || !sku.colors?.length || autoSelectedInitial) return;
    setAutoSelectedInitial(true);
    if ((stockMap[`${sku.id}:${slug ?? ""}`] ?? 0) > 0) return;
    if (productAvail.firstInStockVariantSlug) {
      setSlug(productAvail.firstInStockVariantSlug);
    }
  }, [stockMap, sku.colors, sku.id, slug, productAvail.firstInStockVariantSlug, autoSelectedInitial]);

  const alternatives =
    productSoldOut || selectedSoldOut || discontinued
      ? findComparableAlternatives(sku, PRODUCTS, stockMap, overrides, 2)
      : [];

  const inStockAlternateColor =
    selectedSoldOut &&
    !productSoldOut &&
    productAvail.firstInStockVariantSlug
      ? sku.colors?.find((c) => c.slug === productAvail.firstInStockVariantSlug)
      : undefined;

  const add = (goToCheckout: boolean) => {
    // Hard gate: never allow adding unknown or non-purchasable stock
    if (!selectedAvail.purchasable || selectedAvail.availableQty <= 0) return;
    useCart.getState().add(sku.id, slug, 1, selectedAvail.maxOrderQty);
    trackAddToCart({
      sku: sku.id,
      name: sku.name,
      priceInr: sku.retailINR,
      quantity: 1,
    });
    trackFunnel("add_to_cart", {
      skuId: sku.id,
      variantSlug: slug ?? "",
      qty: 1,
      valueInr: sku.retailINR,
      via: goToCheckout ? "hub_buynow" : "hub",
    });
    if (goToCheckout) {
      trackInitiateCheckout(online);
      router.push("/checkout");
    }
  };

  const cornerBadge = isBestSeller
    ? "BESTSELLER"
    : sku.badge && EDITORIAL_BADGES.has(sku.badge)
      ? sku.badge
      : null;

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "group flex flex-col overflow-hidden rounded-2xl border border-brand-line bg-white shadow-sm transition-shadow hover:shadow-md",
          className,
        )}
      >
        <div className="relative aspect-square overflow-hidden">
          <Link
            href={pdpHref}
            aria-label={`View ${title}`}
            className={cn(
              "relative block h-full w-full overflow-hidden",
              (productSoldOut || discontinued) &&
                "opacity-65 grayscale-[25%] transition-opacity group-hover:opacity-85",
            )}
          >
            <ProductImage
              sku={sku}
              active={hovered && !productSoldOut && !discontinued}
              src={selectedColor?.image ?? undefined}
            />
          </Link>

          {/* Left rail: kind chip + editorial badge */}
          <span className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1 sm:left-3 sm:top-3">
            <span className="rounded-full bg-brand-ink/85 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-white backdrop-blur-sm sm:text-[9px]">
              {kindChip(sku)}
            </span>
            {cornerBadge && !productSoldOut && !discontinued && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md sm:text-[10px]",
                  isBestSeller ? "bg-brand-ink" : "bg-brand-red",
                )}
              >
                {cornerBadge}
              </span>
            )}
          </span>

          {/* Right rail: authoritative inventory status badge */}
          {discontinued ? (
            <span
              role="status"
              className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-neutral-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white sm:right-3 sm:top-3"
            >
              Discontinued
            </span>
          ) : comingSoon ? (
            <span
              role="status"
              className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-brand-ink px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white sm:right-3 sm:top-3"
            >
              Coming soon
            </span>
          ) : isPreorder ? (
            <span
              role="status"
              className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-indigo-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white sm:right-3 sm:top-3"
            >
              Pre-order
            </span>
          ) : productSoldOut || selectedSoldOut ? (
            <span
              role="status"
              className="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-brand-red px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm sm:right-3 sm:top-3"
            >
              SOLD OUT
            </span>
          ) : lowStock ? (
            <span
              role="status"
              className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-900 shadow-sm sm:right-3 sm:top-3 sm:text-[10px]"
            >
              Only {selectedAvail.availableQty} left
            </span>
          ) : sellingFast ? (
            <span className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-brand-ink/90 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white shadow-sm sm:right-3 sm:top-3 sm:text-[10px]">
              <Flame size={10} aria-hidden />
              Popular
            </span>
          ) : null}

          {/* Optional Compare toggle button in bottom-right of image */}
          {onToggleCompare && !comingSoon && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleCompare(sku.id);
              }}
              aria-pressed={isCompared}
              aria-label={
                isCompared
                  ? `Remove ${sku.name} from comparison`
                  : `Compare ${sku.name} specs`
              }
              className={cn(
                "absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-sm backdrop-blur-sm transition-colors",
                isCompared
                  ? "bg-brand-ink text-white"
                  : "bg-white/90 text-brand-ink hover:bg-white border border-brand-line",
              )}
            >
              <ScaleIcon size={11} aria-hidden />
              {isCompared ? "Comparing" : "Compare"}
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-2.5 sm:gap-2 sm:p-4">
          <Link
            href={pdpHref}
            className="line-clamp-2 min-h-[2.4em] font-display text-[13px] font-bold leading-snug text-brand-ink transition-colors hover:text-brand-red sm:text-base"
          >
            {title}
          </Link>

          {review && review.count > 0 && (
            <Link
              href={`/product/${sku.slug}#reviews`}
              className="flex w-fit items-center gap-1 transition-opacity hover:opacity-75"
              aria-label={`${review.averageRating} out of 5 from ${review.count} review${review.count === 1 ? "" : "s"}`}
            >
              <Stars value={review.averageRating} size={11} />
              <span className="text-[10px] font-bold text-brand-ink">
                {review.averageRating.toFixed(1)}
              </span>
              <span className="text-[10px] text-brand-ink-soft">
                ({review.count})
              </span>
            </Link>
          )}

          {sku.colors && sku.colors.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] leading-none text-brand-ink-soft">
                Colour:{" "}
                <span className="font-semibold text-brand-ink">
                  {selectedColor?.name ?? "—"}
                </span>
                {stockKnown && (
                  <span className="text-brand-ink-soft">
                    {" "}
                    ·{" "}
                    {selectedSoldOut ? (
                      <span className="text-brand-red font-semibold">
                        Sold out
                      </span>
                    ) : (
                      `${productAvail.inStockVariantCount} of ${productAvail.totalVariantCount} in stock`
                    )}
                  </span>
                )}
              </span>
              <div className="flex flex-wrap items-center gap-2.5">
                {sku.colors.map((c) => {
                  const v = productAvail.variants[c.slug];
                  const out = stockKnown && (!v || !v.purchasable);
                  const isSel = slug === c.slug;
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => {
                        setSlug(c.slug);
                        trackFunnel("colour_change", {
                          skuId: sku.id,
                          variantSlug: c.slug,
                          status: v?.status ?? "UNKNOWN",
                        });
                      }}
                      title={
                        out
                          ? `${c.name} — sold out (click to get restock alert)`
                          : v?.status === "LOW_STOCK"
                            ? `${c.name} — only ${v.availableQty} left`
                            : c.name
                      }
                      aria-label={
                        out
                          ? `${c.name}, sold out`
                          : v?.status === "LOW_STOCK"
                            ? `${c.name}, only ${v.availableQty} left`
                            : c.name
                      }
                      aria-pressed={isSel}
                      className={cn(
                        "relative grid h-6 w-6 shrink-0 place-items-center rounded-full border shadow-sm transition-transform overflow-hidden",
                        "after:absolute after:-inset-1.5 after:content-['']",
                        "hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2",
                        isSel
                          ? "ring-2 ring-brand-red ring-offset-2"
                          : "border-brand-line",
                        out && "opacity-40",
                      )}
                      style={{ background: swatchBg(c.swatch) }}
                    >
                      {isSel && !out && (
                        <Check
                          size={12}
                          strokeWidth={4}
                          aria-hidden
                          className="text-white [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.9))]"
                        />
                      )}
                      {out && (
                        <span
                          aria-hidden
                          className="pointer-events-none block h-[1.5px] w-6 rotate-45 bg-white shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {discontinued ? (
            <div className="mt-auto flex flex-col gap-2 pt-2">
              <div className="text-xs font-medium text-brand-ink-soft">
                No longer manufactured.
              </div>
              {alternatives[0] ? (
                <Link
                  href={`/product/${alternatives[0].slug}`}
                  onClick={() =>
                    trackFunnel("alternative_click", {
                      skuId: sku.id,
                      targetSkuId: alternatives[0].id,
                      placement: "card_discontinued",
                    })
                  }
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-brand-ink px-3 text-[12px] font-bold text-white hover:bg-brand-ink/90 transition-colors"
                >
                  <ArrowRightLeft size={13} aria-hidden />
                  See Replacement: {alternatives[0].name}
                </Link>
              ) : (
                <Link
                  href={pdpHref}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-brand-line px-3 text-[12px] font-semibold text-brand-ink-soft"
                >
                  View Archive Specs
                </Link>
              )}
            </div>
          ) : comingSoon ? (
            <>
              <div className="-mt-0.5">
                <span className="font-display text-base font-bold text-brand-ink sm:text-lg">
                  Coming soon
                </span>
                <div className="mt-0.5 font-mono text-[10px] text-brand-ink-soft">
                  Dropping shortly — get alerted first
                </div>
              </div>
              <div className="mt-auto pt-1 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setNotifyOpen(true)}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full border border-brand-ink/20 bg-white hover:bg-brand-cream px-3 text-[13px] font-semibold text-brand-ink transition-colors sm:text-sm"
                >
                  <Bell size={14} aria-hidden />
                  Notify Me on Launch
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="-mt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xl font-extrabold leading-none tracking-tight text-brand-ink sm:text-2xl">
                    {formatINR(online)}
                  </span>
                  {hasMrp && offPct > 0 && (
                    <span className="shrink-0 rounded-md bg-brand-red px-1.5 py-0.5 text-[10px] font-extrabold uppercase leading-none tracking-wide text-white">
                      {offPct}% off
                    </span>
                  )}
                </div>
                {hasMrp && (
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-tight">
                    <span className="text-[11px] text-brand-ink-soft sm:text-xs">
                      MRP{" "}
                      <span className="font-semibold text-brand-ink line-through decoration-brand-red/70 decoration-2">
                        {formatINR(sku.mrpINR)}
                      </span>
                    </span>
                    {saveINR > 0 && (
                      <span className="text-[11px] font-bold text-brand-red sm:text-xs">
                        Save {formatINR(saveINR)}
                      </span>
                    )}
                  </div>
                )}
                <EmiBadge priceInr={online} variant="card" className="mt-1" />
              </div>

              <div className="mt-auto flex flex-col gap-1.5 pt-1.5 sm:gap-2">
                {unitsSold !== undefined && !productSoldOut && !selectedSoldOut && (
                  <p className="inline-flex items-center gap-1 rounded-md bg-brand-red-soft px-1.5 py-1 text-[10px] font-semibold leading-none text-brand-red">
                    <Flame size={11} aria-hidden />
                    {unitsSold} sold this month
                  </p>
                )}

                {!stockKnown ? (
                  <>
                    <Link
                      href={pdpHref}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-brand-red px-3 text-[13px] font-bold text-white shadow-sm transition-all hover:bg-brand-red-hover sm:px-4 sm:text-sm"
                    >
                      See Car in Action
                    </Link>
                    <button
                      type="button"
                      disabled
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-brand-line bg-brand-cream/60 px-3 text-[13px] font-semibold text-brand-ink-soft disabled:opacity-60 sm:px-4 sm:text-sm"
                    >
                      Checking stock…
                    </button>
                  </>
                ) : selectedSoldOut ? (
                  <>
                    {inStockAlternateColor ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSlug(inStockAlternateColor.slug);
                          trackFunnel("colour_change", {
                            skuId: sku.id,
                            variantSlug: inStockAlternateColor.slug,
                            status: "IN_STOCK",
                          });
                        }}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-brand-ink px-3 text-[12px] font-bold text-white shadow-sm hover:bg-brand-ink/90 transition-colors sm:px-4 sm:text-sm"
                      >
                        <ArrowRightLeft size={13} aria-hidden />
                        Switch to {inStockAlternateColor.name}
                      </button>
                    ) : alternatives[0] ? (
                      <Link
                        href={`/product/${alternatives[0].slug}`}
                        onClick={() =>
                          trackFunnel("alternative_click", {
                            skuId: sku.id,
                            targetSkuId: alternatives[0].id,
                            placement: "card_sold_out",
                          })
                        }
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-brand-ink px-3 text-[12px] font-bold text-white shadow-sm hover:bg-brand-ink/90 transition-colors sm:px-4 sm:text-sm"
                      >
                        View Similar In Stock
                      </Link>
                    ) : (
                      <Link
                        href={pdpHref}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-brand-line bg-white px-3 text-[12px] font-semibold text-brand-ink hover:bg-brand-cream transition-colors sm:px-4 sm:text-sm"
                      >
                        View Details
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setNotifyOpen(true)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-brand-red/30 bg-brand-red-soft/50 px-3 text-[12px] font-semibold text-brand-red hover:bg-brand-red-soft transition-colors sm:px-4 sm:text-sm"
                    >
                      <Bell size={13} aria-hidden />
                      Notify Me
                      {selectedColor ? ` (${selectedColor.name})` : ""}
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href={pdpHref}
                      aria-label={`See ${title} in action`}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-brand-red px-3 text-[13px] font-bold text-white shadow-sm transition-all hover:bg-brand-red-hover hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 active:scale-[0.98] sm:px-4 sm:text-sm"
                    >
                      See Car in Action
                    </Link>
                    <button
                      type="button"
                      disabled={!selectedAvail.purchasable}
                      onClick={() => add(false)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-brand-ink/15 bg-white px-3 text-[13px] font-semibold text-brand-ink transition-all hover:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 sm:px-4 sm:text-sm"
                    >
                      <ShoppingBag size={14} aria-hidden />
                      {isPreorder ? "Pre-order" : "Add to cart"}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <RestockNotifyModal
        open={notifyOpen}
        sku={sku}
        variantSlug={slug}
        alternatives={alternatives}
        onClose={() => setNotifyOpen(false)}
      />
    </>
  );
}

export default HubProductCard;
