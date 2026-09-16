/**
 * Admin product read model — ONE shape for every admin product surface (list,
 * control centre, editor). It merges:
 *   • the code catalogue (src/lib/products.ts) with admin overrides
 *     (product_overrides) — exactly what the storefront and checkout see;
 *   • live stock from `inventory`, the single source of truth;
 *   • admin-created drafts from `products` / `product_variants` (admin-only).
 * Server-only (imports the DB). Every read degrades gracefully: a missing
 * table or column yields "no data", never a crashed page.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  inventory,
  productOverrides,
  products as draftTable,
  productVariants as draftVariantTable,
} from "@/db/schema";
import { PRODUCTS, getProductById, pdpSpecRows, type Sku } from "@/lib/products";
import { HUB_CATEGORIES } from "@/lib/hub-categories";
import { applyOverride, type ProductOverride } from "@/lib/product-overrides";
import { PAID_STATUSES } from "@/lib/order-status";
import { LOW_STOCK_THRESHOLD } from "@/lib/stock-threshold";
import { formatINR } from "@/lib/utils";
import { PRODUCT_STATUS_META, type ProductStatus, type Tone } from "@/lib/admin/status";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Drafts are keyed by uuid; code SKUs by their slug-like id — never ambiguous. */
export function isDraftId(id: string): boolean {
  return UUID_RE.test(id);
}

export const PRODUCT_CATEGORIES = HUB_CATEGORIES.map((c) => ({ key: c.key, label: c.label, img: c.img }));
const CATEGORY_LABEL = new Map(PRODUCT_CATEGORIES.map((c) => [c.key, c.label]));

/** Slugs/ids owned by the code catalogue — drafts may not reuse them. */
export function reservedProductSlugs(): string[] {
  return [...new Set(PRODUCTS.flatMap((p) => [p.slug, p.id]))];
}

export function categoryLabel(key: string | null | undefined): string {
  return (key && CATEGORY_LABEL.get(key)) || "Uncategorised";
}

/** Same taxonomy as the storefront hub: polo/construction explicit, else by scale. */
export function categoryKeyOf(sku: Sku): string {
  if (sku.category === "polo") return "polo";
  if (sku.category === "construction") return "construction";
  if (sku.scale === "1:16") return "big16";
  if (sku.scale === "1:20") return "s20";
  return "mini64";
}

/** Storefront status of a (possibly overridden) code SKU. */
export function skuStatus(p: Sku): ProductStatus {
  if (p.hidden) return "hidden";
  if (p.comingSoon) return "coming";
  return "active";
}

export type AdminVariant = {
  slug: string;
  name: string;
  swatch: string | null;
  image: string | null;
  sku: string | null;
  priceInr: number | null;
  /** Live inventory (catalogue) or opening stock (draft); null = no inventory row. */
  stock: number | null;
};

export type AdminProduct = {
  id: string;
  source: "catalogue" | "draft";
  slug: string;
  name: string;
  image: string | null;
  scale: string;
  categoryKey: string;
  categoryLabel: string;
  priceInr: number;
  mrpInr: number;
  status: ProductStatus;
  badge: string | null;
  variants: AdminVariant[];
  /** Summed variant stock; null when no variant has data. */
  stock: number | null;
  /** "live" = inventory table · "opening" = a draft's planned stock. */
  stockKind: "live" | "opening";
  lowThreshold: number;
  lowCount: number;
  outCount: number;
  overridden: boolean;
  internal: boolean;
  /** Public product page when it's reachable on the storefront, else null. */
  storefrontPath: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Catalogue order (drafts sort after the code catalogue). */
  position: number;
};

type OverrideRow = ProductOverride & { updatedAt: Date; updatedBy: string | null };

async function loadOverrides(siteIds: string[], skuId?: string): Promise<Map<string, OverrideRow>> {
  if (siteIds.length === 0) return new Map();
  try {
    const rows = await db
      .select({
        skuId: productOverrides.skuId,
        priceInr: productOverrides.priceInr,
        mrpInr: productOverrides.mrpInr,
        hidden: productOverrides.hidden,
        comingSoon: productOverrides.comingSoon,
        badge: productOverrides.badge,
        updatedAt: productOverrides.updatedAt,
        updatedBy: productOverrides.updatedBy,
      })
      .from(productOverrides)
      .where(
        skuId
          ? and(inArray(productOverrides.siteId, siteIds), eq(productOverrides.skuId, skuId))
          : inArray(productOverrides.siteId, siteIds),
      );
    return new Map(rows.map((r) => [r.skuId, r]));
  } catch {
    return new Map();
  }
}

