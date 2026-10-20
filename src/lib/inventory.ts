/**
 * Inventory read helpers — the DB `inventory` table is the SINGLE SOURCE OF
 * TRUTH for stock. The storefront (PDP, grid, cart, checkout) reads live stock
 * from here via /api/stock; src/lib/products.ts `colors[].stock` is SEED-ONLY
 * (consumed by db/seed-inventory.ts) and must never drive UI or order decisions.
 *
 * This module is read-only on purpose. Stock DECREMENT lives in the order-create
 * transaction and stock RESTORE lives in the order lifecycle (holdsReleased /
 * reconciliation) — this file does not duplicate that logic.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventory } from "@/db/schema";
import { PRODUCTS } from "@/lib/products";
import { LOW_STOCK_THRESHOLD } from "@/lib/stock-threshold";
import { BUNDLE_COMPONENTS, getBundleComponentSkuIds } from "@/lib/availability";
import { getOverrideMap, applyOverrides } from "@/lib/product-overrides";

export const INVENTORY_SITE_ID = "prc";

/**
 * ONE single inventory (2026-07-08). The old per-store split (1:16 under
 * "prc16", everything else under "prc") is gone — the hub is the single
 * storefront and every inventory row lives under "prc".
 */
export const ALL_SITE_IDS = [INVENTORY_SITE_ID] as const;

/** Every SKU's inventory lives in the single hub keyspace. */
export function siteIdForSku(_skuId: string): string {
  return INVENTORY_SITE_ID;
}

/** Low-stock nudge threshold for both storefront badges and admin health. */
export { LOW_STOCK_THRESHOLD };

/** Canonical map key for a (sku, variant) pair. Colourless SKUs use "". */
export function inventoryKey(skuId: string, variantSlug: string | null): string {
  return `${skuId}:${variantSlug ?? ""}`;
}

export type ExpectedKey = {
  skuId: string;
  variantSlug: string;
  skuName: string;
  colorName: string | null;
  key: string;
};

/**
 * Every (skuId, variantSlug) the storefront can actually order, derived from
 * the non-hidden catalog. Colourless SKUs use variant_slug "". This is the set
 * the `inventory` table MUST cover for checkout to work — anything missing here
 * will be rejected at order create.
 */
export function expectedInventoryKeys(siteId?: string): ExpectedKey[] {
  const out: ExpectedKey[] = [];
  for (const sku of PRODUCTS) {
    if (sku.hidden) continue;
    if (siteId && siteId !== INVENTORY_SITE_ID) continue;
    if (sku.colors && sku.colors.length > 0) {
      for (const c of sku.colors) {
        out.push({
          skuId: sku.id,
          variantSlug: c.slug,
          skuName: sku.name,
          colorName: c.name,
          key: inventoryKey(sku.id, c.slug),
        });
      }
    } else {
      out.push({
        skuId: sku.id,
        variantSlug: "",
        skuName: sku.name,
        colorName: null,
        key: inventoryKey(sku.id, ""),
      });
    }
  }
  return out;
}

/**
 * Expand a list of SKU IDs to also include any component SKUs required by
 * fixed-price bundles (e.g. `construction-3pack` -> `mining-truck`, `rc-excavator`, `rc-forklift`).
 */
export function expandSkuIdsWithBundleComponents(skuIds?: string[]): string[] | undefined {
  if (!skuIds || skuIds.length === 0) return undefined;
  const set = new Set<string>(skuIds);
  for (const id of skuIds) {
    const comps = BUNDLE_COMPONENTS[id];
    if (comps) {
      for (const c of comps) set.add(c);
    }
  }
  return Array.from(set);
}

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const STOCK_CACHE_TTL_MS = isBuildPhase ? 60_000 : 2_000;

let cachedFullStockMap: Record<string, number> | null = null;
let cachedStockAt = 0;
let inflightStockPromise: Promise<Record<string, number>> | null = null;

