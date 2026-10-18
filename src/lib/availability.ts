/**
 * Authoritative Inventory Availability Service (Client & Server safe)
 *
 * Single source of truth for translating live DB inventory (`stockMap`) +
 * admin overrides (`ProductOverride`) into actionable product and variant states:
 *   - IN_STOCK
 *   - LOW_STOCK
 *   - OUT_OF_STOCK
 *   - COMING_SOON
 *   - PREORDER (only when explicitly enabled by admin)
 *   - DISCONTINUED
 *
 * Core invariant:
 *   Unknown or unloaded inventory (`stockMap == null` or missing key) NEVER
 *   defaults to in-stock (`purchasable: false`, `availableQty: 0`).
 */

import { PRODUCTS, type Sku } from "@/lib/products";
import { LOW_STOCK_THRESHOLD } from "@/lib/stock-threshold";

export type ProductOverride = {
  skuId: string;
  priceInr: number | null;
  mrpInr: number | null;
  hidden: boolean | null;
  comingSoon: boolean | null;
  discontinued?: boolean | null;
  preorder?: boolean | null;
  lowStockThreshold?: number | null;
  featured?: boolean | null;
  alternatives?: string[] | null;
  badge: string | null;
};

/** Merge an override onto a code SKU. Null/undefined fields keep the code value. */
export function applyOverride(sku: Sku, ov?: ProductOverride): Sku {
  if (!ov) return sku;
  const nextPrice = ov.priceInr ?? sku.retailINR;
  return {
    ...sku,
    retailINR: nextPrice,
    mrpINR: ov.mrpInr ?? sku.mrpINR,
    hidden: ov.hidden ?? sku.hidden,
    comingSoon: ov.comingSoon ?? sku.comingSoon,
    discontinued: ov.discontinued ?? sku.discontinued,
    preorder: ov.preorder ?? sku.preorder,
    lowStockThreshold: ov.lowStockThreshold ?? sku.lowStockThreshold,
    featured: ov.featured ?? sku.featured,
    alternatives:
      ov.alternatives && ov.alternatives.length > 0
        ? ov.alternatives
        : sku.alternatives,
    badge:
      ov.badge === null
        ? sku.badge
        : ov.badge === ""
          ? undefined
          : (ov.badge as Sku["badge"]),
  };
}

export type AvailabilityStatus =
  | "IN_STOCK"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "COMING_SOON"
  | "PREORDER"
  | "DISCONTINUED";

export type StockMap = Record<string, number> | null | undefined;

export interface VariantAvailability {
  skuId: string;
  variantSlug: string;
  variantName: string;
  key: string;
  status: AvailabilityStatus;
  /** True only when live stockMap has been loaded from the DB / /api/stock */
  stockKnown: boolean;
  /** Verified available units (0 when unknown, sold out, coming soon, or discontinued) */
  availableQty: number;
  /** Maximum quantity a customer can select/add (capped at 10) */
  maxOrderQty: number;
  /** True ONLY when verified purchasable right now */
  purchasable: boolean;
  lowStockThreshold: number;
  /** Concise status badge text for UI cards & PDP */
  badgeText: string;
  label: string;
  /** If this SKU is a bundle and a component SKU limits or blocks stock */
  limitingComponentSkuId?: string;
}

export interface ProductAvailability {
  skuId: string;
  status: AvailabilityStatus;
  stockKnown: boolean;
  totalAvailableQty: number;
  availableQty: number;
  maxOrderQty: number;
  purchasable: boolean;
  lowStockThreshold: number;
  badgeText: string;
  label: string;
  sortRank: number;
  firstInStockVariantSlug: string | null;
  firstAvailableVariantSlug: string | null;
  inStockVariantCount: number;
  totalVariantCount: number;
  availableVariants: VariantAvailability[];
  variants: Record<string, VariantAvailability>;
}

/** Default bundle components map for fixed-price bundles */
export const BUNDLE_COMPONENTS: Record<string, string[]> = {
  "construction-3pack": ["mining-truck", "rc-excavator", "rc-forklift"],
};

