/**
 * Product overrides — the admin-editable layer over the code catalogue.
 *
 * The catalogue itself lives in code (src/lib/products.ts). The admin can layer
 * a small DB override (price / MRP / visibility / badge / status / threshold /
 * merchandising) on top of any SKU WITHOUT migrating the whole catalogue. Reads
 * here ALWAYS fall back cleanly on any error (missing columns before migration,
 * missing table, or DB blip), so the storefront and checkout keep working
 * reliably. Money stays consistent because every price consumer (PDP display +
 * the order-create pricing seam) reads the SAME merged value.
 */

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { productOverrides } from "@/db/schema";
import type { Sku } from "@/lib/products";
import { applyOverride, type ProductOverride } from "@/lib/availability";

export { applyOverride, type ProductOverride };

const EXTENDED_COLS = {
  skuId: productOverrides.skuId,
  priceInr: productOverrides.priceInr,
  mrpInr: productOverrides.mrpInr,
  hidden: productOverrides.hidden,
  comingSoon: productOverrides.comingSoon,
  discontinued: productOverrides.discontinued,
  preorder: productOverrides.preorder,
  lowStockThreshold: productOverrides.lowStockThreshold,
  featured: productOverrides.featured,
  alternatives: productOverrides.alternatives,
  badge: productOverrides.badge,
} as const;

const BASE_COLS = {
  skuId: productOverrides.skuId,
  priceInr: productOverrides.priceInr,
  mrpInr: productOverrides.mrpInr,
  hidden: productOverrides.hidden,
  comingSoon: productOverrides.comingSoon,
  badge: productOverrides.badge,
} as const;

function isMissingColumnError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  if (e?.code === "42703" || e?.cause?.code === "42703") return true;
  const msg = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`.toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const CACHE_TTL_MS = isBuildPhase ? 60_000 : 2_000;

let cachedOverrides: Map<string, ProductOverride> | null = null;
let cachedAt = 0;
let inflightOverrides: Promise<Map<string, ProductOverride>> | null = null;

export function invalidateOverridesCache(): void {
  cachedOverrides = null;
  cachedAt = 0;
  inflightOverrides = null;
}

async function fetchOverrideMapFromDb(
  siteIds?: string[],
): Promise<Map<string, ProductOverride>> {
  try {
    const base = db.select(EXTENDED_COLS).from(productOverrides);
    const rows =
      siteIds && siteIds.length
        ? await base.where(inArray(productOverrides.siteId, siteIds))
        : await base;
    const m = new Map<string, ProductOverride>();
    for (const r of rows) m.set(r.skuId, r as ProductOverride);
    return m;
  } catch (err) {
    if (!isMissingColumnError(err)) return new Map();
    try {
      const base = db.select(BASE_COLS).from(productOverrides);
      const rows =
        siteIds && siteIds.length
          ? await base.where(inArray(productOverrides.siteId, siteIds))
          : await base;
      const m = new Map<string, ProductOverride>();
      for (const r of rows) m.set(r.skuId, r as ProductOverride);
      return m;
    } catch {
      return new Map();
    }
  }
}

/** All overrides (optionally site-scoped), keyed by SKU id. Empty on any error. */
export async function getOverrideMap(
  siteIds?: string[],
): Promise<Map<string, ProductOverride>> {
  const now = Date.now();
  if (cachedOverrides && now - cachedAt < CACHE_TTL_MS) {
    return new Map(cachedOverrides);
  }
  if (!inflightOverrides) {
    inflightOverrides = Promise.race([
      fetchOverrideMapFromDb(siteIds),
      new Promise<Map<string, ProductOverride>>((resolve) =>
        setTimeout(() => resolve(new Map()), 2500),
      ),
    ]).then((res) => {
      cachedOverrides = res;
      cachedAt = Date.now();
      inflightOverrides = null;
      return res;
    });
  }
  const map = await inflightOverrides;
  return new Map(map);
}

/** Override for a single SKU (used by the PDP). Undefined on any error. */
export async function getOverrideForSku(
  skuId: string,
): Promise<ProductOverride | undefined> {
  const map = await getOverrideMap();
  return map.get(skuId);
}

/** Apply a whole override map to a list of code SKUs. */
export function applyOverrides(
  skus: Sku[],
  map: Map<string, ProductOverride>,
): Sku[] {
  if (map.size === 0) return skus;
  return skus.map((s) => applyOverride(s, map.get(s.id)));
}

/** The single authoritative unit price for a SKU (code price + override). */
export function effectivePrice(sku: Sku, ov?: ProductOverride): number {
  return ov?.priceInr ?? sku.retailINR;
}