/** sku → (variantSlug → stock). A missing key means "no inventory row". */
async function loadStock(siteIds: string[], skuId?: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (siteIds.length === 0) return out;
  const rows = await db
    .select({ skuId: inventory.skuId, variantSlug: inventory.variantSlug, stock: inventory.stock })
    .from(inventory)
    .where(skuId ? and(inArray(inventory.siteId, siteIds), eq(inventory.skuId, skuId)) : inArray(inventory.siteId, siteIds));
  for (const r of rows) {
    const m = out.get(r.skuId) ?? new Map<string, number>();
    m.set(r.variantSlug, (m.get(r.variantSlug) ?? 0) + r.stock);
    out.set(r.skuId, m);
  }
  return out;
}

function summarise(variants: AdminVariant[], threshold: number) {
  const known = variants.filter((v) => v.stock !== null) as (AdminVariant & { stock: number })[];
  return {
    stock: known.length ? known.reduce((s, v) => s + v.stock, 0) : null,
    lowCount: known.filter((v) => v.stock > 0 && v.stock <= threshold).length,
    outCount: known.filter((v) => v.stock <= 0).length,
  };
}

function toCatalogueProduct(
  base: Sku,
  ov: OverrideRow | undefined,
  stock: Map<string, number> | undefined,
  position: number,
): AdminProduct {
  const sku = applyOverride(base, ov);
  const variants: AdminVariant[] = sku.colors?.length
    ? sku.colors.map((c) => ({
        slug: c.slug,
        name: c.name,
        swatch: c.swatch,
        image: c.image ?? null,
        sku: null,
        priceInr: null,
        stock: stock?.has(c.slug) ? (stock.get(c.slug) as number) : null,
      }))
    : [
        {
          slug: "",
          name: "Default",
          swatch: null,
          image: sku.heroImage ?? null,
          sku: null,
          priceInr: null,
          stock: stock?.has("") ? (stock.get("") as number) : null,
        },
      ];
  const key = categoryKeyOf(sku);
  const status = skuStatus(sku);
  return {
    id: sku.id,
    source: "catalogue",
    slug: sku.slug,
    name: sku.name,
    image: sku.heroImage ?? null,
    scale: sku.scale,
    categoryKey: key,
    categoryLabel: categoryLabel(key),
    priceInr: sku.retailINR,
    mrpInr: sku.mrpINR,
    status,
    badge: sku.badge ?? null,
    variants,
    ...summarise(variants, LOW_STOCK_THRESHOLD),
    stockKind: "live",
    lowThreshold: LOW_STOCK_THRESHOLD,
    overridden: !!ov,
    internal: !!sku.internal,
    storefrontPath:
      status === "active" && !sku.bundle ? (sku.scale === "1:16" ? `/16/${sku.slug}` : `/product/${sku.slug}`) : null,
    updatedAt: ov?.updatedAt ? new Date(ov.updatedAt).toISOString() : null,
    updatedBy: ov?.updatedBy ?? null,
    position,
  };
}

type DraftRow = typeof draftTable.$inferSelect;
type DraftVariantRow = typeof draftVariantTable.$inferSelect;

async function loadDraftRows(
  siteIds: string[],
  id?: string,
): Promise<{ available: boolean; products: DraftRow[]; variants: DraftVariantRow[] }> {
  if (siteIds.length === 0) return { available: true, products: [], variants: [] };
  try {
    const products = await db
      .select()
      .from(draftTable)
      .where(id ? and(inArray(draftTable.siteId, siteIds), eq(draftTable.id, id)) : inArray(draftTable.siteId, siteIds))
      .orderBy(desc(draftTable.updatedAt));
    const variants = products.length
      ? await db
          .select()
          .from(draftVariantTable)
          .where(inArray(draftVariantTable.productId, products.map((p) => p.id)))
          .orderBy(draftVariantTable.sortOrder)
      : [];
    return { available: true, products, variants };
  } catch {
    // Table/columns missing until the 2026-09-15 migration is applied.
    return { available: false, products: [], variants: [] };
  }
}

function draftStatus(s: string): ProductStatus {
  return s in PRODUCT_STATUS_META ? (s as ProductStatus) : "draft";
}

function toDraftProduct(p: DraftRow, vs: DraftVariantRow[], position: number): AdminProduct {
  const variants: AdminVariant[] = vs.map((v) => ({
    slug: v.slug,
    name: v.name,
    swatch: v.swatch,
    image: v.image,
    sku: v.sku,
    priceInr: v.priceInrOverride,
    stock: v.openingStock,
  }));
  return {
    id: p.id,
    source: "draft",
    slug: p.slug,
    name: p.name,
    image: p.heroImage,
    scale: p.scale ?? "—",
    categoryKey: p.category ?? "",
    categoryLabel: categoryLabel(p.category),
    priceInr: p.priceInr,
    mrpInr: p.mrpInr,
    status: draftStatus(p.status),
    badge: p.badge,
    variants,
    ...summarise(variants, p.lowStockThreshold),
    stockKind: "opening",
    lowThreshold: p.lowStockThreshold,
    overridden: false,
    internal: false,
    storefrontPath: null,
    updatedAt: p.updatedAt.toISOString(),
    updatedBy: p.updatedBy,
    position,
  };
}