export function getBundleComponentSkuIds(sku: Sku): string[] {
  if (sku.bundleComponentSkuIds && sku.bundleComponentSkuIds.length > 0) {
    return sku.bundleComponentSkuIds;
  }
  return BUNDLE_COMPONENTS[sku.id] ?? [];
}

/** Canonical `${skuId}:${variantSlug}` key */
export function makeStockKey(skuId: string, variantSlug?: string | null): string {
  return `${skuId}:${variantSlug ?? ""}`;
}

/** Map an AvailabilityStatus to its schema.org ItemAvailability URL */
export function schemaAvailabilityUrl(status: AvailabilityStatus | string): string {
  switch (status) {
    case "IN_STOCK":
    case "LOW_STOCK":
      return "https://schema.org/InStock";
    case "PREORDER":
      return "https://schema.org/PreOrder";
    case "COMING_SOON":
      return "https://schema.org/PreSale";
    case "DISCONTINUED":
      return "https://schema.org/Discontinued";
    case "OUT_OF_STOCK":
    default:
      return "https://schema.org/OutOfStock";
  }
}

function statusSortRank(status: AvailabilityStatus, isFeatured: boolean): number {
  switch (status) {
    case "IN_STOCK":
    case "LOW_STOCK":
    case "PREORDER":
      return isFeatured ? 0 : 5;
    case "COMING_SOON":
      return 20;
    case "OUT_OF_STOCK":
      return 30;
    case "DISCONTINUED":
      return 40;
    default:
      return 30;
  }
}

/**
 * Resolve availability for a specific `(sku, variantSlug)` pair.
 * Colourless SKUs pass `""` or `null` for `variantSlug`.
 */
export function resolveVariantAvailability(
  sku: Sku,
  variantSlug: string | null | undefined,
  stockMap: StockMap,
  override?: Partial<ProductOverride> | null,
): VariantAvailability {
  const normVariant = sku.colors && sku.colors.length > 0 ? (variantSlug ?? sku.colors[0].slug) : "";
  const colorObj = sku.colors?.find((c) => c.slug === normVariant);
  const variantName = colorObj?.name ?? normVariant;
  const key = makeStockKey(sku.id, normVariant);

  const isDiscontinued = Boolean(override?.discontinued ?? sku.discontinued);
  const isComingSoon = Boolean(override?.comingSoon ?? sku.comingSoon);
  const isPreorder = Boolean(override?.preorder ?? sku.preorder);
  const threshold = Math.max(
    1,
    override?.lowStockThreshold ?? sku.lowStockThreshold ?? LOW_STOCK_THRESHOLD,
  );

  if (isDiscontinued) {
    return {
      skuId: sku.id,
      variantSlug: normVariant,
      variantName,
      key,
      status: "DISCONTINUED",
      stockKnown: true,
      availableQty: 0,
      maxOrderQty: 0,
      purchasable: false,
      lowStockThreshold: threshold,
      badgeText: "Discontinued",
      label: "Discontinued",
    };
  }

  // Explicit admin-enabled preorder takes precedence over comingSoon
  if (isPreorder) {
    const rawPreorderCap =
      stockMap && typeof stockMap[key] === "number" && stockMap[key] > 0
        ? stockMap[key]
        : 10;
    const maxOrderQty = Math.min(10, rawPreorderCap);
    return {
      skuId: sku.id,
      variantSlug: normVariant,
      variantName,
      key,
      status: "PREORDER",
      stockKnown: true,
      availableQty: maxOrderQty,
      maxOrderQty,
      purchasable: true,
      lowStockThreshold: threshold,
      badgeText: "Pre-order",
      label: "Pre-order",
    };
  }

  if (isComingSoon) {
    return {
      skuId: sku.id,
      variantSlug: normVariant,
      variantName,
      key,
      status: "COMING_SOON",
      stockKnown: true,
      availableQty: 0,
      maxOrderQty: 0,
      purchasable: false,
      lowStockThreshold: threshold,
      badgeText: "Coming Soon",
      label: "Coming Soon",
    };
  }

  // Unknown inventory MUST NOT default to in-stock
  if (!stockMap) {
    return {
      skuId: sku.id,
      variantSlug: normVariant,
      variantName,
      key,
      status: "OUT_OF_STOCK",
      stockKnown: false,
      availableQty: 0,
      maxOrderQty: 0,
      purchasable: false,
      lowStockThreshold: threshold,
      badgeText: "Checking stock…",
      label: "Checking stock…",
    };
  }

  const rawStock = typeof stockMap[key] === "number" ? Math.max(0, stockMap[key]) : 0;
  let effectiveStock = rawStock;
  let limitingComponentSkuId: string | undefined;

  // If this SKU is a bundle (e.g. construction-3pack), its availability is bounded
  // by the availability of every component SKU.
  const componentIds = getBundleComponentSkuIds(sku);
  if (componentIds.length > 0) {
    for (const compId of componentIds) {
      const compSku = PRODUCTS.find((p) => p.id === compId);
      let compStock = 0;
      if (compSku && compSku.colors && compSku.colors.length > 0) {
        compStock = compSku.colors.reduce(
          (sum, c) => sum + Math.max(0, stockMap[makeStockKey(compId, c.slug)] ?? 0),
          0,
        );
      } else {
        compStock = Math.max(0, stockMap[makeStockKey(compId, "")] ?? 0);
      }
      if (compStock < effectiveStock) {
        effectiveStock = compStock;
        limitingComponentSkuId = compId;
      }
    }
  }

  if (effectiveStock <= 0) {
    return {
      skuId: sku.id,
      variantSlug: normVariant,
      variantName,
      key,
      status: "OUT_OF_STOCK",
      stockKnown: true,
      availableQty: 0,
      maxOrderQty: 0,
      purchasable: false,
      lowStockThreshold: threshold,
      badgeText: "SOLD OUT",
      label: "SOLD OUT",
      limitingComponentSkuId,
    };
  }

  const isLow = effectiveStock <= threshold;
  const maxOrderQty = Math.min(10, effectiveStock);
  const badgeText = isLow ? `Only ${effectiveStock} left` : "In stock";

  return {
    skuId: sku.id,
    variantSlug: normVariant,
    variantName,
    key,
    status: isLow ? "LOW_STOCK" : "IN_STOCK",
    stockKnown: true,
    availableQty: effectiveStock,
    maxOrderQty,
    purchasable: true,
    lowStockThreshold: threshold,
    badgeText,
    label: badgeText,
    limitingComponentSkuId,
  };
}

