"use server";

/**
 * Product override writes — the admin's edit layer over the code catalogue.
 * Persists price / MRP / visibility / badge to `product_overrides` (keyed by the
 * code SKU id + its site). Null price/MRP means "use the catalogue value". These
 * are read back by src/lib/product-overrides.ts on the PDP, the storefront grid,
 * the admin, AND the order-create pricing seam — so the price the admin sets is
 * exactly the price the customer is charged. Stock is edited separately via
 * /api/admin/inventory. Every effective change leaves an `events` audit row
 * (PRODUCT_OVERRIDE_SAVED / _CLEARED) shown on the product's Activity tab.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/db";
import { events, productOverrides } from "@/db/schema";
import { siteIdForSku } from "@/lib/inventory";
import { getProductById, type Sku } from "@/lib/products";
import { applyOverride, type ProductOverride } from "@/lib/product-overrides";
import { skuStatus, inr } from "@/lib/admin/catalog";
import { can } from "@/lib/admin/permissions";
import { PRODUCT_STATUS_META } from "@/lib/admin/status";

const ALLOWED_BADGES = ["MOST GIFTED", "NEW", "BESTSELLER", "PRO"];

export type OverrideInput = {
  priceInr: number | null;
  mrpInr: number | null;
  visibility: "active" | "coming" | "hidden";
  badge: string | null; // null = use catalogue, "" = no badge, else an allowed badge
};

type Result = { ok: boolean; error?: string };

function cleanInt(v: number | null, label: string): number | null {
  if (v === null) return null;
  if (!Number.isFinite(v) || v < 0 || v > 1_000_000)
    throw new Error(`${label} must be between 0 and 10,00,000`);
  return Math.round(v);
}

/** Human-readable before → after for the audit trail. */
function describeChanges(before: Sku, after: Sku) {
  const changes: { label: string; from: string; to: string }[] = [];
  if (before.retailINR !== after.retailINR)
    changes.push({ label: "Price", from: inr(before.retailINR), to: inr(after.retailINR) });
  if (before.mrpINR !== after.mrpINR) changes.push({ label: "MRP", from: inr(before.mrpINR), to: inr(after.mrpINR) });
  const s0 = skuStatus(before);
  const s1 = skuStatus(after);
  if (s0 !== s1)
    changes.push({ label: "Status", from: PRODUCT_STATUS_META[s0].label, to: PRODUCT_STATUS_META[s1].label });
  if ((before.badge ?? "") !== (after.badge ?? ""))
    changes.push({ label: "Badge", from: before.badge ?? "None", to: after.badge ?? "None" });
  return changes;
}

async function audit(siteId: string, type: string, payload: Record<string, unknown>) {
  try {
    await db.insert(events).values({ siteId, type, payload, source: "admin" });
  } catch {
    // The audit trail must never fail the write it describes.
  }
}

export async function saveProductOverride(
  skuId: string,
  input: OverrideInput,
): Promise<Result> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "products.edit")) return { ok: false, error: "You don't have permission to edit products." };

  const sku = getProductById(skuId);
  if (!sku) return { ok: false, error: "Unknown product." };

  const siteId = siteIdForSku(skuId);
  // Guard: an admin can only edit products under a site they manage.
  if (!ctx.siteIds.includes(siteId))
    return { ok: false, error: "Not allowed for this store." };

  let price: number | null;
  let mrp: number | null;
  try {
    price = cleanInt(input.priceInr, "Price");
    mrp = cleanInt(input.mrpInr, "MRP");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid input" };
  }
  if (price !== null && mrp !== null && mrp < price)
    return { ok: false, error: "MRP can't be lower than price." };

  const badge =
    input.badge === null || input.badge === ""
      ? input.badge
      : ALLOWED_BADGES.includes(input.badge)
        ? input.badge
        : null;

  const hidden = input.visibility === "hidden";
  const comingSoon = input.visibility === "coming";

  // Previous override (if any) → the effective before/after for the audit row.
  let prev: ProductOverride | undefined;
  try {
    [prev] = await db
      .select({
        skuId: productOverrides.skuId,
        priceInr: productOverrides.priceInr,
        mrpInr: productOverrides.mrpInr,
        hidden: productOverrides.hidden,
        comingSoon: productOverrides.comingSoon,
        badge: productOverrides.badge,
      })
      .from(productOverrides)
      .where(and(eq(productOverrides.siteId, siteId), eq(productOverrides.skuId, skuId)));
  } catch {
    prev = undefined;
  }

  try {
    await db
      .insert(productOverrides)
      .values({
        siteId,
        skuId,
        priceInr: price,
        mrpInr: mrp,
        hidden,
        comingSoon,
        badge,
        updatedBy: ctx.email,
      })
      .onConflictDoUpdate({
        target: [productOverrides.siteId, productOverrides.skuId],
        set: {
          priceInr: price,
          mrpInr: mrp,
          hidden,
          comingSoon,
          badge,
          updatedAt: new Date(),
          updatedBy: ctx.email,
        },
      });
  } catch {
    return {
      ok: false,
      error:
        "Couldn't save — the product_overrides table may not exist yet. Apply the migration in Supabase first.",
    };
  }

  const changes = describeChanges(
    applyOverride(sku, prev),
    applyOverride(sku, { skuId, priceInr: price, mrpInr: mrp, hidden, comingSoon, badge }),
  );
  if (changes.length) await audit(siteId, "PRODUCT_OVERRIDE_SAVED", { skuId, changes, by: ctx.email });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${skuId}`);
  revalidatePath(`/product/${sku.slug}`);
  revalidatePath("/"); // storefront grid
  return { ok: true };
}

/** Remove all overrides for a SKU — revert it to the pure catalogue values. */
export async function clearProductOverride(skuId: string): Promise<Result> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "products.edit")) return { ok: false, error: "You don't have permission to edit products." };
  const sku = getProductById(skuId);
  if (!sku) return { ok: false, error: "Unknown product." };
  const siteId = siteIdForSku(skuId);
  if (!ctx.siteIds.includes(siteId))
    return { ok: false, error: "Not allowed for this store." };

  try {
    await db
      .delete(productOverrides)
      .where(
        and(
          eq(productOverrides.siteId, siteId),
          eq(productOverrides.skuId, skuId),
        ),
      );
  } catch {
    return { ok: false, error: "Couldn't reset — try again." };
  }

  await audit(siteId, "PRODUCT_OVERRIDE_CLEARED", { skuId, by: ctx.email });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${skuId}`);
  revalidatePath(`/product/${sku.slug}`);
  revalidatePath("/");
  return { ok: true };
}
