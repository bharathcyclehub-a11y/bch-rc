"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { type Sku } from "@/lib/products";
import {
  PRIMARY_CATEGORIES,
  getProductClassification,
  type PrimaryCategorySlug,
} from "@/lib/categories";
import {
  type ProductAvailability,
  resolveProductAvailability,
  sortSkusByAvailability,
} from "@/lib/availability";
import { useLiveStock } from "@/lib/use-live-stock";
import { HubProductCard } from "@/components/hub/HubProductCard";
import ConstructionBundleBanner from "@/components/hub/ConstructionBundleBanner";

type SortKey = "featured" | "price-asc" | "price-desc" | "scale";
type PriceBand = "all" | "under-1200" | "1200-2500" | "above-2500";
type ReviewSummary = { count: number; averageRating: number };

interface CollectionCatalogClientProps {
  skus: Sku[];
  title: string;
  breadcrumbLabel: string;
  activeCategorySlug?: PrimaryCategorySlug | "all";
  initialStockMap?: Record<string, number> | null;
  initialOverridesMap?: Record<
    string,
    {
      priceInr?: number | null;
      mrpInr?: number | null;
      hidden?: boolean | null;
      comingSoon?: boolean | null;
      discontinued?: boolean | null;
      preorder?: boolean | null;
      lowStockThreshold?: number | null;
      featured?: boolean | null;
      alternatives?: string[] | null;
      badge?: string | null;
    }
  > | null;
}