/**
 * Resolve overall product availability across all colour variants (or the
 * single colourless variant) for a SKU.
 */
export function resolveProductAvailability(
  sku: Sku,
  stockMap: StockMap,
  override?: Partial<ProductOverride> | null,
): ProductAvailability {
  const threshold = Math.max(
    1,
    override?.lowStockThreshold ?? sku.lowStockThreshold ?? LOW_STOCK_THRESHOLD,
  );
  const isFeatured = Boolean(override?.featured ?? sku.featured);
  const variants: Record<string, VariantAvailability> = {};
  const availableVariants: VariantAvailability[] = [];

  if (sku.colors && sku.colors.length > 0) {
    let totalAvailableQty = 0;
    let inStockVariantCount = 0;
    let firstInStockVariantSlug: string | null = null;
    let anyStockKnown = false;
    let anyDiscontinued = false;
    let anyComingSoon = false;
    let anyPreorder = false;

    for (const c of sku.colors) {
      const v = resolveVariantAvailability(sku, c.slug, stockMap, override);
      variants[c.slug] = v;
      if (v.stockKnown) anyStockKnown = true;
      if (v.status === "DISCONTINUED") anyDiscontinued = true;
      if (v.status === "COMING_SOON") anyComingSoon = true;
      if (v.status === "PREORDER") anyPreorder = true;
      if (v.purchasable && v.availableQty > 0) {
        totalAvailableQty += v.availableQty;
        inStockVariantCount += 1;
        availableVariants.push(v);
        if (!firstInStockVariantSlug) {
          firstInStockVariantSlug = c.slug;
        }
      }
    }

    let status: AvailabilityStatus = "OUT_OF_STOCK";
    let badgeText = "SOLD OUT";
    if (anyDiscontinued) {
      status = "DISCONTINUED";
      badgeText = "Discontinued";
    } else if (anyPreorder) {
      status = "PREORDER";
      badgeText = "Pre-order";
    } else if (anyComingSoon) {
      status = "COMING_SOON";
      badgeText = "Coming Soon";
    } else if (!anyStockKnown) {
      status = "OUT_OF_STOCK";
      badgeText = "Checking stock…";
    } else if (totalAvailableQty > 0) {
      const isLow = totalAvailableQty <= threshold;
      status = isLow ? "LOW_STOCK" : "IN_STOCK";
      badgeText = isLow ? `Only ${totalAvailableQty} left` : "In stock";
    } else {
      status = "OUT_OF_STOCK";
      badgeText = "SOLD OUT";
    }

    return {
      skuId: sku.id,
      status,
      stockKnown: anyStockKnown,
      totalAvailableQty,
      availableQty: totalAvailableQty,
      maxOrderQty: Math.min(10, totalAvailableQty),
      purchasable: inStockVariantCount > 0,
      lowStockThreshold: threshold,
      badgeText,
      label: badgeText,
      sortRank: statusSortRank(status, isFeatured),
      firstInStockVariantSlug,
      firstAvailableVariantSlug: firstInStockVariantSlug,
      inStockVariantCount,
      totalVariantCount: sku.colors.length,
      availableVariants,
      variants,
    };
  }

  const single = resolveVariantAvailability(sku, "", stockMap, override);
  variants[""] = single;
  if (single.purchasable && single.availableQty > 0) {
    availableVariants.push(single);
  }
  return {
    skuId: sku.id,
    status: single.status,
    stockKnown: single.stockKnown,
    totalAvailableQty: single.availableQty,
    availableQty: single.availableQty,
    maxOrderQty: single.maxOrderQty,
    purchasable: single.purchasable,
    lowStockThreshold: threshold,
    badgeText: single.badgeText,
    label: single.badgeText,
    sortRank: statusSortRank(single.status, isFeatured),
    firstInStockVariantSlug: null,
    firstAvailableVariantSlug: null,
    inStockVariantCount: single.purchasable ? 1 : 0,
    totalVariantCount: 1,
    availableVariants,
    variants,
  };
}

