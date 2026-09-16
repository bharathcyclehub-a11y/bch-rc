"use server";

/**
 * Product list + draft actions.
 *  - Catalogue (code) products only change through product_overrides (status
 *    here; price/MRP/badge in [id]/actions.ts) and the inventory API — the same
 *    seams the storefront and checkout read.
 *  - Drafts live in products / product_variants and are ADMIN-ONLY until
 *    storefront publishing exists; they can be created, edited, archived and
 *    (owners only, typed confirmation) permanently deleted.
 * Every write is site-guarded and leaves an `events` audit row.
 */

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, productOverrides, products as draftTable, productVariants as draftVariantTable } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { getProductById } from "@/lib/products";
import { INVENTORY_SITE_ID, siteIdForSku } from "@/lib/inventory";
import { HUB_CATEGORIES } from "@/lib/hub-categories";
import { draftProductSchema, fieldErrors, type DraftProductInput } from "@/lib/admin/product-schema";
import { categoryLabel, inr, isDraftId, reservedProductSlugs } from "@/lib/admin/catalog";
import { PRODUCT_STATUS_META } from "@/lib/admin/status";

type Result = { ok: true } | { ok: false; error: string };
export type SaveDraftResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const RESERVED_SLUGS = reservedProductSlugs();
const CATEGORY_KEYS = HUB_CATEGORIES.map((c) => c.key);
/** Drafts live in the single hub keyspace, like inventory. */
const DRAFT_SITE = INVENTORY_SITE_ID;

async function audit(siteId: string | null, type: string, payload: Record<string, unknown>) {
  try {
    await db.insert(events).values({ siteId, type, payload, source: "admin" });
  } catch {
    // The audit trail must never fail the write it describes.
  }
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

const NOT_MIGRATED =
  "Product drafts aren't set up yet — apply src/db/migrations/manual/2026-09-15_admin_product_drafts.sql in Supabase.";

function revalidateProducts(ids: string[] = []) {
  revalidatePath("/admin/products");
  for (const id of ids) revalidatePath(`/admin/products/${id}`);
}

// ── Catalogue status (bulk + single) ──────────────────────────────────────

export async function setCatalogueVisibility(
  skuIds: string[],
  visibility: "active" | "coming" | "hidden",
): Promise<Result> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "products.edit")) return { ok: false, error: "You don't have permission to change products." };
  if (!["active", "coming", "hidden"].includes(visibility)) return { ok: false, error: "Unknown status." };

  const ids = [...new Set(skuIds)].filter((id) => getProductById(id));
  if (ids.length === 0) return { ok: false, error: "No catalogue products selected." };

  const bySite = new Map<string, string[]>();
  for (const id of ids) {
    const siteId = siteIdForSku(id);
    if (!ctx.siteIds.includes(siteId)) return { ok: false, error: "Not allowed for this store." };
    bySite.set(siteId, [...(bySite.get(siteId) ?? []), id]);
  }

  const hidden = visibility === "hidden";
  const comingSoon = visibility === "coming";
  try {
    for (const [siteId, list] of bySite) {
      // Only the two visibility columns change — price/MRP/badge overrides stay.
      await db
        .insert(productOverrides)
        .values(list.map((skuId) => ({ siteId, skuId, hidden, comingSoon, updatedBy: ctx.email })))
        .onConflictDoUpdate({
          target: [productOverrides.siteId, productOverrides.skuId],
          set: { hidden, comingSoon, updatedAt: new Date(), updatedBy: ctx.email },
        });
      await audit(siteId, "PRODUCT_VISIBILITY_BULK", { skuIds: list, visibility, by: ctx.email });
    }
  } catch {
    return { ok: false, error: "Couldn't update — the product_overrides table may be missing." };
  }

  revalidateProducts(ids);
  for (const id of ids) revalidatePath(`/product/${getProductById(id)?.slug}`);
  revalidatePath("/");
  return { ok: true };
}

// ── Drafts ────────────────────────────────────────────────────────────────

function productColumns(input: DraftProductInput) {
  return {
    slug: input.slug,
    name: input.name,
    tagline: input.tagline || null,
    bullets: input.highlights.filter(Boolean),
    badge: input.badge,
    heroImage: input.images[0] ?? null,
    altImages: input.images.slice(1),
    priceInr: input.priceInr,
    mrpInr: input.mrpInr,
    landingCostInr: input.costInr,
    // Belt and braces: any future reader that ignores `status` still hides drafts.
    hidden: true,
    status: input.status,
    category: input.category,
    scale: input.scale,
    description: input.description || null,
    tags: input.tags,
    trackInventory: input.trackInventory,
    lowStockThreshold: input.lowStockThreshold,
  };
}

function variantColumns(productId: string, input: DraftProductInput) {
  return input.variants.map((v, i) => ({
    productId,
    name: v.name,
    slug: v.slug,
    swatch: v.swatch,
    sku: v.sku,
    priceInrOverride: v.priceInr,
    image: v.image,
    openingStock: v.openingStock,
    inStock: v.openingStock > 0,
    sortOrder: i,
    status: "active",
  }));
}

function parseDraft(raw: unknown) {
  return draftProductSchema({ categoryKeys: CATEGORY_KEYS, reservedSlugs: RESERVED_SLUGS }).safeParse(raw);
}

function saveError(err: unknown): SaveDraftResult {
  const code = pgCode(err);
  if (code === "23505")
    return { ok: false, error: "Another product already uses that URL slug.", fieldErrors: { slug: "Already used by another product" } };
  if (code === "42P01" || code === "42703") return { ok: false, error: NOT_MIGRATED };
  return { ok: false, error: "Couldn't save the product. Try again." };
}

