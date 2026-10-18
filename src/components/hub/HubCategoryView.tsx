"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getHubCategory, HUB_CATEGORIES } from "@/lib/hub-categories";
import { HubProductCard } from "@/components/hub/HubProductCard";
import ConstructionBundleBanner from "@/components/hub/ConstructionBundleBanner";
import { useLiveStock } from "@/lib/use-live-stock";
import {
  getSkuUseCases,
  ProductAvailability,
  resolveProductAvailability,
  sortSkusByAvailability,
  UseCaseTag,
} from "@/lib/availability";
import { ALL_SKUS } from "@/lib/products";
import { cn } from "@/lib/utils";

type ReviewSummary = { count: number; averageRating: number };

const USE_CASE_FILTERS: { key: "all" | UseCaseTag; label: string }[] = [
  { key: "all", label: "All Models" },
  { key: "drifting", label: "Drifting" },
  { key: "off-road", label: "Off-Road & Climb" },
  { key: "gifting", label: "Best for Gifting" },
  { key: "beginner", label: "Beginner Friendly" },
];

export default function HubCategoryView({ categoryKey }: { categoryKey: string }) {
  const { stockMap, overridesMap } = useLiveStock();
  const [salesMap, setSalesMap] = useState<Record<string, number> | null>(null);
  const [reviewsMap, setReviewsMap] = useState<Record<string, ReviewSummary> | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [useCaseFilter, setUseCaseFilter] = useState<"all" | UseCaseTag>("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sales")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && typeof d.sales === "object") setSalesMap(d.sales);
      })
      .catch(() => {});
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

  const cat = getHubCategory(categoryKey) ?? HUB_CATEGORIES[0];

  const availMap = useMemo(() => {
    const map: Record<string, ProductAvailability> = {};
    for (const s of ALL_SKUS) {
      map[s.id] = resolveProductAvailability(s, stockMap, overridesMap?.[s.id]);
    }
    return map;
  }, [stockMap, overridesMap]);

  const sortedSkus = useMemo(() => {
    let list = sortSkusByAvailability(cat.skus, stockMap, overridesMap);
    if (useCaseFilter !== "all") {
      list = list.filter((s) => getSkuUseCases(s).includes(useCaseFilter));
    }
    if (inStockOnly && stockMap) {
      list = list.filter((s) => availMap[s.id]?.purchasable);
    }
    return list;
  }, [cat.skus, stockMap, overridesMap, useCaseFilter, inStockOnly, availMap]);

  const inStockCount = useMemo(() => {
    if (!stockMap) return null;
    return cat.skus.filter((s) => availMap[s.id]?.purchasable).length;
  }, [cat.skus, stockMap, availMap]);

  return (
    <section className="bg-brand-cream pt-3 pb-8 sm:pt-5 sm:pb-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-brand-ink-soft transition-colors hover:text-brand-red"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to shop
        </Link>

        <div className="mt-1.5 sm:mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.3em] text-brand-red sm:inline-block">
              Shop
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 sm:mt-1">
              <h1 className="font-display text-2xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-4xl">
                {cat.label}
              </h1>
              <p className="text-xs text-brand-ink-soft sm:text-sm">
                {cat.skus.length} models
                {inStockCount !== null ? ` · ${inStockCount} ready to ship` : ""}
              </p>
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-brand-ink ring-1 ring-brand-line select-none">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-emerald-600"
            />
            In Stock Only
          </label>
        </div>

        {/* Use-case filter pills */}
        <div className="mt-3 no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1">
          {USE_CASE_FILTERS.map((f) => {
            const selected = useCaseFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setUseCaseFilter(f.key)}
                aria-pressed={selected}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold transition cursor-pointer",
                  selected
                    ? "bg-brand-ink text-white shadow-sm"
                    : "bg-white text-brand-ink-soft ring-1 ring-brand-line hover:text-brand-ink",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Construction 3-Pack CTA banner */}
        {categoryKey === "construction" && (
          <div className="mt-3 sm:mt-6">
            <ConstructionBundleBanner />
          </div>
        )}

        {/* full product grid — sorted with in-stock products first */}
        {sortedSkus.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {sortedSkus.map((sku) => (
              <HubProductCard
                key={sku.id}
                sku={sku}
                stockMap={stockMap}
                overridesMap={overridesMap}
                salesMap={salesMap}
                reviewsMap={reviewsMap}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-brand-line bg-white p-8 text-center">
            <p className="font-display text-lg font-bold text-brand-ink">
              No models match your current filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setInStockOnly(false);
                setUseCaseFilter("all");
              }}
              className="mt-3 rounded-full bg-brand-ink px-4 py-2 text-xs font-bold text-white hover:bg-brand-red transition cursor-pointer"
            >
              Show All Models
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
