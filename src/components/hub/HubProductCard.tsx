"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingBag, Check, Flame } from "lucide-react";
import { type Sku } from "@/lib/products";
import { formatINR, calcDiscountPct, cn } from "@/lib/utils";
import { useCart } from "@/lib/cart-store";
import { ProductImage } from "@/components/ProductImage";
import { Stars } from "@/components/Stars";
import { EmiBadge } from "@/components/EmiBadge";
import { THEME } from "@/lib/theme";
import { trackAddToCart, trackInitiateCheckout } from "@/lib/analytics-client";
import { trackFunnel } from "@/lib/funnel-client";

/** Swatch token (hex or `gradient:from,to[,...]`) → CSS background. */
export function swatchBg(swatch: string): string {
  if (swatch.startsWith("gradient:")) {
    return `linear-gradient(135deg, ${swatch.slice("gradient:".length)})`;
  }
  return swatch;
}

/**
 * Urgency threshold. Deliberately tight: at the time of writing exactly one
 * live variant sits at or below it, so "Only N left" stays a rare, credible
 * signal rather than permanent wallpaper the eye learns to skip.
 */
const LOW_STOCK_AT = 5;

/**
 * Editorial badges we're willing to print on a card.
 *
 * "BESTSELLER" is deliberately absent: it's now EARNED from the orders table
 * (see `topSellerId`), not hand-set in products.ts — where it currently sits on
 * the slowest-moving SKU of the live five. "MOST GIFTED" stays out too; nothing
 * we store can substantiate it. NEW/PRO are product facts, and both ship today.
 */
const EDITORIAL_BADGES = new Set<NonNullable<Sku["badge"]>>(["NEW", "PRO"]);

/** Units/30d at which a SKU is genuinely moving. Mirrors lib/sales.ts. */
const SELLING_FAST_UNITS = 10;

/**
 * The single highest-selling SKU in the map, or null when nothing clears the
 * "selling fast" bar. `salesMap` already excludes the slow tail server-side, so
 * an argmax here can't crown a product that sold three units.
 */
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

/** "off-road grip" → "Off-road grip". Only touches the first letter. */
function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * `specs.drift` → one short chip.
 *
 * The catalogue writes this as `"<verdict> — <descriptor>"` ("Yes — pro drift
 * wheels", "No — farm grip") or as a bare descriptor ("ESP-assisted",
 * "Off-road grip"). Split on the dash and read the verdict; a naive substring
 * match prints garbage like "No — farm grip" straight onto the card.
 *
 * `drifts` is what the kind-chip keys off, so a grip-tyre tractor never gets
 * labelled a drift car.
 */
function driftChip(raw: string): { label: string; drifts: boolean } | null {
  const [headRaw = "", tailRaw = ""] = raw.split("—").map((s) => s.trim());
  const head = headRaw.toLowerCase();
  const tail = tailRaw.toLowerCase();

  if (!head || head === "n/a" || head === "none") return null;

  // "No — off-road grip": doesn't drift, but the grip IS the selling point.
  if (head.startsWith("no")) {
    return tail ? { label: sentenceCase(tailRaw), drifts: false } : null;
  }

  if (head.startsWith("yes")) {
    if (tail.includes("pro")) return { label: "Pro drift", drifts: true };
    if (tail.includes("fpv")) return { label: "FPV drift", drifts: true };
    return { label: "Drift", drifts: true };
  }

  // Bare descriptors.
  if (head.includes("esp")) return { label: "ESP drift", drifts: true };
  if (head.includes("pro drift")) return { label: "Pro drift", drifts: true };
  return { label: sentenceCase(headRaw), drifts: false };
}

/** Image chip: what kind of RC this is, derived from `specs` — never asserted. */
function kindChip(sku: Sku): string {
  if (sku.category === "construction") return "RC WORK";
  const drift = driftChip(sku.specs.drift ?? "");
  if (drift?.drifts) return "RC DRIFT";
  const label = drift?.label.toLowerCase() ?? "";
  if (label.includes("off-road") || label.includes("all-terrain")) return "RC OFF-ROAD";
  return "RC";
}