export default function CollectionCatalogClient({
  skus,
  title,
  breadcrumbLabel,
  activeCategorySlug = "all",
  initialStockMap = null,
  initialOverridesMap = null,
}: CollectionCatalogClientProps) {
  const router = useRouter();
  const { stockMap: liveStockMap, overridesMap: liveOverridesMap } =
    useLiveStock(initialStockMap);

  const stockMap = liveStockMap ?? initialStockMap;
  const overridesMap = liveOverridesMap ?? initialOverridesMap;

  const [salesMap, setSalesMap] = useState<Record<string, number> | null>(null);
  const [reviewsMap, setReviewsMap] = useState<Record<string, ReviewSummary> | null>(
    null,
  );

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
        if (!cancelled && d && typeof d.reviews === "object")
          setReviewsMap(d.reviews);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [sort, setSort] = useState<SortKey>("featured");
  const [scaleFilter, setScaleFilter] = useState<string>("all");
  const [priceBand, setPriceBand] = useState<PriceBand>("all");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<string>("all");
  const [drivingStyleFilter, setDrivingStyleFilter] = useState<string>("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);

  // Desktop "More Filters" popover & Mobile bottom-sheet drawer
  const [moreFiltersOpen, setMoreFiltersOpen] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const moreFiltersRef = useRef<HTMLDivElement | null>(null);

  const availMap = useMemo(() => {
    const map: Record<string, ProductAvailability> = {};
    for (const s of skus) {
      map[s.id] = resolveProductAvailability(s, stockMap, overridesMap?.[s.id]);
    }
    return map;
  }, [skus, stockMap, overridesMap]);

  // Compute available facet options from the current collection's SKUs
  const facets = useMemo(() => {
    const scales = new Set<string>();
    const types = new Set<string>();
    const styles = new Set<string>();
    const colors = new Set<string>();
    const brands = new Set<string>();

    for (const s of skus) {
      scales.add(s.scale);
      const cls = getProductClassification(s);
      if (cls) {
        types.add(cls.vehicleType);
        styles.add(cls.drivingStyle);
        brands.add(cls.brand);
        for (const c of cls.colorNames) colors.add(c);
      }
    }

    return {
      scales: Array.from(scales),
      types: Array.from(types),
      styles: Array.from(styles),
      colors: Array.from(colors).sort(),
      brands: Array.from(brands).sort(),
    };
  }, [skus]);

  // Initialize scale / vehicle type filters from URL query parameters (?scale=1:64, ?type=Excavator)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const scaleParam = params.get("scale");
    if (scaleParam && facets.scales.includes(scaleParam)) {
      setScaleFilter(scaleParam);
    }
    const typeParam = params.get("type");
    if (typeParam && facets.types.includes(typeParam)) {
      setVehicleTypeFilter(typeParam);
    }
  }, [facets.scales, facets.types]);

  // Close desktop "More Filters" popover on outside click or Escape
  useEffect(() => {
    if (!moreFiltersOpen) return;
    function handleOutside(e: MouseEvent) {
      if (
        moreFiltersRef.current &&
        !moreFiltersRef.current.contains(e.target as Node)
      ) {
        setMoreFiltersOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreFiltersOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [moreFiltersOpen]);

  const moreFilterCount =
    (drivingStyleFilter !== "all" ? 1 : 0) + (brandFilter !== "all" ? 1 : 0);

  const activeFilterCount =
    (scaleFilter !== "all" ? 1 : 0) +
    (priceBand !== "all" ? 1 : 0) +
    (vehicleTypeFilter !== "all" ? 1 : 0) +
    (colorFilter !== "all" ? 1 : 0) +
    (inStockOnly ? 1 : 0) +
    moreFilterCount;

  function resetFilters() {
    setScaleFilter("all");
    setPriceBand("all");
    setVehicleTypeFilter("all");
    setDrivingStyleFilter("all");
    setColorFilter("all");
    setBrandFilter("all");
    setInStockOnly(false);
    setSort("featured");
    setMoreFiltersOpen(false);
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  const filteredSkus = useMemo(() => {
    const baseOrdered = sortSkusByAvailability(skus, stockMap, overridesMap);

    const list = baseOrdered.filter((s) => {
      const ov = overridesMap?.[s.id];
      if (ov?.hidden === true) return false;

      const cls = getProductClassification(s);
      const avail = availMap[s.id] ?? resolveProductAvailability(s, stockMap, ov);

      if (inStockOnly && !avail.purchasable) return false;
      if (scaleFilter !== "all" && s.scale !== scaleFilter) return false;

      const onlinePrice = Math.max(0, (ov?.priceInr ?? s.retailINR) - 100);
      if (priceBand === "under-1200" && onlinePrice >= 1200) return false;
      if (priceBand === "1200-2500" && (onlinePrice < 1200 || onlinePrice > 2500))
        return false;
      if (priceBand === "above-2500" && onlinePrice <= 2500) return false;

      if (vehicleTypeFilter !== "all" && cls?.vehicleType !== vehicleTypeFilter)
        return false;
      if (drivingStyleFilter !== "all" && cls?.drivingStyle !== drivingStyleFilter)
        return false;
      if (colorFilter !== "all" && !cls?.colorNames.includes(colorFilter))
        return false;
      if (brandFilter !== "all" && cls?.brand !== brandFilter) return false;

      return true;
    });

    if (sort === "featured") return list;

    return [...list].sort((a, b) => {
      const avA =
        availMap[a.id] ??
        resolveProductAvailability(a, stockMap, overridesMap?.[a.id]);
      const avB =
        availMap[b.id] ??
        resolveProductAvailability(b, stockMap, overridesMap?.[b.id]);
      const purchA = avA.purchasable ? 0 : 1;
      const purchB = avB.purchasable ? 0 : 1;
      if (purchA !== purchB) return purchA - purchB;

      const priceA = overridesMap?.[a.id]?.priceInr ?? a.retailINR;
      const priceB = overridesMap?.[b.id]?.priceInr ?? b.retailINR;

      if (sort === "price-asc") return priceA - priceB;
      if (sort === "price-desc") return priceB - priceA;
      if (sort === "scale") return a.scale.localeCompare(b.scale);
      return 0;
    });
  }, [
    skus,
    stockMap,
    overridesMap,
    availMap,
    inStockOnly,
    scaleFilter,
    priceBand,
    vehicleTypeFilter,
    drivingStyleFilter,
    colorFilter,
    brandFilter,
    sort,
  ]);

  const inStockCount = useMemo(() => {
    return skus.filter((s) => {
      const ov = overridesMap?.[s.id];
      if (ov?.hidden === true) return false;
      return (availMap[s.id] ?? resolveProductAvailability(s, stockMap, ov))
        .purchasable;
    }).length;
  }, [skus, stockMap, overridesMap, availMap]);

  const countLabel =
    filteredSkus.length === skus.length
      ? `${skus.length} ${skus.length === 1 ? "Model" : "Models"}`
      : `${filteredSkus.length} of ${skus.length} Models`;

  const selectBaseClass =
    "h-8 rounded-lg border px-2.5 text-xs font-medium transition focus:border-brand-red focus:outline-none cursor-pointer";

  return (
    <div className="bg-brand-cream">
      {/* Compact Header & Single-Row Filter Bar */}
      <div className="border-b border-brand-line bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-2 pb-2 sm:px-6">
          {/* Row 1: Breadcrumb + H1 + Model Count + Contextual Category Action */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <nav
                aria-label="Breadcrumb"
                className="flex items-center gap-1 text-[11px] text-brand-ink-soft mr-1"
              >
                <Link href="/" className="transition hover:text-brand-red">
                  Home
                </Link>
                <ChevronRight size={10} className="text-brand-ink-soft/50" />
                {activeCategorySlug === "all" ? (
                  <span className="font-medium text-brand-ink-soft" aria-current="page">
                    Collections
                  </span>
                ) : (
                  <>
                    <Link
                      href="/collections"
                      className="transition hover:text-brand-red"
                    >
                      Collections
                    </Link>
                    <ChevronRight size={10} className="text-brand-ink-soft/50" />
                    <span
                      className="font-medium text-brand-red"
                      aria-current="page"
                    >
                      {breadcrumbLabel}
                    </span>
                  </>
                )}
              </nav>

              <div className="flex items-baseline gap-2">
                <h1 className="font-display text-lg font-extrabold uppercase tracking-wide text-brand-ink sm:text-2xl leading-tight">
                  {title}
                </h1>
                <span className="text-xs font-medium text-brand-ink-soft whitespace-nowrap">
                  — {countLabel}
                </span>
              </div>
            </div>

            {/* Compact category navigation / View All link */}
            <div className="flex items-center gap-2">
              <label htmlFor="category-jump-select" className="sr-only">
                Switch category
              </label>
              <select
                id="category-jump-select"
                aria-label="Switch category"
                value={
                  activeCategorySlug === "all"
                    ? "/collections"
                    : `/collections/${activeCategorySlug}`
                }
                onChange={(e) => router.push(e.target.value)}
                className="h-7 rounded-md border border-brand-line bg-brand-cream px-2 text-[11px] font-semibold text-brand-ink focus:border-brand-red focus:outline-none lg:hidden"
              >
                <option value="/collections">All Categories</option>
                {PRIMARY_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.url}>
                    {c.name}
                  </option>
                ))}
              </select>

              {activeCategorySlug !== "all" && (
                <Link
                  href="/collections"
                  className="hidden lg:inline-flex items-center gap-1 text-xs font-semibold text-brand-red hover:underline"
                >
                  View All Categories →
                </Link>
              )}
            </div>
          </div>

          {/* Row 2 (Desktop): Single Horizontal Filter + Sort Row */}
          <div className="mt-1.5 hidden md:flex items-center justify-between gap-2 pt-1.5 border-t border-brand-line/60">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Scale ▼ */}
              {facets.scales.length > 1 && (
                <select
                  aria-label="Filter by scale"
                  value={scaleFilter}
                  onChange={(e) => setScaleFilter(e.target.value)}
                  className={`${selectBaseClass} ${
                    scaleFilter !== "all"
                      ? "border-brand-red bg-brand-red/5 font-bold text-brand-red"
                      : "border-brand-line bg-white text-brand-ink"
                  }`}
                >
                  <option value="all">Scale: All</option>
                  {facets.scales.map((sc) => (
                    <option key={sc} value={sc}>
                      Scale: {sc}
                    </option>
                  ))}
                </select>
              )}

              {/* Price ▼ */}
              <select
                aria-label="Filter by price"
                value={priceBand}
                onChange={(e) => setPriceBand(e.target.value as PriceBand)}
                className={`${selectBaseClass} ${
                  priceBand !== "all"
                    ? "border-brand-red bg-brand-red/5 font-bold text-brand-red"
                    : "border-brand-line bg-white text-brand-ink"
                }`}
              >
                <option value="all">Price: All</option>
                <option value="under-1200">Under ₹1,200</option>
                <option value="1200-2500">₹1,200 – ₹2,500</option>
                <option value="above-2500">Above ₹2,500</option>
              </select>

              {/* Type ▼ */}
              {facets.types.length > 1 && (
                <select
                  aria-label="Filter by vehicle type"
                  value={vehicleTypeFilter}
                  onChange={(e) => setVehicleTypeFilter(e.target.value)}
                  className={`${selectBaseClass} ${
                    vehicleTypeFilter !== "all"
                      ? "border-brand-red bg-brand-red/5 font-bold text-brand-red"
                      : "border-brand-line bg-white text-brand-ink"
                  }`}
                >
                  <option value="all">Type: All</option>
                  {facets.types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}

              {/* Colour ▼ */}
              {facets.colors.length > 1 && (
                <select
                  aria-label="Filter by colour"
                  value={colorFilter}
                  onChange={(e) => setColorFilter(e.target.value)}
                  className={`${selectBaseClass} ${
                    colorFilter !== "all"
                      ? "border-brand-red bg-brand-red/5 font-bold text-brand-red"
                      : "border-brand-line bg-white text-brand-ink"
                  }`}
                >
                  <option value="all">Colour: All</option>
                  {facets.colors.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}

              {/* In Stock Toggle */}
              <button
                type="button"
                onClick={() => setInStockOnly((v) => !v)}
                aria-pressed={inStockOnly}
                className={`h-8 cursor-pointer rounded-lg border px-2.5 text-xs font-semibold transition ${
                  inStockOnly
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-brand-line bg-white text-brand-ink hover:border-brand-ink-soft"
                }`}
              >
                In Stock ({inStockCount})
              </button>

              {/* More Filters Dropdown (Driving Style + Brand Style) */}
              {(facets.styles.length > 1 || facets.brands.length > 1) && (
                <div ref={moreFiltersRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setMoreFiltersOpen((v) => !v)}
                    aria-expanded={moreFiltersOpen}
                    className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition ${
                      moreFilterCount > 0
                        ? "border-brand-red bg-brand-red/5 font-bold text-brand-red"
                        : "border-brand-line bg-white text-brand-ink hover:border-brand-ink-soft"
                    }`}
                  >
                    <span>More</span>
                    {moreFilterCount > 0 && (
                      <span className="rounded-full bg-brand-red px-1.5 text-[10px] font-bold text-white">
                        {moreFilterCount}
                      </span>
                    )}
                    <ChevronDown size={12} />
                  </button>

                  {moreFiltersOpen && (
                    <div className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-brand-line bg-white p-3 shadow-lg space-y-2.5">
                      {facets.styles.length > 1 && (
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-brand-ink-soft">
                            Driving Style
                          </label>
                          <select
                            aria-label="Filter by driving style"
                            value={drivingStyleFilter}
                            onChange={(e) => setDrivingStyleFilter(e.target.value)}
                            className="w-full rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs text-brand-ink focus:border-brand-red focus:outline-none"
                          >
                            <option value="all">All Driving Styles</option>
                            {facets.styles.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {facets.brands.length > 1 && (
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-brand-ink-soft">
                            Brand / Model Style
                          </label>
                          <select
                            aria-label="Filter by brand style"
                            value={brandFilter}
                            onChange={(e) => setBrandFilter(e.target.value)}
                            className="w-full rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs text-brand-ink focus:border-brand-red focus:outline-none"
                          >
                            <option value="all">All Brand Styles</option>
                            {facets.brands.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Reset Button */}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-brand-red/10 px-2.5 text-xs font-bold text-brand-red hover:bg-brand-red/15"
                >
                  <RotateCcw size={11} />
                  Reset ({activeFilterCount})
                </button>
              )}
            </div>

            {/* Far Right: Sort ▼ */}
            <div className="flex shrink-0 items-center gap-1.5">
              <SlidersHorizontal
                size={12}
                className="text-brand-ink-soft hidden lg:inline"
              />
              <label htmlFor="collection-sort-desktop" className="sr-only">
                Sort models
              </label>
              <select
                id="collection-sort-desktop"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-8 rounded-lg border border-brand-line bg-white px-2.5 text-xs font-semibold text-brand-ink focus:border-brand-red focus:outline-none cursor-pointer"
              >
                <option value="featured">Sort: Available First</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="scale">Scale Size</option>
              </select>
            </div>
          </div>

          {/* Row 2 (Mobile): Compact Single-Row Filter Drawer Trigger + In Stock + Sort */}
          <div className="mt-1.5 flex md:hidden items-center justify-between gap-1.5 pt-1.5 border-t border-brand-line/60">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 text-xs font-bold text-brand-ink"
              >
                <Filter size={12} className="text-brand-red" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-brand-red px-1.5 text-[10px] font-extrabold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setInStockOnly((v) => !v)}
                aria-pressed={inStockOnly}
                className={`h-8 cursor-pointer rounded-lg border px-2.5 text-xs font-semibold transition ${
                  inStockOnly
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-brand-line bg-white text-brand-ink"
                }`}
              >
                In Stock ({inStockCount})
              </button>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  aria-label="Reset filters"
                  className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-brand-red/10 px-2 text-xs font-bold text-brand-red"
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>

            <div className="shrink-0">
              <label htmlFor="collection-sort-mobile" className="sr-only">
                Sort models
              </label>
              <select
                id="collection-sort-mobile"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-8 rounded-lg border border-brand-line bg-white px-2 text-xs font-semibold text-brand-ink focus:border-brand-red focus:outline-none"
              >
                <option value="featured">Sort: Featured</option>
                <option value="price-asc">Price: Low-High</option>
                <option value="price-desc">Price: High-Low</option>
                <option value="scale">Scale</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Filter Drawer / Bottom Sheet */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/50 md:hidden"
          onClick={() => setMobileDrawerOpen(false)}
        >
          <div
            className="w-full max-h-[82vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl space-y-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-brand-line pb-2.5">
              <span className="font-display text-base font-extrabold uppercase tracking-wide text-brand-ink">
                Filter {title}
              </span>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="Close filters"
                className="rounded-full p-1 text-brand-ink-soft hover:bg-brand-cream"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 text-xs">
              {facets.scales.length > 1 && (
                <div>
                  <label className="mb-1 block font-bold text-brand-ink">
                    Scale
                  </label>
                  <select
                    value={scaleFilter}
                    onChange={(e) => setScaleFilter(e.target.value)}
                    className="w-full rounded-lg border border-brand-line bg-white px-3 py-2 text-xs text-brand-ink"
                  >
                    <option value="all">All Scales ({facets.scales.length})</option>
                    {facets.scales.map((sc) => (
                      <option key={sc} value={sc}>
                        Scale: {sc}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block font-bold text-brand-ink">
                  Price Range
                </label>
                <select
                  value={priceBand}
                  onChange={(e) => setPriceBand(e.target.value as PriceBand)}
                  className="w-full rounded-lg border border-brand-line bg-white px-3 py-2 text-xs text-brand-ink"
                >
                  <option value="all">All Prices</option>
                  <option value="under-1200">Under ₹1,200</option>
                  <option value="1200-2500">₹1,200 – ₹2,500</option>
                  <option value="above-2500">Above ₹2,500</option>
                </select>
              </div>

              {facets.types.length > 1 && (
                <div>
                  <label className="mb-1 block font-bold text-brand-ink">
                    Vehicle Type
                  </label>
                  <select
                    value={vehicleTypeFilter}
                    onChange={(e) => setVehicleTypeFilter(e.target.value)}
                    className="w-full rounded-lg border border-brand-line bg-white px-3 py-2 text-xs text-brand-ink"
                  >
                    <option value="all">All Vehicle Types</option>
                    {facets.types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {facets.colors.length > 1 && (
                <div>
                  <label className="mb-1 block font-bold text-brand-ink">
                    Colour
                  </label>
                  <select
                    value={colorFilter}
                    onChange={(e) => setColorFilter(e.target.value)}
                    className="w-full rounded-lg border border-brand-line bg-white px-3 py-2 text-xs text-brand-ink"
                  >
                    <option value="all">All Colours</option>
                    {facets.colors.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {facets.styles.length > 1 && (
                <div>
                  <label className="mb-1 block font-bold text-brand-ink">
                    Driving Style
                  </label>
                  <select
                    value={drivingStyleFilter}
                    onChange={(e) => setDrivingStyleFilter(e.target.value)}
                    className="w-full rounded-lg border border-brand-line bg-white px-3 py-2 text-xs text-brand-ink"
                  >
                    <option value="all">All Driving Styles</option>
                    {facets.styles.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {facets.brands.length > 1 && (
                <div>
                  <label className="mb-1 block font-bold text-brand-ink">
                    Brand / Model Style
                  </label>
                  <select
                    value={brandFilter}
                    onChange={(e) => setBrandFilter(e.target.value)}
                    className="w-full rounded-lg border border-brand-line bg-white px-3 py-2 text-xs text-brand-ink"
                  >
                    <option value="all">All Brand Styles</option>
                    {facets.brands.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-brand-line">
              <button
                type="button"
                onClick={resetFilters}
                className="flex-1 rounded-xl border border-brand-line bg-brand-cream py-2.5 text-xs font-bold text-brand-ink"
              >
                Reset All
              </button>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="flex-1 rounded-xl bg-brand-red py-2.5 text-xs font-bold text-white"
              >
                Show {filteredSkus.length} Models
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Immediate Product Grid */}
      <div className="mx-auto max-w-6xl px-4 pt-3 pb-8 sm:px-6 sm:pt-3.5 sm:pb-10">
        {filteredSkus.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-3xl border border-brand-line bg-white p-8 text-center sm:p-10">
            <Sparkles size={24} className="mx-auto text-brand-red" />
            <h2 className="mt-2.5 font-display text-lg font-extrabold text-brand-ink sm:text-xl">
              No models match your current filter combination
            </h2>
            <p className="mt-1.5 text-xs text-brand-ink-soft sm:text-sm">
              Try clearing one or more filters to view all available RC models in
              this collection.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand-red px-5 py-2 text-xs font-bold text-white hover:bg-brand-red-hover"
            >
              <RotateCcw size={13} />
              Show All {skus.length} Models
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {filteredSkus.map((sku) => (
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
        )}

        {activeCategorySlug === "construction-rc" && (
          <div className="mt-6">
            <ConstructionBundleBanner />
          </div>
        )}
      </div>
    </div>
  );
}