/**
 * Sort products so in-stock / low-stock / preorder products come first,
 * followed by coming-soon, out-of-stock, and discontinued products, while
 * preserving featured status and catalog order within each group.
 */
export function sortSkusByAvailability(
  skus: Sku[],
  stockMap: StockMap,
  overrideMap?: Record<string, ProductOverride> | Map<string, ProductOverride>,
): Sku[] {
  const getOv = (id: string): ProductOverride | undefined => {
    if (!overrideMap) return undefined;
    if (overrideMap instanceof Map) return overrideMap.get(id);
    return overrideMap[id];
  };

  const rank = (sku: Sku): number => {
    const ov = getOv(sku.id);
    const isFeatured = Boolean(ov?.featured ?? sku.featured);
    if (!stockMap) {
      // Before live stockMap arrives, still rank comingSoon and discontinued below active SKUs
      if (ov?.discontinued ?? sku.discontinued) return 40;
      if (ov?.comingSoon ?? sku.comingSoon) return 20;
      return isFeatured ? 0 : 5;
    }
    const avail = resolveProductAvailability(sku, stockMap, ov);
    switch (avail.status) {
      case "IN_STOCK":
      case "LOW_STOCK":
      case "PREORDER":
        return isFeatured ? 0 : 5;
      case "COMING_SOON":
        return 20;
      case "OUT_OF_STOCK":
        return 30;
      case "DISCONTINUED":
        return 40;
      default:
        return 30;
    }
  };

  return [...skus].sort((a, b) => rank(a) - rank(b));
}

/**
 * Find genuinely comparable in-stock alternative SKUs for a sold-out or
 * discontinued product. Never returns out-of-stock, coming-soon, discontinued,
 * hidden, or internal SKUs.
 */
