/**
 * Editor value model shared by the server pages (which build the initial
 * values) and the client editor. Pure — no hooks, no DB — so server components
 * can call these builders.
 */

import type { ProductDetail } from "@/lib/admin/catalog";
import type { ProductStatus } from "@/lib/admin/status";
import { slugify } from "@/lib/admin/product-schema";

/** catalogue = code SKU (overrides + stock) · draft = existing DB draft · create = new draft. */
export type EditorMode = "catalogue" | "draft" | "create";

export type EditorVariant = {
  key: string;
  name: string;
  slug: string;
  swatch: string;
  sku: string;
  priceInr: string;
  /** Live stock (catalogue) or opening stock (draft), as typed. */
  stock: string;
  image: string;
};

export type EditorValues = {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  highlights: string[];
  category: string;
  scale: string;
  badge: string;
  tags: string[];
  priceInr: string;
  mrpInr: string;
  costInr: string;
  images: string[];
  trackInventory: boolean;
  lowStockThreshold: string;
  status: ProductStatus;
  variants: EditorVariant[];
};

export function toInt(s: string): number | null {
  const digits = s.replace(/[^\d]/g, "");
  return digits === "" ? null : parseInt(digits, 10);
}

export function toEditorValues(p: ProductDetail): EditorValues {
  return {
    name: p.name,
    slug: p.slug,
    tagline: p.tagline,
    description: p.source === "draft" ? p.description : "",
    highlights: p.highlights.length ? p.highlights : [""],
    category: p.categoryKey,
    scale: p.scale,
    badge: p.badge ?? "",
    tags: p.tags,
    priceInr: String(p.priceInr),
    mrpInr: String(p.mrpInr),
    costInr: p.costInr == null ? "" : String(p.costInr),
    images: p.images,
    trackInventory: p.trackInventory,
    lowStockThreshold: String(p.lowThreshold),
    status: p.status,
    variants: p.variants.map((v, i) => ({
      key: `v${i}-${v.slug}`,
      name: v.name,
      slug: v.slug,
      swatch: v.swatch ?? "",
      sku: v.sku ?? "",
      priceInr: v.priceInr == null ? "" : String(v.priceInr),
      stock: v.stock == null ? "" : String(v.stock),
      image: v.image ?? "",
    })),
  };
}

export function emptyEditorValues(category: string): EditorValues {
  return {
    name: "",
    slug: "",
    tagline: "",
    description: "",
    highlights: [""],
    category,
    scale: "1:64",
    badge: "",
    tags: [],
    priceInr: "",
    mrpInr: "",
    costInr: "",
    images: [],
    trackInventory: true,
    lowStockThreshold: "5",
    status: "draft",
    variants: [],
  };
}

/** Editor values → the draft action payload (validated by draftProductSchema). */
export function toDraftPayload(v: EditorValues) {
  return {
    name: v.name,
    slug: v.slug,
    tagline: v.tagline,
    description: v.description,
    highlights: v.highlights.map((h) => h.trim()).filter(Boolean),
    category: v.category,
    scale: v.scale,
    badge: v.badge || null,
    tags: v.tags,
    priceInr: toInt(v.priceInr) ?? 0,
    mrpInr: toInt(v.mrpInr) ?? 0,
    costInr: toInt(v.costInr),
    images: v.images,
    trackInventory: v.trackInventory,
    lowStockThreshold: toInt(v.lowStockThreshold) ?? 0,
    status: v.status,
    variants: v.variants.map((x) => ({
      name: x.name,
      slug: slugify(x.name),
      swatch: x.swatch || null,
      sku: x.sku.trim() || null,
      priceInr: toInt(x.priceInr),
      openingStock: toInt(x.stock) ?? 0,
      image: x.image || null,
    })),
  };
}
