/**
 * Hub category definitions — bridged directly to the 4 approved primary
 * shopping categories in `src/lib/categories.ts` while preserving full
 * backward compatibility with `HubCat` (`key`, `label`, `img`, `skus`) and
 * `getHubCategory(key)`.
 *
 * Approved 4 Primary Categories:
 *   1. Mini RC Cars         (/collections/mini-rc-cars)
 *   2. Drift & Racing RC    (/collections/drift-racing)
 *   3. Construction RC      (/collections/construction-rc)
 *   4. Hobby Grade RC       (/collections/hobby-grade)
 *
 * Keeps `"Drone — Coming Soon"` outside the 4 primary shopping categories.
 */

import { type Sku } from "./products";
import {
  PRIMARY_CATEGORIES,
  getCategoryBySlug,
  getSkusForCategory,
  type PrimaryCategorySlug,
  type LegacyHubCategoryKey,
  type CategoryShortcut,
} from "./categories";

export type HubCategoryKey = PrimaryCategorySlug | LegacyHubCategoryKey;

export interface HubCategory {
  key: string;
  /** Compatible with legacy HubCat.label */
  label: string;
  /** Compatible with legacy HubCat.img */
  img: string | null;
  /** Compatible with legacy HubCat.skus */
  skus: Sku[];
  /** Canonical collection URL */
  url: `/collections/${PrimaryCategorySlug}`;
  /** Short pill label */
  scale: string;
  /** Primary display title */
  title: string;
  /** Approved SEO / collection heading */
  subtitle: string;
  /** Description copy */
  blurb: string;
  /** Price floor in INR (online price) */
  priceFloorINR: number;
  /** Representative circular thumbnail image */
  image: string;
  /** Alt text for the category image */
  imageAlt: string;
  /** 3 genuine product images for preview cards */
  heroImages: [string, string, string];
  /** Scale or subtype shortcut links */
  shortcuts: CategoryShortcut[];
  /** Key highlights */
  highlights: string[];
  comingSoon?: boolean;
}

/** Alias for backward compatibility with components importing `HubCat` */
export type HubCat = HubCategory;

export const HUB_CATEGORIES: HubCategory[] = PRIMARY_CATEGORIES.map((cat) => {
  const skus = getSkusForCategory(cat.slug, { includeHidden: false });
  return {
    key: cat.slug,
    label: cat.name,
    img: cat.image,
    skus,
    url: cat.url,
    scale: cat.shortLabel,
    title: cat.name,
    subtitle: cat.seoTargetHeading,
    blurb: cat.description,
    priceFloorINR: cat.priceFloorINR,
    image: cat.image,
    imageAlt: cat.imageAlt,
    heroImages: cat.heroImages,
    shortcuts: cat.shortcuts,
    highlights: cat.highlights,
    comingSoon: !cat.published,
  };
});

/**
 * Lookup a HubCategory by either its new primary slug (`mini-rc-cars`,
 * `drift-racing`, `construction-rc`, `hobby-grade`) or a legacy hub key
 * (`mini64`, `big16`, `s20`, `construction`, `polo`, `s43`, `hobby`).
 */
export function getHubCategory(key: string): HubCategory | undefined {
  const direct = HUB_CATEGORIES.find((c) => c.key === key);
  if (direct) return direct;
  const resolved = getCategoryBySlug(key);
  if (!resolved) return undefined;
  return HUB_CATEGORIES.find((c) => c.key === resolved.slug);
}

/**
 * Resolve a category (by `HubCategory` object, primary slug, or legacy key)
 * to its matching SKUs.
 */
export function skusForCategory(
  catOrKey: HubCategory | string,
  includeHidden = false,
  overridesMap?: Record<string, { hidden?: boolean | null }> | null,
): Sku[] {
  const key = typeof catOrKey === "string" ? catOrKey : catOrKey.key;
  const resolved = getCategoryBySlug(key);
  if (!resolved) return [];
  return getSkusForCategory(resolved.slug, {
    includeHidden,
    overridesMap,
  });
}