export function findComparableAlternatives(
  sku: Sku,
  allSkus: Sku[] = PRODUCTS,
  stockMap: StockMap,
  overrideMap?: Record<string, ProductOverride> | Map<string, ProductOverride>,
  maxCount = 3,
): Sku[] {
  if (!stockMap) return [];

  const getOv = (id: string): ProductOverride | undefined => {
    if (!overrideMap) return undefined;
    if (overrideMap instanceof Map) return overrideMap.get(id);
    return overrideMap[id];
  };

  const isEligible = (candidate: Sku): boolean => {
    if (candidate.id === sku.id) return false;
    const ov = getOv(candidate.id);
    if (ov?.hidden ?? candidate.hidden) return false;
    if (candidate.internal) return false;
    const avail = resolveProductAvailability(candidate, stockMap, ov);
    return avail.purchasable && avail.totalAvailableQty > 0;
  };

  const result: Sku[] = [];
  const seen = new Set<string>();

  // 1. Admin/catalog explicit alternatives first
  const currentOv = getOv(sku.id);
  const explicitIds = currentOv?.alternatives ?? sku.alternatives ?? [];
  for (const altId of explicitIds) {
    const found = allSkus.find((p) => p.id === altId);
    if (found && isEligible(found) && !seen.has(found.id)) {
      result.push(found);
      seen.add(found.id);
      if (result.length >= maxCount) return result;
    }
  }

  // 2. Score remaining eligible SKUs by category, scale, drivetrain, and price proximity
  const scored = allSkus
    .filter((p) => !seen.has(p.id) && isEligible(p))
    .map((candidate) => {
      let score = 0;
      if (candidate.category && sku.category && candidate.category === sku.category) {
        score += 50;
      }
      if (candidate.scale === sku.scale) {
        score += 35;
      }
      if (candidate.specs.drive && candidate.specs.drive === sku.specs.drive) {
        score += 15;
      }
      const priceDiff = Math.abs(candidate.retailINR - sku.retailINR);
      score += Math.max(0, 20 - Math.floor(priceDiff / 200));
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const item of scored) {
    result.push(item.candidate);
    if (result.length >= maxCount) break;
  }

  return result;
}

export type UseCaseTag = "drifting" | "off-road" | "gifting" | "beginner";

/**
 * Derive verified shopping use-case tags from a SKU's real specifications and category.
 */
export function getSkuUseCases(sku: Sku): UseCaseTag[] {
  const tags: UseCaseTag[] = [];
  const nameLower = `${sku.name} ${sku.tagline} ${sku.bodyShape}`.toLowerCase();

  // Drifting: verified drift spec or 1:16 drift / 1:64 drift lineup
  const hasDriftSpec =
    Boolean(sku.specs.drift && sku.specs.drift.toLowerCase() !== "no") ||
    nameLower.includes("drift");
  if (hasDriftSpec) {
    tags.push("drifting");
  }

  // Off-road: crawlers, monster trucks, 4x4 off-roaders, construction rigs
  const isOffRoad =
    sku.category === "hobby" ||
    sku.category === "construction" ||
    nameLower.includes("crawler") ||
    nameLower.includes("monster") ||
    nameLower.includes("off-road") ||
    nameLower.includes("thar") ||
    nameLower.includes("defender") ||
    nameLower.includes("jeep") ||
    nameLower.includes("rally");
  if (isOffRoad) {
    tags.push("off-road");
  }

  // Gifting: desk-friendly RTR kits, MOST GIFTED badge, or under ₹2,500
  if (
    sku.badge === "MOST GIFTED" ||
    sku.badge === "BESTSELLER" ||
    sku.scale === "1:64" ||
    sku.retailINR <= 2499
  ) {
    tags.push("gifting");
  }

  // Beginner suitability: minAge <= 8, 1:64 desk cars, 1:20 Polos, or construction rigs
  if (
    (sku.specs.minAge ?? 8) <= 8 ||
    sku.scale === "1:64" ||
    sku.scale === "1:20" ||
    sku.category === "construction"
  ) {
    tags.push("beginner");
  }

  return tags;
}
