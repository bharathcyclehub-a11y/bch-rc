"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { HUB_CATEGORIES, getHubCategory, type HubCat } from "@/lib/hub-categories";
import { HubProductCard } from "@/components/hub/HubProductCard";

/**
 * Hub — Shop-all catalog. Round category tiles → a 3-model PREVIEW grid of that
 * category, with a CTA that opens the full category page at
 * /hub/shop/[category] (a whole separate section, not an inline expand).
 * Cards add to the SINGLE shared cart (`useCart`) so a buyer can mix scales and
 * check out once via /checkout.
 */

/** Circular category tile — image, or a dashed "image coming" placeholder. */
function TileImage({ c }: { c: HubCat }) {
  if (c.img) {
    return (
      // Tiles render at ~22vw on phones and 96px from sm up — size the request
      // to that, not 150px, so 2x screens get a 256px variant instead of 384px.
      <Image src={c.img} alt={c.label} width={512} height={512} sizes="(min-width: 640px) 96px, 22vw" className="h-full w-full object-cover" />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center rounded-full border-2 border-dashed border-brand-line bg-white p-1 text-center font-mono text-[8px] font-bold uppercase leading-tight tracking-widest text-brand-ink-soft sm:p-4 sm:text-[11px]">
      Coming
      <br />
      soon
    </div>
  );
}

const PREVIEW_COUNT = 3;

/** Random N items (Fisher–Yates). Used to rotate the preview per visit so
 *  every product gets face-time instead of only the first few. */
function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

type ReviewSummary = { count: number; averageRating: number };

export default function HubShop() {
  const [stockMap, setStockMap] = useState<Record<string, number> | null>(null);
  const [salesMap, setSalesMap] = useState<Record<string, number> | null>(null);
  const [reviewsMap, setReviewsMap] = useState<Record<string, ReviewSummary> | null>(null);
  const [active, setActive] = useState(HUB_CATEGORIES[0].key);
  // Rotating preview: first paint is deterministic (SSR-safe = the first 3);
  // after mount we swap in a random 3 per category so a NEW visitor sees a
  // different set each load and, over visits, every model gets shown.
  const [previewByCat, setPreviewByCat] = useState<Record<string, HubCat["skus"]>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stock")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.stock === "object") setStockMap(d.stock);
      })
      .catch(() => {});
    // Real 30-day units sold — drives "Selling fast", "N sold this month" and
    // the earned BESTSELLER badge. Independent of stock: a failure here costs
    // social proof, not the ability to buy.
    fetch("/api/sales")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.sales === "object") setSalesMap(d.sales);
      })
      .catch(() => {});
    // Approved-review summaries. Absent SKUs render no star row at all.
    fetch("/api/reviews/summary")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.reviews === "object") setReviewsMap(d.reviews);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map: Record<string, HubCat["skus"]> = {};
    for (const c of HUB_CATEGORIES) {
      if (c.skus.length) map[c.key] = sample(c.skus, PREVIEW_COUNT);
    }
    setPreviewByCat(map);
  }, []);

  const cat = getHubCategory(active) ?? HUB_CATEGORIES[0];
  const preview = previewByCat[cat.key] ?? cat.skus.slice(0, PREVIEW_COUNT);

  return (
    <section aria-labelledby="hub-shop" className="bg-brand-cream py-8 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-4 text-center sm:mb-8">
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand-red">Shop all</span>
          <h2 id="hub-shop" className="mt-2 font-display text-3xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-4xl">
            Pick your <span className="text-brand-red">ride</span>
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-soft sm:text-base">
            Every model, one cart — mix scales and check out once.
          </p>
        </div>

        {/* category tiles — round image tiles (like the old Categories), scroll
            on mobile / grid on desktop. Click one to switch the preview below. */}
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-4 sm:gap-x-4 sm:gap-y-6 sm:overflow-visible sm:px-0 lg:grid-cols-8">
          {HUB_CATEGORIES.map((c) => {
            const isActive = active === c.key;
            const soon = c.skus.length === 0;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setActive(c.key)}
                aria-pressed={isActive}
                className="group flex w-[22%] flex-none shrink-0 snap-start cursor-pointer flex-col items-center text-center sm:w-auto"
              >
                <span
                  className={cn(
                    "relative block aspect-square w-full overflow-hidden rounded-full bg-white ring-2 transition-all duration-300 group-hover:scale-105 sm:w-24",
                    isActive ? "ring-brand-red" : "ring-brand-line"
                  )}
                >
                  <TileImage c={c} />
                </span>
                <span
                  className={cn(
                    "mt-2 max-w-[6rem] text-[11px] font-semibold leading-tight transition-colors sm:text-xs",
                    isActive ? "text-brand-red" : "text-brand-ink group-hover:text-brand-red"
                  )}
                >
                  {c.label}
                </span>
                {/* Only show the "soon" label when the tile has a PHOTO but no
                    products yet (e.g. Drone). Image-less tiles already say
                    "Coming soon" inside the circle, so we skip it to avoid
                    repeating the word. */}
                {soon && c.img && (
                  <span className="font-mono text-[8px] font-bold uppercase tracking-widest text-brand-ink-soft">soon</span>
                )}
              </button>
            );
          })}
        </div>

        {/* PREVIEW grid — 3 models max; the CTA opens the full category page. */}
        {cat.skus.length > 0 ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {preview.map((sku, i) => (
                <HubProductCard
                  key={sku.id}
                  sku={sku}
                  stockMap={stockMap}
                  salesMap={salesMap}
                  reviewsMap={reviewsMap}
                  // mobile preview shows 2 (clean 2-col row); the 3rd is desktop-only
                  className={i >= 2 ? "hidden sm:flex" : undefined}
                />
              ))}
              {/* Desktop: CTA in the next free column, beside the preview cards.
                  Always shown — the full category page exists even when the
                  preview already fits every model. */}
              <div className="hidden items-center justify-center lg:flex">
                <Link
                  href={`/hub/shop/${cat.key}`}
                  className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-red px-7 py-3.5 text-base font-semibold text-white shadow-md animate-heartbeat"
                >
                  View Virtual Store
                  <ArrowRight size={18} aria-hidden />
                </Link>
              </div>
            </div>
            {/* Mobile/tablet (below lg): CTA below the grid — always shown. */}
            <div className="mt-4 flex justify-center sm:mt-8 sm:justify-end lg:hidden">
              <Link
                href={`/hub/shop/${cat.key}`}
                className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-red px-7 py-3.5 text-base font-semibold text-white shadow-md animate-heartbeat"
              >
                View Virtual Store
                <ArrowRight size={18} aria-hidden />
              </Link>
            </div>
          </>
        ) : (
          <div className="mt-8 grid place-items-center rounded-3xl border-2 border-dashed border-brand-line bg-white/50 py-16 text-center">
            <p className="font-display text-xl font-extrabold text-brand-ink">Coming soon</p>
            <p className="mt-1 max-w-sm text-sm text-brand-ink-soft">
              {cat.label} models are dropping soon — spin the wheel or message us on WhatsApp to get first dibs.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