export async function loadAdminProducts(
  siteIds: string[],
): Promise<{ products: AdminProduct[]; draftsAvailable: boolean }> {
  const [overrides, stock, drafts] = await Promise.all([
    loadOverrides(siteIds),
    loadStock(siteIds),
    loadDraftRows(siteIds),
  ]);
  const catalogue = PRODUCTS.map((p, i) => toCatalogueProduct(p, overrides.get(p.id), stock.get(p.id), i));
  const byProduct = new Map<string, DraftVariantRow[]>();
  for (const v of drafts.variants) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), v]);
  const draftProducts = drafts.products.map((p, i) =>
    toDraftProduct(p, byProduct.get(p.id) ?? [], PRODUCTS.length + i),
  );
  return { products: [...catalogue, ...draftProducts], draftsAvailable: drafts.available };
}

/** Whether the draft columns exist yet (drives the "Add product" setup notice). */
export async function draftsAvailable(): Promise<boolean> {
  try {
    await db.select({ id: draftTable.id, status: draftTable.status }).from(draftTable).limit(1);
    return true;
  } catch {
    return false;
  }
}

// ── Detail ────────────────────────────────────────────────────────────────

export type SpecItem = { label: string; value: string };

export type ProductDetail = AdminProduct & {
  tagline: string;
  highlights: string[];
  description: string;
  images: string[];
  specs: SpecItem[];
  costInr: number | null;
  tags: string[];
  trackInventory: boolean;
  /** Code catalogue values before overrides (catalogue products only). */
  base: { priceInr: number; mrpInr: number; status: ProductStatus; badge: string | null } | null;
  createdAt: string | null;
  createdBy: string | null;
};

function specsOf(sku: Sku): SpecItem[] {
  // Same rows the storefront PDP shows, so admin and product page never disagree.
  return pdpSpecRows(sku);
}

export async function loadProductDetail(id: string, siteIds: string[]): Promise<ProductDetail | null> {
  if (isDraftId(id)) {
    const drafts = await loadDraftRows(siteIds, id);
    const p = drafts.products[0];
    if (!p) return null;
    const row = toDraftProduct(p, drafts.variants, 0);
    return {
      ...row,
      tagline: p.tagline ?? "",
      highlights: p.bullets,
      description: p.description ?? "",
      images: [p.heroImage, ...p.altImages].filter((x): x is string => !!x),
      specs: [],
      costInr: p.landingCostInr,
      tags: p.tags,
      trackInventory: p.trackInventory,
      base: null,
      createdAt: p.createdAt.toISOString(),
      createdBy: p.createdBy,
    };
  }

  const base = getProductById(id);
  if (!base) return null;
  const [overrides, stock] = await Promise.all([loadOverrides(siteIds, id), loadStock(siteIds, id)]);
  const row = toCatalogueProduct(base, overrides.get(id), stock.get(id), 0);
  const images = [base.heroImage, ...base.altImages, ...(base.colors ?? []).map((c) => c.image ?? "")].filter(
    (x, i, all): x is string => !!x && all.indexOf(x) === i,
  );
  return {
    ...row,
    tagline: base.tagline,
    highlights: [...base.bullets],
    description: base.bullets.join(" · "),
    images,
    specs: specsOf(base),
    costInr: null,
    tags: [],
    trackInventory: true,
    base: {
      priceInr: base.retailINR,
      mrpInr: base.mrpINR,
      status: skuStatus(base),
      badge: base.badge ?? null,
    },
    createdAt: null,
    createdBy: null,
  };
}

/** Units + revenue from PAID orders over the last N days (catalogue products). */
export async function loadProductSales(
  skuId: string,
  siteIds: string[],
  days = 30,
): Promise<{ units: number; revenue: number } | null> {
  if (siteIds.length === 0) return { units: 0, revenue: 0 };
  const siteArr = sql`array[${sql.join(siteIds.map((s) => sql`${s}`), sql`, `)}]::text[]`;
  const paidArr = sql`array[${sql.join(PAID_STATUSES.map((s) => sql`${s}`), sql`, `)}]::text[]`;
  try {
    const rows = (await db.execute(sql`
      SELECT
        coalesce(sum(nullif(it->>'qty', '')::numeric), 0)::int AS units,
        coalesce(sum(nullif(it->>'qty', '')::numeric * nullif(it->>'unitPriceInr', '')::numeric), 0)::int AS revenue
      FROM orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END
      ) AS it
      WHERE o.site_id = ANY(${siteArr})
        AND o.status::text = ANY(${paidArr})
        AND o.placed_at >= now() - make_interval(days => ${days}::int)
        AND it->>'skuId' = ${skuId}
    `)) as unknown as Array<{ units: number; revenue: number }>;
    return { units: Number(rows[0]?.units ?? 0), revenue: Number(rows[0]?.revenue ?? 0) };
  } catch {
    return null;
  }
}