/**
 * Shoppable product card for the hub Shop grid + the per-category pages. Adds to
 * the SINGLE shared cart (`useCart`). Coming-soon SKUs render a price-less
 * "Coming soon" state with no buy buttons.
 *
 * Every persuasion element on this card is backed by data we hold: features and
 * the kind-chip come from `specs`, urgency from the live `stockMap`, savings
 * from `mrpINR`. There are no ratings here on purpose — the reviews table is
 * empty, so stars would be fabricated.
 */
export function HubProductCard({
  sku,
  stockMap,
  salesMap = null,
  reviewsMap = null,
  className,
}: {
  sku: Sku;
  stockMap: Record<string, number> | null;
  /** skuId → units sold in 30d, from /api/sales. Slow SKUs are absent. */
  salesMap?: Record<string, number> | null;
  /** skuId → approved-review summary, from /api/reviews/summary. Unreviewed
   *  SKUs are absent, and their cards show no star row. Never synthesised. */
  reviewsMap?: Record<string, { count: number; averageRating: number }> | null;
  className?: string;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const [slug, setSlug] = useState<string | null>(sku.colors?.[0]?.slug ?? null);

  const online = sku.retailINR - THEME.prepaidDiscountINR;
  /**
   * Savings and the % badge are BOTH derived from the pair we actually print
   * (MRP → online). The old card computed the % off `retailINR` while
   * headlining `online`, so it rendered "Save ₹1,000" beside "31% off" — two
   * true numbers that call each other liars. Same helper, same basis, no
   * change to what anyone is charged.
   */
  const hasMrp = sku.mrpINR > sku.retailINR;
  const saveINR = sku.mrpINR - online;
  const offPct = calcDiscountPct(sku.mrpINR, online);

  const variantKeys = sku.colors?.length
    ? sku.colors.map((c) => `${sku.id}:${c.slug}`)
    : [`${sku.id}:`];
  const comingSoon = sku.comingSoon ?? false;
  const soldOut = !comingSoon && stockMap !== null && variantKeys.every((k) => (stockMap[k] ?? 0) <= 0);

  // Urgency reads the SELECTED variant — "Only 2 left" must mean the colour the
  // buyer is looking at, not some other colour that happens to be scarce.
  const selectedStock = stockMap?.[`${sku.id}:${slug ?? ""}`];
  const lowStock =
    !comingSoon && !soldOut && selectedStock !== undefined && selectedStock > 0 && selectedStock <= LOW_STOCK_AT;

  // Real sales, straight from the orders table. `unitsSold` is undefined for
  // any SKU under the server-side floor, so every branch below is a genuine
  // "this thing is actually moving" claim.
  const unitsSold = salesMap?.[sku.id];
  const sellingFast = !comingSoon && !soldOut && (unitsSold ?? 0) >= SELLING_FAST_UNITS;
  const isBestSeller = !comingSoon && !soldOut && topSellerId(salesMap) === sku.id;

  // Absent = this SKU has no approved reviews. The row simply doesn't render.
  const review = reviewsMap?.[sku.id];

  const selectedColor = sku.colors?.find((c) => c.slug === slug) ?? null;
  const title = sku.cardTitle ?? sku.name;

  // PDP link — every live product uses the shared /product/[slug] page (the
  // 64-style PDP, scale-agnostic). The hub is the only storefront now, so we
  // don't route to the old /16 store. Coming-soon SKUs aren't clickable.
  const pdpHref = comingSoon ? null : `/product/${sku.slug}`;

  // If the picked colour sells out once live stock loads, jump to first in-stock.
  useEffect(() => {
    if (!stockMap || !sku.colors?.length) return;
    if ((stockMap[`${sku.id}:${slug ?? ""}`] ?? 0) > 0) return;
    const firstIn = sku.colors.find((c) => (stockMap[`${sku.id}:${c.slug}`] ?? 0) > 0);
    if (firstIn) setSlug(firstIn.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockMap]);

  const add = (goToCheckout: boolean) => {
    if (soldOut) return;
    useCart.getState().add(sku.id, slug);
    trackAddToCart({ sku: sku.id, name: sku.name, priceInr: sku.retailINR, quantity: 1 });
    trackFunnel("add_to_cart", {
      skuId: sku.id,
      qty: 1,
      valueInr: sku.retailINR,
      via: goToCheckout ? "hub_buynow" : "hub",
    });
    if (goToCheckout) {
      trackInitiateCheckout(online);
      router.push("/checkout");
    }
  };

  // An earned rank outranks a hand-set one.
  const cornerBadge = isBestSeller
    ? "BESTSELLER"
    : sku.badge && EDITORIAL_BADGES.has(sku.badge)
      ? sku.badge
      : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-brand-line bg-white shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      {(() => {
        const overlay = (
          <>
            <ProductImage sku={sku} active={hovered} />

            {/* Left rail: what it IS (derived), then the rank badge. */}
            <span className="absolute left-2 top-2 z-10 flex flex-col items-start gap-1 sm:left-3 sm:top-3">
              <span className="rounded-full bg-brand-ink/85 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-white backdrop-blur-sm sm:text-[9px]">
                {kindChip(sku)}
              </span>
              {cornerBadge && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md sm:text-[10px]",
                    isBestSeller ? "bg-brand-ink" : "bg-brand-red"
                  )}
                >
                  {cornerBadge}
                </span>
              )}
            </span>

            {/* Right rail: ONE state, most urgent wins. Scarcity beats velocity —
                "Only 2 left" is a harder deadline than "Selling fast". */}
            {comingSoon ? (
              <span className="absolute right-2 top-2 z-10 rounded-full bg-brand-ink px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white sm:right-3 sm:top-3">
                Coming soon
              </span>
            ) : soldOut ? (
              <span className="absolute right-2 top-2 z-10 rounded-full bg-brand-ink px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white sm:right-3 sm:top-3">
                Sold out
              </span>
            ) : lowStock ? (
              <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-brand-red px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white shadow-md sm:right-3 sm:top-3 sm:text-[10px]">
                <Flame size={10} aria-hidden />
                Only {selectedStock} left
              </span>
            ) : sellingFast ? (
              <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-brand-red px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white shadow-md sm:right-3 sm:top-3 sm:text-[10px]">
                <Flame size={10} aria-hidden />
                Selling fast
              </span>
            ) : null}
          </>
        );
        return pdpHref ? (
          <Link href={pdpHref} aria-label={`View ${title}`} className="relative block aspect-square overflow-hidden">
            {overlay}
          </Link>
        ) : (
          <div className="relative aspect-square overflow-hidden">{overlay}</div>
        );
      })()}

      <div className="flex flex-1 flex-col gap-1.5 p-2.5 sm:gap-2 sm:p-4">
        {/* Two-line clamp with reserved height: without it a one-line title
            lifts the price row and nothing lines up across a grid row. */}
        {pdpHref ? (
          <Link
            href={pdpHref}
            className="line-clamp-2 min-h-[2.4em] font-display text-[13px] font-bold leading-snug text-brand-ink transition-colors hover:text-brand-red sm:text-base"
          >
            {title}
          </Link>
        ) : (
          <h3 className="line-clamp-2 min-h-[2.4em] font-display text-[13px] font-bold leading-snug text-brand-ink sm:text-base">
            {title}
          </h3>
        )}

        {/* Star row — only for SKUs with APPROVED reviews. No reviews, no row.
            Deep-links to the PDP's #reviews section, so the proof is one tap
            from the claim. */}
        {review && review.count > 0 && pdpHref && (
          <Link
            href={`${pdpHref}#reviews`}
            className="flex w-fit items-center gap-1 transition-opacity hover:opacity-75"
            aria-label={`${review.averageRating} out of 5 from ${review.count} review${review.count === 1 ? "" : "s"}`}
          >
            <Stars value={review.averageRating} size={11} />
            <span className="text-[10px] font-bold text-brand-ink">{review.averageRating.toFixed(1)}</span>
            <span className="text-[10px] text-brand-ink-soft">
              ({review.count})
            </span>
          </Link>
        )}

        {sku.colors && sku.colors.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {/* Label + selected name on ONE line. Three stacked lines of colour
                chrome pushed the price below the fold on a 375px card. */}
            <span className="text-[10px] leading-none text-brand-ink-soft">
              Colour: <span className="font-semibold text-brand-ink">{selectedColor?.name ?? "—"}</span>
              <span className="text-brand-ink-soft"> · {sku.colors.length} available</span>
            </span>
            <div className="flex flex-wrap items-center gap-2.5">
              {sku.colors.map((c) => {
                const out = (stockMap?.[`${sku.id}:${c.slug}`] ?? 1) <= 0;
                const isSel = slug === c.slug;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => setSlug(c.slug)}
                    title={out ? `${c.name} — sold out` : c.name}
                    aria-label={out ? `${c.name}, sold out` : c.name}
                    aria-pressed={isSel}
                    className={cn(
                      // Visual dot stays small so 5 colours fit a 375px 2-col
                      // card; `after` grows the TOUCH target well past the dot.
                      "relative grid h-6 w-6 shrink-0 place-items-center rounded-full border shadow-sm transition-transform",
                      "after:absolute after:-inset-1.5 after:content-['']",
                      "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2",
                      isSel ? "ring-2 ring-brand-red ring-offset-2" : "border-brand-line",
                      out && "opacity-35"
                    )}
                    style={{ background: swatchBg(c.swatch) }}
                  >
                    {isSel && (
                      <Check
                        size={12}
                        strokeWidth={4}
                        aria-hidden
                        className="text-white [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.9))]"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {comingSoon ? (
          <>
            <div className="-mt-0.5">
              <span className="font-display text-base font-bold text-brand-ink sm:text-lg">Coming soon</span>
              <div className="mt-0.5 font-mono text-[10px] text-brand-ink-soft">Dropping shortly — price TBA</div>
            </div>
            <div className="mt-auto pt-1">
              <span className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full border border-brand-line bg-brand-cream px-3 text-[13px] font-semibold text-brand-ink-soft sm:text-sm">
                Coming soon
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Price. One hero number, the % badge beside it, then the anchor:
                a struck MRP heavy enough to actually register, since the whole
                savings story is read against it. */}
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
              {/* No MRP above the selling price → no struck anchor to show. */}
              {hasMrp && (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-tight">
                  <span className="text-[11px] text-brand-ink-soft sm:text-xs">
                    MRP{" "}
                    <span className="font-semibold text-brand-ink line-through decoration-brand-red/70 decoration-2">
                      {formatINR(sku.mrpINR)}
                    </span>
                  </span>
                  {saveINR > 0 && (
                    <span className="text-[11px] font-bold text-brand-red sm:text-xs">Save {formatINR(saveINR)}</span>
                  )}
                </div>
              )}
              <EmiBadge priceInr={online} variant="card" className="mt-1" />
            </div>

            <div className="mt-auto flex flex-col gap-1.5 pt-1.5 sm:gap-2">
              {/* Real social proof. `unitsSold` only exists for SKUs the orders
                  table shows actually moving — no rating, no invented count. */}
              {unitsSold !== undefined && !soldOut && (
                <p className="inline-flex items-center gap-1 rounded-md bg-brand-red-soft px-1.5 py-1 text-[10px] font-semibold leading-none text-brand-red">
                  <Flame size={11} aria-hidden />
                  {unitsSold} sold this month
                </p>
              )}

              {/* Primary CTA drives to the PDP (was a hidden Buy-Now that
                  jumped straight to checkout with one item — duplicating "Add
                  to cart" and fighting the mix-and-bundle model). Sending it to
                  the product page gives undecided buyers the detail/gallery and
                  makes product_view fire, while "Add to cart" stays the buy
                  action. Still reachable when sold-out — viewing is always valid. */}
              <Link
                href={`/product/${sku.slug}`}
                aria-label={`See ${title} in action`}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-brand-red px-3 text-[13px] font-bold text-white shadow-sm transition-all hover:bg-brand-red-hover hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 active:scale-[0.98] sm:px-4 sm:text-sm"
              >
                See Car in Action
              </Link>
              <button
                type="button"
                disabled={soldOut}
                onClick={() => add(false)}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-brand-ink/15 bg-white px-3 text-[13px] font-semibold text-brand-ink transition-all hover:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 sm:px-4 sm:text-sm"
              >
                <ShoppingBag size={14} aria-hidden />
                Add to cart
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