export async function createDraftProduct(raw: unknown): Promise<SaveDraftResult> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "products.create")) return { ok: false, error: "You don't have permission to add products." };
  if (!ctx.siteIds.includes(DRAFT_SITE)) return { ok: false, error: "Not allowed for this store." };

  const parsed = parseDraft(raw);
  if (!parsed.success)
    return { ok: false, error: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error.issues) };
  const input = parsed.data;

  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(draftTable)
        .values({ siteId: DRAFT_SITE, ...productColumns(input), createdBy: ctx.email, updatedBy: ctx.email })
        .returning({ id: draftTable.id });
      if (input.variants.length) await tx.insert(draftVariantTable).values(variantColumns(row.id, input));
      return row.id;
    });
    await audit(DRAFT_SITE, "PRODUCT_DRAFT_CREATED", { productId: id, name: input.name, slug: input.slug, by: ctx.email });
    revalidateProducts();
    return { ok: true, id };
  } catch (err) {
    return saveError(err);
  }
}

export async function updateDraftProduct(id: string, raw: unknown): Promise<SaveDraftResult> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "products.edit")) return { ok: false, error: "You don't have permission to edit products." };
  if (!isDraftId(id)) return { ok: false, error: "Unknown product." };

  const parsed = parseDraft(raw);
  if (!parsed.success)
    return { ok: false, error: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error.issues) };
  const input = parsed.data;

  try {
    const [before] = await db
      .select()
      .from(draftTable)
      .where(and(eq(draftTable.id, id), inArray(draftTable.siteId, ctx.siteIds)));
    if (!before) return { ok: false, error: "This product no longer exists." };

    const beforeVariants = await db
      .select({ id: draftVariantTable.id })
      .from(draftVariantTable)
      .where(eq(draftVariantTable.productId, id));

    await db.transaction(async (tx) => {
      await tx
        .update(draftTable)
        .set({ ...productColumns(input), updatedAt: new Date(), updatedBy: ctx.email })
        .where(eq(draftTable.id, id));
      // Variants have no external references, so replace them wholesale.
      await tx.delete(draftVariantTable).where(eq(draftVariantTable.productId, id));
      if (input.variants.length) await tx.insert(draftVariantTable).values(variantColumns(id, input));
    });

    const changes: { label: string; from: string; to: string }[] = [];
    const track = (label: string, from: string, to: string) => from !== to && changes.push({ label, from, to });
    track("Name", before.name, input.name);
    track("Price", inr(before.priceInr), inr(input.priceInr));
    track("MRP", inr(before.mrpInr), inr(input.mrpInr));
    track("Category", categoryLabel(before.category), categoryLabel(input.category));
    track("Scale", before.scale ?? "—", input.scale);
    track("Variants", String(beforeVariants.length), String(input.variants.length));
    track("Images", String([before.heroImage, ...before.altImages].filter(Boolean).length), String(input.images.length));
    if (before.status !== input.status)
      track(
        "Status",
        PRODUCT_STATUS_META[before.status as keyof typeof PRODUCT_STATUS_META]?.label ?? before.status,
        PRODUCT_STATUS_META[input.status].label,
      );
    await audit(DRAFT_SITE, "PRODUCT_DRAFT_UPDATED", { productId: id, changes, by: ctx.email });

    revalidateProducts([id]);
    return { ok: true, id };
  } catch (err) {
    return saveError(err);
  }
}

export async function setDraftStatus(ids: string[], status: "draft" | "archived"): Promise<Result> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "products.edit")) return { ok: false, error: "You don't have permission to change products." };
  if (status !== "draft" && status !== "archived") return { ok: false, error: "Unknown status." };
  const list = [...new Set(ids)].filter(isDraftId);
  if (list.length === 0) return { ok: false, error: "No drafts selected." };

  try {
    const updated = await db
      .update(draftTable)
      .set({ status, updatedAt: new Date(), updatedBy: ctx.email })
      .where(and(inArray(draftTable.id, list), inArray(draftTable.siteId, ctx.siteIds)))
      .returning({ id: draftTable.id });
    for (const u of updated) await audit(DRAFT_SITE, "PRODUCT_DRAFT_STATUS", { productId: u.id, status, by: ctx.email });
    revalidateProducts(updated.map((u) => u.id));
    return { ok: true };
  } catch (err) {
    const code = pgCode(err);
    return { ok: false, error: code === "42P01" || code === "42703" ? NOT_MIGRATED : "Couldn't update the drafts." };
  }
}

/**
 * Permanent delete — drafts only, owners only, and the caller must echo the
 * exact product name (the typed confirmation is re-checked here, server-side).
 */
export async function deleteDraftProduct(id: string, confirmName: string): Promise<Result> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "products.delete")) return { ok: false, error: "Only owners can permanently delete products." };
  if (!isDraftId(id)) return { ok: false, error: "Catalogue products can't be deleted — hide or archive them instead." };

  try {
    const [row] = await db
      .select({ id: draftTable.id, name: draftTable.name, slug: draftTable.slug })
      .from(draftTable)
      .where(and(eq(draftTable.id, id), inArray(draftTable.siteId, ctx.siteIds)));
    if (!row) return { ok: false, error: "This product no longer exists." };
    if (row.name.trim() !== confirmName.trim()) return { ok: false, error: "The name you typed doesn't match." };

    await db.delete(draftTable).where(eq(draftTable.id, id)); // variants cascade
    await audit(DRAFT_SITE, "PRODUCT_DRAFT_DELETED", { productId: id, name: row.name, slug: row.slug, by: ctx.email });
    revalidateProducts();
    return { ok: true };
  } catch (err) {
    const code = pgCode(err);
    return { ok: false, error: code === "42P01" || code === "42703" ? NOT_MIGRATED : "Couldn't delete the product." };
  }
}