// ── Activity ──────────────────────────────────────────────────────────────

export const PRODUCT_EVENT_TYPES = [
  "INVENTORY_ADMIN_SET",
  "INVENTORY_ADMIN_ADJUST",
  "PRODUCT_OVERRIDE_SAVED",
  "PRODUCT_OVERRIDE_CLEARED",
  "PRODUCT_VISIBILITY_BULK",
  "PRODUCT_DRAFT_CREATED",
  "PRODUCT_DRAFT_UPDATED",
  "PRODUCT_DRAFT_STATUS",
] as const;

export type ProductActivity = {
  id: string;
  at: string;
  by: string | null;
  title: string;
  detail: string | null;
  tone: Tone;
};

type Change = { label: string; from: string; to: string };

function describe(
  e: { id: string; type: string; payload: unknown; createdAt: Date },
  variantName: (slug: string) => string,
): ProductActivity {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const by = typeof p.by === "string" ? p.by : null;
  const base = { id: e.id, at: e.createdAt.toISOString(), by };
  const v = typeof p.variantSlug === "string" ? variantName(p.variantSlug) : "";
  const changes = Array.isArray(p.changes) ? (p.changes as Change[]) : [];
  const changeText = changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(" · ") || null;
  switch (e.type) {
    case "INVENTORY_ADMIN_SET":
      return { ...base, title: "Stock set", detail: `${v}: ${p.before ?? "—"} → ${p.after}`, tone: "info" };
    case "INVENTORY_ADMIN_ADJUST": {
      const delta = Number(p.value ?? 0);
      return {
        ...base,
        title: delta >= 0 ? "Stock added" : "Stock removed",
        detail: `${v}: ${delta >= 0 ? "+" : ""}${delta} (${p.before ?? 0} → ${p.after})`,
        tone: delta >= 0 ? "positive" : "attention",
      };
    }
    case "PRODUCT_OVERRIDE_SAVED":
      return { ...base, title: "Product updated", detail: changeText, tone: "info" };
    case "PRODUCT_OVERRIDE_CLEARED":
      return { ...base, title: "Reset to catalogue values", detail: null, tone: "neutral" };
    case "PRODUCT_VISIBILITY_BULK": {
      const s = String(p.visibility ?? "");
      const label = s in PRODUCT_STATUS_META ? PRODUCT_STATUS_META[s as ProductStatus].label : s;
      return { ...base, title: `Status set to ${label}`, detail: "Bulk update", tone: "info" };
    }
    case "PRODUCT_DRAFT_CREATED":
      return { ...base, title: "Draft created", detail: null, tone: "positive" };
    case "PRODUCT_DRAFT_UPDATED":
      return { ...base, title: "Draft updated", detail: changeText, tone: "info" };
    case "PRODUCT_DRAFT_STATUS": {
      const s = String(p.status ?? "");
      const label = s in PRODUCT_STATUS_META ? PRODUCT_STATUS_META[s as ProductStatus].label : s;
      return { ...base, title: `Status set to ${label}`, detail: null, tone: s === "archived" ? "neutral" : "info" };
    }
    default:
      return { ...base, title: e.type, detail: null, tone: "neutral" };
  }
}

export async function loadProductActivity(
  product: Pick<AdminProduct, "id" | "variants">,
  siteIds: string[],
  limit = 30,
): Promise<ProductActivity[]> {
  if (siteIds.length === 0) return [];
  const names = new Map(product.variants.map((v) => [v.slug, v.name]));
  try {
    const rows = await db
      .select({ id: events.id, type: events.type, payload: events.payload, createdAt: events.createdAt })
      .from(events)
      .where(
        and(
          inArray(events.type, [...PRODUCT_EVENT_TYPES]),
          sql`(${events.siteId} IS NULL OR ${inArray(events.siteId, siteIds)})`,
          sql`(${events.payload}->>'skuId' = ${product.id}
               OR ${events.payload}->>'productId' = ${product.id}
               OR ${events.payload}->'skuIds' @> ${JSON.stringify([product.id])}::jsonb)`,
        ),
      )
      .orderBy(desc(events.createdAt))
      .limit(limit);
    return rows.map((e) => describe(e, (slug) => names.get(slug) ?? (slug || "Default")));
  } catch {
    return [];
  }
}

/** "₹1,199" for change logs. */
export const inr = (n: number | null | undefined) => (n == null ? "—" : formatINR(n));
