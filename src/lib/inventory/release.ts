/**
 * Exactly-once release of an order's reserved holds — inventory stock AND
 * coupon usage — back to the pool.
 *
 * Design: stock and coupon usage are RESERVED at order-create (the PENDING
 * order row is the reservation record). When an order reaches a terminal,
 * un-fulfilled state — payment FAILED, abandoned/timed-out, CANCELLED, or
 * pre-shipment REFUNDED — those reservations must be returned, once and only
 * once.
 *
 * Critical guard: if an order is REFUNDED *after* shipment dispatch
 * (`shippedAt !== null` or status is `SHIPPED`/`DELIVERED`), physical stock has
 * already left the warehouse and MUST NOT be added back to `inventory.stock`
 * (only `RTO` return-to-origin restores shipped stock).
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders,
  inventory,
  customerCouponRedemptions,
  coupons,
  events,
} from "@/db/schema";
import { logError } from "@/lib/logger";
import { INVENTORY_SITE_ID } from "@/lib/inventory";
import { PRODUCTS } from "@/lib/products";
import { getBundleComponentSkuIds } from "@/lib/availability";

type OrderItem = {
  skuId: string;
  variantSlug: string | null;
  qty: number;
};

export type ReleaseReason =
  | "PAYMENT_FAILED"
  | "ABANDONED"
  | "CANCELLED"
  | "REFUNDED"
  // Return-to-origin: the courier could not deliver and the parcel came back.
  // The reserved stock is physically ours again, so it returns to the pool.
  | "RTO";

export type ReleaseResult = {
  released: boolean;
  orderId: string;
  restoredLines: number;
  couponRowsReleased: number;
  skippedStockRestoreBecauseShipped?: boolean;
};

function expandOrderLinesWithBundleComponents(lines: OrderItem[]): OrderItem[] {
  const expanded: OrderItem[] = [];
  for (const line of lines) {
    expanded.push(line);
    const sku = PRODUCTS.find((p) => p.id === line.skuId);
    if (sku) {
      const compIds = getBundleComponentSkuIds(sku);
      for (const compId of compIds) {
        expanded.push({
          skuId: compId,
          variantSlug: "",
          qty: line.qty,
        });
      }
    }
  }
  return expanded;
}

/**
 * Release inventory + coupon holds for an order. Idempotent + concurrency-safe.
 * Never throws on the no-op path; surfaces DB errors to the caller.
 */
export async function releaseOrderHolds(
  orderId: string,
  reason: ReleaseReason,
): Promise<ReleaseResult> {
  return db.transaction(async (tx) => {
    // ── Atomic claim: flip false → true exactly once. ──────────────────
    const claimed = await tx
      .update(orders)
      .set({ holdsReleased: true, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.holdsReleased, false)))
      .returning({
        items: orders.items,
        siteId: orders.siteId,
        customerId: orders.customerId,
        status: orders.status,
        shippedAt: orders.shippedAt,
      });

    if (claimed.length === 0) {
      return { released: false, orderId, restoredLines: 0, couponRowsReleased: 0 };
    }

    const { items, siteId, customerId, status, shippedAt } = claimed[0];
    const lines = expandOrderLinesWithBundleComponents((items as OrderItem[]) ?? []);

    // Do NOT restore physical inventory on a post-shipment refund unless the
    // parcel came back via RTO or RETURNED.
    const alreadyShipped =
      shippedAt !== null || status === "SHIPPED" || status === "DELIVERED";
    const shouldRestoreStock =
      reason === "RTO" || !(reason === "REFUNDED" && alreadyShipped);

    let restoredLines = 0;
    if (shouldRestoreStock) {
      for (const line of lines) {
        const variantKey = line.variantSlug ?? "";
        await tx
          .update(inventory)
          .set({
            stock: sql`${inventory.stock} + ${line.qty}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventory.siteId, INVENTORY_SITE_ID),
              eq(inventory.skuId, line.skuId),
              eq(inventory.variantSlug, variantKey),
            ),
          );
        restoredLines++;
      }
    }

    // ── Release coupon usage. ──────────────────────────────────────────
    const released = await tx
      .delete(customerCouponRedemptions)
      .where(eq(customerCouponRedemptions.orderId, orderId))
      .returning({ couponId: customerCouponRedemptions.couponId });

    for (const r of released) {
      await tx
        .update(coupons)
        .set({ usedCount: sql`GREATEST(0, ${coupons.usedCount} - 1)` })
        .where(eq(coupons.id, r.couponId));
    }

    await tx.insert(events).values({
      siteId,
      orderId,
      customerId,
      type: "HOLDS_RELEASED",
      payload: {
        reason,
        restoredLines,
        couponRowsReleased: released.length,
        skippedStockRestoreBecauseShipped: !shouldRestoreStock,
      },
      source: "system",
    });

    return {
      released: true,
      orderId,
      restoredLines,
      couponRowsReleased: released.length,
      skippedStockRestoreBecauseShipped: !shouldRestoreStock,
    };
  });
}

/**
 * RE-ACQUIRE holds for an order whose stock was previously released — used when
 * a captured payment arrives AFTER a failed attempt already released the order
 * (a Razorpay retry: fail → release → succeed).
 *
 * Uses `GREATEST(0, stock - qty)` so the `inventory_stock_nonneg` CHECK
 * constraint (`stock >= 0`) can never throw a 23514 error and crash payment
 * capture if another buyer took the last unit in the meantime.
 */
export async function reacquireOrderHolds(
  orderId: string,
): Promise<{ reacquired: boolean; restoredLines: number; shortfallLines: number }> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(orders)
      .set({ holdsReleased: false, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.holdsReleased, true)))
      .returning({
        items: orders.items,
        siteId: orders.siteId,
        customerId: orders.customerId,
      });

    if (claimed.length === 0) {
      return { reacquired: false, restoredLines: 0, shortfallLines: 0 };
    }

    const { items, siteId, customerId } = claimed[0];
    const lines = expandOrderLinesWithBundleComponents((items as OrderItem[]) ?? []);

    let restoredLines = 0;
    let shortfallLines = 0;
    for (const line of lines) {
      const variantKey = line.variantSlug ?? "";
      const currentRows = await tx
        .select({ stock: inventory.stock })
        .from(inventory)
        .where(
          and(
            eq(inventory.siteId, INVENTORY_SITE_ID),
            eq(inventory.skuId, line.skuId),
            eq(inventory.variantSlug, variantKey),
          ),
        );
      if (currentRows.length > 0 && currentRows[0].stock < line.qty) {
        shortfallLines++;
      }

      await tx
        .update(inventory)
        .set({
          stock: sql`GREATEST(0, ${inventory.stock} - ${line.qty})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventory.siteId, INVENTORY_SITE_ID),
            eq(inventory.skuId, line.skuId),
            eq(inventory.variantSlug, variantKey),
          ),
        );
      restoredLines++;
    }

    await tx.insert(events).values({
      siteId,
      orderId,
      customerId,
      type: "HOLDS_REACQUIRED",
      payload: {
        restoredLines,
        shortfallLines,
        note: "captured payment recovered a released order; clamped to >= 0",
      },
      source: "system",
    });

    return { reacquired: true, restoredLines, shortfallLines };
  });
}

/** Fire-and-forget wrapper for webhook hot paths; logs and swallows errors. */
export async function releaseOrderHoldsBestEffort(
  orderId: string,
  reason: ReleaseReason,
): Promise<void> {
  try {
    await releaseOrderHolds(orderId, reason);
  } catch (err) {
    logError("inventory:release", err, { orderId, reason });
  }
}