export function invalidateInventoryCache(): void {
  cachedFullStockMap = null;
  cachedStockAt = 0;
  inflightStockPromise = null;
}

async function fetchFullStockMapFromDb(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      skuId: inventory.skuId,
      variantSlug: inventory.variantSlug,
      stock: inventory.stock,
    })
    .from(inventory)
    .where(eq(inventory.siteId, INVENTORY_SITE_ID));

  const map: Record<string, number> = {};
  for (const r of rows) map[`${r.skuId}:${r.variantSlug}`] = r.stock;
  return map;
}

/**
 * Live stock per `${skuId}:${variantSlug}` from the DB — the single source of
 * truth. Optionally filter to specific SKUs (automatically expanding bundle
 * component SKUs). A key that is absent from the returned map means "no
 * inventory row configured" (callers treat as 0/unavailable).
 */
export async function getStockMap(skuIds?: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  let fullMap = cachedFullStockMap;
  if (!fullMap || now - cachedStockAt >= STOCK_CACHE_TTL_MS) {
    if (!inflightStockPromise) {
      inflightStockPromise = fetchFullStockMapFromDb()
        .then((res) => {
          cachedFullStockMap = res;
          cachedStockAt = Date.now();
          inflightStockPromise = null;
          return res;
        })
        .catch((err) => {
          inflightStockPromise = null;
          throw err;
        });
    }
    fullMap = await inflightStockPromise;
  }

  const expanded = expandSkuIdsWithBundleComponents(skuIds);
  if (!expanded || expanded.length === 0) {
    return { ...fullMap };
  }
  const allowed = new Set(expanded);
  const filtered: Record<string, number> = {};
  for (const [k, v] of Object.entries(fullMap)) {
    const colonIdx = k.indexOf(":");
    const skuId = colonIdx === -1 ? k : k.slice(0, colonIdx);
    if (allowed.has(skuId)) {
      filtered[k] = v;
    }
  }
  return filtered;
}

export type InventoryHealthItem = ExpectedKey & {
  stock: number | null;
  configured: boolean;
  lowStockThreshold: number;
};

export type MisconfiguredActiveSku = {
  skuId: string;
  skuName: string;
  name: string;
  variantSlug: string;
  stock: number | null;
  reason: "MISSING_INVENTORY_ROW" | "ACTIVE_ZERO_STOCK" | "BUNDLE_COMPONENT_OOS";
  detail: string;
};

export type InventoryHealth = {
  /** True only when every orderable variant has an inventory row. */
  ok: boolean;
  expectedCount: number;
  configuredCount: number;
  totalUnits: number;
  items: InventoryHealthItem[];
  /** Orderable variants with NO inventory row → checkout fails for these. */
  missing: InventoryHealthItem[];
  soldOut: InventoryHealthItem[];
  lowStock: InventoryHealthItem[];
  /** Active storefront SKUs that are missing DB rows, at 0 stock across all variants, or bundles with OOS components. */
  misconfiguredActive: MisconfiguredActiveSku[];
  /** Inventory rows for SKUs/variants no longer in the catalog. */
  orphanKeys: string[];
};

/**
 * Compare the orderable catalog against the inventory table. Surfaces missing
 * rows (the bootstrap-safety hazard — checkout rejects these), sold-out and
 * low-stock variants, active SKUs with 0 stock or broken bundle components,
 * and orphan rows. Powers the admin health page and /api/health/inventory.
 */
