"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { PRODUCTS, type Sku } from "./products";
import { OFFERS } from "./config";
import { applyOverride, type ProductOverride } from "./availability";

export type CartItem = {
  skuId: string;
  /** Selected color variant slug, e.g. "blue". null for SKUs without colors. */
  variantSlug: string | null;
  qty: number;
};

type CartState = {
  items: CartItem[];
  isOpen: boolean;
  /** True once zustand has rehydrated from localStorage on the client. */
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  add: (
    skuId: string,
    variantSlug: string | null,
    qty?: number,
    maxQty?: number,
  ) => void;
  remove: (skuId: string, variantSlug: string | null) => void;
  setQty: (
    skuId: string,
    variantSlug: string | null,
    qty: number,
    maxQty?: number,
  ) => void;
  replaceItem: (
    oldSkuId: string,
    oldVariantSlug: string | null,
    newSkuId: string,
    newVariantSlug: string | null,
    qty?: number,
  ) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

function sameLine(
  a: CartItem,
  skuId: string,
  variantSlug: string | null,
): boolean {
  return a.skuId === skuId && (a.variantSlug ?? null) === (variantSlug ?? null);
}

/**
 * Cart store factory. The 1:64 store and the 1:16 store each get their OWN
 * isolated cart (separate localStorage key, separate zustand instance) so a
 * customer's pocket-car cart and big-car cart never merge.
 */
function createCartStore(persistName: string) {
  return create<CartState>()(
    persist(
      (set) => ({
        items: [],
        isOpen: false,
        hasHydrated: false,
        setHasHydrated: (v) => set({ hasHydrated: v }),
        add: (skuId, variantSlug, qty = 1, maxQty = 10) =>
          set((s) => {
            const cap = Math.max(1, Math.min(10, maxQty));
            const existing = s.items.find((i) =>
              sameLine(i, skuId, variantSlug),
            );
            if (existing) {
              const nextQty = Math.min(cap, existing.qty + qty);
              return {
                items: s.items.map((i) =>
                  sameLine(i, skuId, variantSlug) ? { ...i, qty: nextQty } : i,
                ),
                isOpen: true,
              };
            }
            return {
              items: [
                ...s.items,
                { skuId, variantSlug, qty: Math.min(cap, Math.max(1, qty)) },
              ],
              isOpen: true,
            };
          }),
        remove: (skuId, variantSlug) =>
          set((s) => ({
            items: s.items.filter((i) => !sameLine(i, skuId, variantSlug)),
          })),
        setQty: (skuId, variantSlug, qty, maxQty = 10) =>
          set((s) => {
            const cap = Math.max(1, Math.min(10, maxQty));
            return {
              items:
                qty <= 0
                  ? s.items.filter((i) => !sameLine(i, skuId, variantSlug))
                  : s.items.map((i) =>
                      sameLine(i, skuId, variantSlug)
                        ? { ...i, qty: Math.min(cap, qty) }
                        : i,
                    ),
            };
          }),
        replaceItem: (
          oldSkuId,
          oldVariantSlug,
          newSkuId,
          newVariantSlug,
          qty = 1,
        ) =>
          set((s) => {
            const withoutOld = s.items.filter(
              (i) => !sameLine(i, oldSkuId, oldVariantSlug),
            );
            const existingNew = withoutOld.find((i) =>
              sameLine(i, newSkuId, newVariantSlug),
            );
            if (existingNew) {
              return {
                items: withoutOld.map((i) =>
                  sameLine(i, newSkuId, newVariantSlug)
                    ? { ...i, qty: Math.min(10, i.qty + qty) }
                    : i,
                ),
              };
            }
            return {
              items: [
                ...withoutOld,
                {
                  skuId: newSkuId,
                  variantSlug: newVariantSlug,
                  qty: Math.max(1, Math.min(10, qty)),
                },
              ],
            };
          }),
        clear: () => set({ items: [] }),
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
        toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      }),
      {
        name: persistName,
        version: 2,
        storage: createJSONStorage(() => localStorage),
        partialize: (s) => ({ items: s.items }),
        migrate: (_state, fromVersion) => {
          if (fromVersion < 2) {
            return { items: [], isOpen: false } as Partial<CartState>;
          }
          return _state as Partial<CartState>;
        },
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true);
        },
      },
    ),
  );
}

/** 1:64 pocket-car store cart. */
export const useCart = createCartStore("prc-cart");

/** 1:16 big-car store cart — fully isolated from the 1:64 cart above. */
export const useCart16 = createCartStore("prc-cart-16");

export type CartLine = {
  sku: Sku;
  variantSlug: string | null;
  variantName: string | null;
  variantImage: string | null;
  qty: number;
  unitPriceINR: number;
  lineTotalINR: number;
};

export function getCartLines(
  items: CartItem[],
  overrideMap?: Record<string, ProductOverride>,
): CartLine[] {
  return items
    .map((i) => {
      const baseSku = PRODUCTS.find((p) => p.id === i.skuId);
      if (!baseSku) return null;
      const sku = overrideMap
        ? applyOverride(baseSku, overrideMap[i.skuId])
        : baseSku;
      const variant = i.variantSlug
        ? sku.colors?.find((c) => c.slug === i.variantSlug) ?? null
        : null;
      const unitPriceINR = sku.retailINR;
      return {
        sku,
        variantSlug: i.variantSlug,
        variantName: variant?.name ?? null,
        variantImage: variant?.image ?? null,
        qty: i.qty,
        unitPriceINR,
        lineTotalINR: unitPriceINR * i.qty,
      };
    })
    .filter((l): l is CartLine => l !== null);
}

export function getCartSubtotal(
  items: CartItem[],
  overrideMap?: Record<string, ProductOverride>,
): number {
  return getCartLines(items, overrideMap).reduce(
    (sum, l) => sum + l.lineTotalINR,
    0,
  );
}

export function getCartCount(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}

export function getFreeShippingDelta(subtotal: number): number {
  return Math.max(0, OFFERS.freeShippingMinINR - subtotal);
}
