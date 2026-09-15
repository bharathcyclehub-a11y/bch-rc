/**
 * Inventory read helpers — the DB `inventory` table is the SINGLE SOURCE OF
 * TRUTH for stock. The storefront (PDP, grid) reads live stock from here via
 * /api/stock; src/lib/products.ts `colors[].stock` is now SEED-ONLY (consumed
 * by db/seed-inventory.ts) and must never drive UI or order decisions.
 *
 * This module is read-only on purpose. Stock DECREMENT lives in the order-create
 * transaction and stock RESTORE lives in the order lifecycle (holdsReleased /
 * reconciliation) — this file does not duplicate that logic.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inventory } from "@/db/schema";
import { PRODUCTS } from "@/lib/products";
import { LOW_STOCK_THRESHOLD } from "@/lib/stock-threshold";

export const INVENTORY_SITE_ID = "prc";

/**
 * ONE single inventory (2026-07-08). The old per-store split (1:16 under
 * "prc16", everything else under "prc") is gone — the hub is the single
 * storefront and every inventory row lives under "prc". The prc16 rows were
 * re-keyed to prc in the same change; seed + decrement + restore all target
 * this one keyspace.
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
    // Single inventory: every SKU lives under INVENTORY_SITE_ID, so a site
    // scope other than the hub site expects nothing.
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
 * Live stock per `${skuId}:${variantSlug}` from the DB — the single source of
 * truth. Optionally filter to specific SKUs. A key that is absent from the
 * returned map means "no inventory row configured" (callers treat as 0/unknown).
 */
export async function getStockMap(skuIds?: string[]): Promise<Record<string, number>> {
  const rows = await db
    .select({
      skuId: inventory.skuId,
      variantSlug: inventory.variantSlug,
      stock: inventory.stock,
    })
    .from(inventory)
    .where(
      skuIds && skuIds.length > 0
        ? and(
            eq(inventory.siteId, INVENTORY_SITE_ID),
            inArray(inventory.skuId, skuIds),
          )
        : eq(inventory.siteId, INVENTORY_SITE_ID),
    );

  const map: Record<string, number> = {};
  for (const r of rows) map[`${r.skuId}:${r.variantSlug}`] = r.stock;
  return map;
}

export type InventoryHealthItem = ExpectedKey & {
  stock: number | null;
  configured: boolean;
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
  /** Inventory rows for SKUs/variants no longer in the catalog. */
  orphanKeys: string[];
};

/**
 * Compare the orderable catalog against the inventory table. Surfaces missing
 * rows (the bootstrap-safety hazard — checkout rejects these), sold-out and
 * low-stock variants, and orphan rows. Powers the admin health page and the
 * /api/health/inventory monitor endpoint.
 */
export async function getInventoryHealth(
  siteId: string = INVENTORY_SITE_ID,
): Promise<InventoryHealth> {
  const expected = expectedInventoryKeys(siteId);
  const rows = await db
    .select({
      skuId: inventory.skuId,
      variantSlug: inventory.variantSlug,
      stock: inventory.stock,
    })
    .from(inventory)
    .where(eq(inventory.siteId, siteId));

  const rowMap = new Map(rows.map((r) => [`${r.skuId}:${r.variantSlug}`, r.stock]));

  const items: InventoryHealthItem[] = expected.map((e) => {
    const stock = rowMap.has(e.key) ? (rowMap.get(e.key) as number) : null;
    return { ...e, stock, configured: stock !== null };
  });

  const missing = items.filter((i) => !i.configured);
  const soldOut = items.filter((i) => i.configured && (i.stock ?? 0) <= 0);
  const lowStock = items.filter(
    (i) => i.configured && (i.stock ?? 0) > 0 && (i.stock ?? 0) <= LOW_STOCK_THRESHOLD,
  );

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
    orphanKeys,
  };
}
