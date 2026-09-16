/**
 * Validation for admin-created (draft) products — shared by the editor (live
 * field errors) and the server actions (authoritative). Pure: safe in client
 * code. Category keys and reserved slugs are injected so the client never has
 * to import the catalogue.
 */

import { z } from "zod";
import type { Scale } from "@/lib/products";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PRODUCT_SCALES = ["1:64", "1:43", "1:24", "1:20", "1:16"] as const satisfies readonly Scale[];

export const PRODUCT_BADGES = ["NEW", "BESTSELLER", "MOST GIFTED", "PRO"] as const;

/** Statuses an admin draft can hold until storefront publishing exists. */
export const DRAFT_STATUSES = ["draft", "archived"] as const;

export const MAX_IMAGES = 12;
export const MAX_VARIANTS = 20;
export const MAX_HIGHLIGHTS = 6;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const money = z.number().int().min(0).max(1_000_000);

const variantSchema = z.object({
  name: z.string().trim().min(1, "Name the variant").max(40),
  slug: z.string().regex(SLUG_RE, "Variant names need at least one letter or number").max(40),
  swatch: z.string().trim().max(80).nullable(),
  sku: z.string().trim().max(40).nullable(),
  priceInr: money.nullable(),
  openingStock: z.number().int().min(0, "Stock can't be negative").max(100_000),
  image: z.string().trim().max(500).nullable(),
});

export function draftProductSchema(opts: { categoryKeys: readonly string[]; reservedSlugs: readonly string[] }) {
  return z
    .object({
      name: z.string().trim().min(2, "Give the product a name").max(120),
      slug: z
        .string()
        .trim()
        .min(2, "Add a URL slug")
        .max(80)
        .regex(SLUG_RE, "Lowercase letters, numbers and dashes only")
        .refine((s) => !opts.reservedSlugs.includes(s), "A catalogue product already uses this slug"),
      tagline: z.string().trim().max(140),
      description: z.string().trim().max(4000),
      highlights: z.array(z.string().trim().max(120)).max(MAX_HIGHLIGHTS),
      category: z.string().refine((k) => opts.categoryKeys.includes(k), "Pick a category"),
      scale: z.enum(PRODUCT_SCALES),
      badge: z.enum(PRODUCT_BADGES).nullable(),
      tags: z.array(z.string().trim().toLowerCase().min(1).max(24)).max(10),
      priceInr: money.min(1, "Price must be at least ₹1"),
      mrpInr: money,
      costInr: money.nullable(),
      images: z.array(z.string().trim().max(500)).max(MAX_IMAGES),
      trackInventory: z.boolean(),
      lowStockThreshold: z.number().int().min(0).max(1000),
      status: z.enum(DRAFT_STATUSES),
      variants: z.array(variantSchema).max(MAX_VARIANTS),
    })
    .superRefine((v, ctx) => {
      if (v.mrpInr < v.priceInr)
        ctx.addIssue({ code: "custom", path: ["mrpInr"], message: "MRP can't be lower than the selling price" });
      const seen = new Set<string>();
      v.variants.forEach((variant, i) => {
        if (seen.has(variant.slug))
          ctx.addIssue({ code: "custom", path: ["variants", i, "name"], message: "Two variants have the same name" });
        seen.add(variant.slug);
      });
      v.images.forEach((url, i) => {
        if (!/^(https:\/\/|\/)/.test(url))
          ctx.addIssue({ code: "custom", path: ["images", i], message: "Use an https:// URL or a /path" });
      });
    });
}

export type DraftProductInput = z.infer<ReturnType<typeof draftProductSchema>>;

/** Flatten zod issues to { "variants.0.name": "message" } (first message wins). */
export function fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".");
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

/** Catalogue (code) products: only price/MRP are validated client-side. */
export function priceErrors(price: number | null, mrp: number | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (price === null || price < 0 || price > 1_000_000) out.priceInr = "Enter a price between ₹0 and ₹10,00,000";
  if (mrp === null || mrp < 0 || mrp > 1_000_000) out.mrpInr = "Enter an MRP between ₹0 and ₹10,00,000";
  else if (price !== null && mrp < price) out.mrpInr = "MRP can't be lower than the selling price";
  return out;
}