export async function getInventoryHealth(
  siteIdOrIds: string | string[] = INVENTORY_SITE_ID,
): Promise<InventoryHealth> {
  const siteId = Array.isArray(siteIdOrIds)
    ? siteIdOrIds[0] ?? INVENTORY_SITE_ID
    : siteIdOrIds;
  const expected = expectedInventoryKeys(siteId);
  const [rows, overrideMap] = await Promise.all([
    db
      .select({
        skuId: inventory.skuId,
        variantSlug: inventory.variantSlug,
        stock: inventory.stock,
      })
      .from(inventory)
      .where(eq(inventory.siteId, siteId)),
    getOverrideMap([siteId]),
  ]);

  const rowMap = new Map(rows.map((r) => [`${r.skuId}:${r.variantSlug}`, r.stock]));
  const mergedSkus = applyOverrides(PRODUCTS, overrideMap);
  const skuById = new Map(mergedSkus.map((s) => [s.id, s]));

  const items: InventoryHealthItem[] = expected.map((e) => {
    const stock = rowMap.has(e.key) ? (rowMap.get(e.key) as number) : null;
    const sku = skuById.get(e.skuId);
    const threshold = Math.max(1, sku?.lowStockThreshold ?? LOW_STOCK_THRESHOLD);
    return {
      ...e,
      stock,
      configured: stock !== null,
      lowStockThreshold: threshold,
    };
  });

  const missing = items.filter((i) => !i.configured);
  const soldOut = items.filter((i) => i.configured && (i.stock ?? 0) <= 0);
  const lowStock = items.filter(
    (i) => i.configured && (i.stock ?? 0) > 0 && (i.stock ?? 0) <= i.lowStockThreshold,
  );

  // Detect active storefront SKUs that are misconfigured or unavailable
  const misconfiguredActive: MisconfiguredActiveSku[] = [];
  for (const sku of mergedSkus) {
    if (sku.hidden || sku.internal || sku.comingSoon || sku.discontinued) continue;
    const skuItems = items.filter((i) => i.skuId === sku.id);
    const firstMissing = skuItems.find((i) => !i.configured);
    if (firstMissing) {
      misconfiguredActive.push({
        skuId: sku.id,
        skuName: sku.name,
        name: sku.name,
        variantSlug: firstMissing.variantSlug,
        stock: null,
        reason: "MISSING_INVENTORY_ROW",
        detail: "Missing DB inventory row(s) — blocked from purchase until seeded.",
      });
      continue;
    }
    const totalSkuStock = skuItems.reduce((sum, i) => sum + Math.max(0, i.stock ?? 0), 0);
    if (totalSkuStock <= 0 && !sku.preorder) {
      misconfiguredActive.push({
        skuId: sku.id,
        skuName: sku.name,
        name: sku.name,
        variantSlug: skuItems[0]?.variantSlug ?? "",
        stock: 0,
        reason: "ACTIVE_ZERO_STOCK",
        detail: "Active catalog SKU has 0 total units across all variants (showing SOLD OUT).",
      });
      continue;
    }
    const compIds = getBundleComponentSkuIds(sku);
    if (compIds.length > 0 && totalSkuStock > 0) {
      for (const compId of compIds) {
        const compStock = items
          .filter((i) => i.skuId === compId)
          .reduce((sum, i) => sum + Math.max(0, i.stock ?? 0), 0);
        if (compStock <= 0) {
          misconfiguredActive.push({
            skuId: sku.id,
            skuName: sku.name,
            name: sku.name,
            variantSlug: "",
            stock: totalSkuStock,
            reason: "BUNDLE_COMPONENT_OOS",
            detail: `Bundle has ${totalSkuStock} units configured, but component '${compId}' has 0 stock.`,
          });
          break;
        }
      }
    }
  }

  const expectedKeySet = new Set(expected.map((e) => e.key));
  const orphanKeys = rows
    .map((r) => `${r.skuId}:${r.variantSlug}`)
    .filter((k) => !expectedKeySet.has(k));

  const totalUnits = rows.reduce((s, r) => s + r.stock, 0);

  return {
    ok: missing.length === 0,
    expectedCount: expected.length,
    configuredCount: items.filter((i) => i.configured).length,
    totalUnits,
    items,
    missing,
    soldOut,
    lowStock,
    misconfiguredActive,
    orphanKeys,
  };
}
