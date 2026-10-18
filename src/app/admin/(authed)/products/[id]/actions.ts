"use server";

/**
 * Product override writes — the admin's edit layer over the code catalogue.
 * Persists price / MRP / visibility / badge / discontinued / preorder /
 * lowStockThreshold / featured / alternatives to `product_overrides` (keyed by
 * the code SKU id + its site). Null price/MRP means "use the catalogue value".
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
  discontinued?: boolean;
  preorder?: boolean;
  lowStockThreshold?: number | null;
  featured?: boolean;
  alternatives?: string[] | null;
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
  if (Boolean(before.discontinued) !== Boolean(after.discontinued))
    changes.push({ label: "Discontinued", from: before.discontinued ? "Yes" : "No", to: after.discontinued ? "Yes" : "No" });
  if (Boolean(before.preorder) !== Boolean(after.preorder))
    changes.push({ label: "Pre-order", from: before.preorder ? "Enabled" : "Off", to: after.preorder ? "Enabled" : "Off" });
  if ((before.lowStockThreshold ?? 5) !== (after.lowStockThreshold ?? 5))
    changes.push({
      label: "Low-stock threshold",
      from: String(before.lowStockThreshold ?? 5),
      to: String(after.lowStockThreshold ?? 5),
    });
  if (Boolean(before.featured) !== Boolean(after.featured))
    changes.push({ label: "Featured", from: before.featured ? "Yes" : "No", to: after.featured ? "Yes" : "No" });
  if (JSON.stringify(before.alternatives ?? []) !== JSON.stringify(after.alternatives ?? []))
    changes.push({
      label: "Alternatives",
      from: (before.alternatives ?? []).join(", ") || "Auto",
      to: (after.alternatives ?? []).join(", ") || "Auto",
    });
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
  const discontinued = Boolean(input.discontinued);
  const preorder = Boolean(input.preorder);
  const lowStockThreshold =
    typeof input.lowStockThreshold === "number" &&
    Number.isFinite(input.lowStockThreshold) &&
    input.lowStockThreshold >= 0 &&
    input.lowStockThreshold <= 1000
      ? Math.round(input.lowStockThreshold)
      : null;
  const featured = Boolean(input.featured);
  const alternatives = Array.isArray(input.alternatives)
    ? input.alternatives.map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : null;

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
        discontinued: productOverrides.discontinued,
        preorder: productOverrides.preorder,
        lowStockThreshold: productOverrides.lowStockThreshold,
        featured: productOverrides.featured,
        alternatives: productOverrides.alternatives,
      })
      .from(productOverrides)
      .where(and(eq(productOverrides.siteId, siteId), eq(productOverrides.skuId, skuId)));
  } catch {
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
        discontinued,
        preorder,
        lowStockThreshold,
        featured,
        alternatives,
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
          discontinued,
          preorder,
          lowStockThreshold,
          featured,
          alternatives,
          updatedAt: new Date(),
          updatedBy: ctx.email,
        },
      });
  } catch {
    // Fallback if extended columns migration hasn't been run yet
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
  }

  const changes = describeChanges(
    applyOverride(sku, prev),
    applyOverride(sku, {
      skuId,
      priceInr: price,
      mrpInr: mrp,
      hidden,
      comingSoon,
      badge,
      discontinued,
      preorder,
      lowStockThreshold,
      featured,
      alternatives,
    }),
  );
  if (changes.length) await audit(siteId, "PRODUCT_OVERRIDE_SAVED", { skuId, changes, by: ctx.email });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${skuId}`);
  revalidatePath(`/product/${sku.slug}`);
  revalidatePath("/");
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
