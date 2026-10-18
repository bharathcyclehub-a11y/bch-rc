"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HUB_CATEGORIES, type HubCategory } from "@/lib/hub-categories";
import { HubProductCard } from "@/components/hub/HubProductCard";
import { cn } from "@/lib/utils";

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
  const [reviewsMap, setReviewsMap] = useState<Record<string, ReviewSummary> | null>(
    null,
  );
  const [active, setActive] = useState(HUB_CATEGORIES[0].key);
  const [previewByCat, setPreviewByCat] = useState<Record<string, HubCategory["skus"]>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stock")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.stock === "object") setStockMap(d.stock);
      })
      .catch(() => {});

    // Real 30-day units sold — drives "Selling fast", "N sold this month" and
    // the earned BESTSELLER badge.
    fetch("/api/sales")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.sales === "object") setSalesMap(d.sales);
      })
      .catch(() => {});

    // Approved-review summaries.
    fetch("/api/reviews/summary")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.reviews === "object")
          setReviewsMap(d.reviews);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map: Record<string, HubCategory["skus"]> = {};
    for (const c of HUB_CATEGORIES) {
      if (c.skus.length) map[c.key] = sample(c.skus, PREVIEW_COUNT);
    }
    setPreviewByCat(map);
  }, []);

  const cat = HUB_CATEGORIES.find((c) => c.key === active) ?? HUB_CATEGORIES[0];
  const preview = previewByCat[cat.key] ?? cat.skus.slice(0, PREVIEW_COUNT);

  return (
    <section
      id="hub-shop"
      aria-label="Shop by Category"
      className="border-b border-brand-line/60 bg-brand-cream py-6 sm:py-10"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Category Selector: 4 compact circular categories */}
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-4 gap-2 sm:gap-6">
            {HUB_CATEGORIES.map((c) => {
              const isActive = active === c.key;
              return (
                <div
                  key={c.key}
                  className="flex flex-col items-center text-center"
                >
                  {/* Category Circle Link: crawlable link + instant preview switcher on click */}
                  <Link
                    href={c.url}
                    onClick={(e) => {
                      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                        e.preventDefault();
                        setActive(c.key);
                      }
                    }}
                    aria-label={`Show ${c.label} products`}
                    className="group flex flex-col items-center text-center cursor-pointer focus:outline-none"
                  >
                    <span
                      className={cn(
                        "relative block aspect-square w-16 overflow-hidden rounded-full bg-white ring-2 transition-all duration-200 group-hover:scale-105 sm:w-24",
                        isActive
                          ? "ring-brand-red shadow-sm"
                          : "ring-brand-line group-hover:ring-brand-red/60",
                      )}
                    >
                      <Image
                        src={c.image}
                        alt={c.imageAlt}
                        width={256}
                        height={256}
                        sizes="(min-width: 640px) 96px, 64px"
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span
                      className={cn(
                        "mt-2 flex min-h-[1.75rem] max-w-[6.5rem] items-center justify-center text-[11px] font-semibold leading-tight transition-colors sm:min-h-0 sm:max-w-none sm:text-xs",
                        isActive
                          ? "font-bold text-brand-red"
                          : "text-brand-ink group-hover:text-brand-red",
                      )}
                    >
                      {c.label}
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        {/* Product Showcase: Original production product cards immediately underneath the categories */}
        {cat.skus.length > 0 ? (
          <div className="mt-6 sm:mt-8">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {preview.map((sku, i) => (
                <HubProductCard
                  key={sku.id}
                  sku={sku}
                  stockMap={stockMap}
                  salesMap={salesMap}
                  reviewsMap={reviewsMap}
                  className={i >= 2 ? "hidden sm:flex" : undefined}
                />
              ))}

              {/* Desktop 4th column: View Virtual Store CTA button alongside the 3 cards */}
              <div className="hidden items-center justify-center lg:flex">
                <Link
                  href={cat.url}
                  className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-red px-7 py-3.5 text-base font-semibold text-white shadow-md animate-heartbeat hover:bg-brand-red-hover transition-colors"
                >
                  View Virtual Store
                  <ArrowRight size={18} aria-hidden />
                </Link>
              </div>
            </div>

            {/* Mobile / Tablet CTA button below the grid */}
            <div className="mt-4 flex justify-center sm:mt-6 lg:hidden">
              <Link
                href={cat.url}
                className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-red px-7 py-3.5 text-base font-semibold text-white shadow-md animate-heartbeat hover:bg-brand-red-hover transition-colors"
              >
                View Virtual Store
                <ArrowRight size={18} aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid place-items-center rounded-3xl border-2 border-dashed border-brand-line bg-white/50 py-12 text-center">
            <p className="font-display text-lg font-extrabold text-brand-ink">
              Coming soon
            </p>
            <p className="mt-1 max-w-sm text-xs text-brand-ink-soft sm:text-sm">
              {cat.label} models are dropping soon.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
