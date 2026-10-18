"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Trash2,
  Minus,
  Plus,
  ShoppingBag,
  Gift,
  PartyPopper,
  Sparkles,
  AlertTriangle,
  ArrowRightLeft,
} from "lucide-react";
import {
  useCart,
  getCartLines,
  getCartSubtotal,
  getCartCount,
  getFreeShippingDelta,
} from "@/lib/cart-store";
import {
  OFFERS,
  BUNDLE_TIERS,
  bundleDiscountInr,
  bundleDiscountPct,
} from "@/lib/config";
import { PRODUCTS, defaultVariantSlug } from "@/lib/products";
import {
  resolveVariantAvailability,
  resolveProductAvailability,
  findComparableAlternatives,
} from "@/lib/availability";
import { useLiveStock } from "@/lib/use-live-stock";
import { formatINR } from "@/lib/utils";
import { trackFunnel } from "@/lib/funnel-client";

export default function CartDrawer({
  initialOpen = false,
}: {
  initialOpen?: boolean;
}) {
  const items = useCart((s) => s.items);
  const isOpen = useCart((s) => s.isOpen);
  const close = useCart((s) => s.close);
  const open = useCart((s) => s.open);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const replaceItem = useCart((s) => s.replaceItem);

  const { stockMap, overrideMap, refresh } = useLiveStock();

  const lines = getCartLines(items, overrideMap);
  const subtotal = getCartSubtotal(items, overrideMap);
  const count = getCartCount(items);

  // Revalidate live stock whenever the cart drawer opens
  useEffect(() => {
    if (!isOpen) return;
    refresh();
    trackFunnel("view_cart", { cartValueInr: subtotal, itemCount: count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const delta = getFreeShippingDelta(subtotal);
  const progressPct = Math.min(
    100,
    (subtotal / OFFERS.freeShippingMinINR) * 100,
  );
  const currentBundleBonus = bundleDiscountInr(count, subtotal);
  const nextTier = BUNDLE_TIERS.find((t) => t.minQty > count);
  const bundleGap = nextTier ? nextTier.minQty - count : 0;
  const currentBundlePct = bundleDiscountPct(count);
  const nextTierPct = nextTier ? nextTier.pct : 0;

  // Check if any cart line has a verified stock conflict
  const hasStockConflict = Boolean(
    stockMap &&
      lines.some((line) => {
        const vAvail = resolveVariantAvailability(
          line.sku,
          line.variantSlug,
          stockMap,
          overrideMap[line.sku.id],
        );
        return !vAvail.purchasable || line.qty > vAvail.availableQty;
      }),
  );

  // Open from ?openCart=1 query param on first mount.
  const initialOpenAppliedRef = useRef(false);
  useEffect(() => {
    if (initialOpen && !initialOpenAppliedRef.current) {
      initialOpenAppliedRef.current = true;
      open();
    }
  }, [initialOpen, open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // Focus trap + scroll lock while open.
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const focusFirst = () => {
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea',
      );
      focusables?.[0]?.focus();
    };
    const t = setTimeout(focusFirst, 50);

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);

    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onTab);
      document.body.style.overflow = prevOverflow;
      prevFocused?.focus?.();
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="cart-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 bg-black/50 z-50"
            aria-hidden="true"
          />
          <motion.aside
            key="cart-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Cart"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            className="fixed right-0 top-0 h-full w-full sm:w-[28rem] bg-white z-50 shadow-2xl flex flex-col"
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-brand-line">
              <h2 className="text-lg font-bold text-brand-ink">
                Your cart ({count})
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close cart"
                className="h-11 w-11 flex items-center justify-center text-brand-ink-soft hover:text-brand-ink"
              >
                <X size={22} />
              </button>
            </header>

            {count > 0 && (
              <div className="mx-5 my-3 rounded-xl border border-brand-line bg-white/60 backdrop-blur-sm overflow-hidden text-sm">
                <div
                  className={
                    delta > 0
                      ? "px-3.5 py-2.5 bg-brand-red-soft/60 text-brand-ink"
                      : "px-3.5 py-2.5 bg-success/10 text-success"
                  }
                >
                  {delta > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-2 font-medium">
                        <span className="flex items-center gap-2 min-w-0">
                          <Sparkles
                            size={14}
                            className="shrink-0 text-brand-red"
                            aria-hidden
                          />
                          <span className="truncate">
                            Add {formatINR(delta)} for FREE shipping
                          </span>
                        </span>
                        <span className="text-[11px] font-mono text-brand-ink-soft tabular-nums shrink-0">
                          {Math.round(progressPct)}%
                        </span>
                      </div>
                      <div className="h-1 bg-brand-line rounded-full mt-2 overflow-hidden">
                        <div
                          className="h-full bg-brand-red transition-[width] duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 font-medium">
                      <PartyPopper size={14} className="shrink-0" aria-hidden />
                      <span>Free shipping unlocked</span>
                    </div>
                  )}
                </div>

                {(currentBundleBonus > 0 || (bundleGap > 0 && nextTier)) && (
                  <div
                    className={
                      currentBundleBonus > 0
                        ? "px-3.5 py-2.5 border-t border-brand-line bg-success/10 text-success font-medium"
                        : "px-3.5 py-2.5 border-t border-brand-line bg-brand-ink/[0.03] text-brand-ink font-medium"
                    }
                  >
                    {currentBundleBonus > 0 ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <Gift size={14} className="shrink-0" aria-hidden />
                          <span className="truncate">Bundle bonus applied</span>
                        </span>
                        <span className="text-[13px] font-bold tabular-nums shrink-0">
                          −{currentBundlePct}%
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <Gift
                            size={14}
                            className="shrink-0 text-brand-red"
                            aria-hidden
                          />
                          <span className="truncate">
                            Add {bundleGap} more car
                            {bundleGap > 1 ? "s" : ""} → unlock bundle bonus
                          </span>
                        </span>
                        {nextTierPct > 0 && (
                          <span className="text-[11px] font-mono text-brand-red tabular-nums shrink-0">
                            up to −{nextTierPct}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5">
              {count === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-10">
                  <ShoppingBag size={48} className="text-brand-ink-soft" />
                  <p className="text-brand-ink-soft text-sm">
                    Cart is empty. Pick a car below.
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    className="px-5 py-2.5 rounded-full bg-brand-red hover:bg-brand-red-hover text-white text-sm font-semibold"
                  >
                    Browse
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-brand-line">
                  {lines.map((line) => {
                    const ov = overrideMap[line.sku.id];
                    const vAvail = resolveVariantAvailability(
                      line.sku,
                      line.variantSlug,
                      stockMap,
                      ov,
                    );
                    const pAvail = resolveProductAvailability(
                      line.sku,
                      stockMap,
                      ov,
                    );
                    const isSoldOut = stockMap && !vAvail.purchasable;
                    const isOverQty =
                      stockMap &&
                      vAvail.purchasable &&
                      line.qty > vAvail.availableQty;

                    // Find an in-stock colour of the same SKU, or a comparable in-stock SKU
                    const alternateColor =
                      isSoldOut && pAvail.firstInStockVariantSlug
                        ? line.sku.colors?.find(
                            (c) => c.slug === pAvail.firstInStockVariantSlug,
                          )
                        : undefined;
                    const comparableSku =
                      isSoldOut && !alternateColor
                        ? findComparableAlternatives(
                            line.sku,
                            PRODUCTS,
                            stockMap,
                            overrideMap,
                            1,
                          )[0]
                        : undefined;

                    return (
                      <li
                        key={`${line.sku.id}-${line.variantSlug ?? "default"}`}
                        className="flex flex-col gap-2 py-3.5"
                      >
                        <div className="flex gap-3">
                          <div className="w-16 h-16 rounded-lg bg-brand-cream relative overflow-hidden flex-shrink-0">
                            <Image
                              src={line.variantImage ?? line.sku.heroImage}
                              alt={
                                line.sku.name +
                                (line.variantName ? ` (${line.variantName})` : "")
                              }
                              fill
                              sizes="64px"
                              className={`object-contain p-1.5 ${
                                isSoldOut ? "opacity-50 grayscale-[35%]" : ""
                              }`}
                            />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold text-brand-ink text-sm leading-tight truncate">
                                  {line.sku.name}
                                </div>
                                <div className="text-[11px] text-brand-ink-soft mt-0.5 truncate flex items-center gap-1.5">
                                  <span>
                                    {line.sku.scale}
                                    {line.variantName
                                      ? ` · ${line.variantName}`
                                      : ""}
                                  </span>
                                  {isSoldOut && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-brand-red text-white text-[10px] font-bold uppercase tracking-wide">
                                      SOLD OUT
                                    </span>
                                  )}
                                  {!isSoldOut &&
                                    vAvail.status === "LOW_STOCK" && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold">
                                        Only {vAvail.availableQty} left
                                      </span>
                                    )}
                                </div>
                              </div>
                              <div className="font-bold text-brand-ink text-sm tabular-nums whitespace-nowrap">
                                {formatINR(line.lineTotalINR)}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 mt-2">
                              <div className="inline-flex items-center border border-brand-line rounded-full overflow-hidden bg-white">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setQty(
                                      line.sku.id,
                                      line.variantSlug,
                                      line.qty - 1,
                                      vAvail.maxOrderQty || 10,
                                    )
                                  }
                                  aria-label="Decrease quantity"
                                  className="h-8 w-8 flex items-center justify-center text-brand-ink-soft hover:bg-brand-cream active:bg-brand-line transition-colors"
                                >
                                  <Minus size={13} />
                                </button>
                                <span className="px-2.5 text-[13px] font-semibold tabular-nums text-brand-ink min-w-[28px] text-center">
                                  {line.qty}
                                </span>
                                <button
                                  type="button"
                                  disabled={
                                    Boolean(isSoldOut) ||
                                    (vAvail.stockKnown &&
                                      line.qty >= vAvail.maxOrderQty)
                                  }
                                  onClick={() =>
                                    setQty(
                                      line.sku.id,
                                      line.variantSlug,
                                      line.qty + 1,
                                      vAvail.maxOrderQty || 10,
                                    )
                                  }
                                  aria-label="Increase quantity"
                                  className="h-8 w-8 flex items-center justify-center text-brand-ink-soft hover:bg-brand-cream active:bg-brand-line disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                                >
                                  <Plus size={13} />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  remove(line.sku.id, line.variantSlug)
                                }
                                aria-label={`Remove ${line.sku.name}`}
                                className="h-8 w-8 flex items-center justify-center text-brand-ink-soft hover:text-brand-red rounded-full hover:bg-brand-red-soft transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Contextual resolution actions when line is OOS or over available stock */}
                        {isOverQty && (
                          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <AlertTriangle size={13} className="shrink-0" />
                              Only {vAvail.availableQty} available in stock
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setQty(
                                  line.sku.id,
                                  line.variantSlug,
                                  vAvail.availableQty,
                                  vAvail.availableQty,
                                )
                              }
                              className="font-bold underline hover:no-underline shrink-0"
                            >
                              Set to {vAvail.availableQty}
                            </button>
                          </div>
                        )}

                        {isSoldOut && (
                          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-900 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">
                                This item just went out of stock. Other items in
                                your cart are safe.
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  remove(line.sku.id, line.variantSlug)
                                }
                                className="text-[11px] font-semibold underline shrink-0"
                              >
                                Remove
                              </button>
                            </div>
                            {alternateColor && (
                              <button
                                type="button"
                                onClick={() => {
                                  trackFunnel("alternative_click", {
                                    skuId: line.sku.id,
                                    targetSkuId: line.sku.id,
                                    variantSlug: alternateColor.slug,
                                    placement: "cart_drawer",
                                  });
                                  replaceItem(
                                    line.sku.id,
                                    line.variantSlug,
                                    line.sku.id,
                                    alternateColor.slug,
                                    1,
                                  );
                                }}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-red-200 text-brand-ink font-semibold hover:bg-brand-cream transition-colors"
                              >
                                <ArrowRightLeft size={12} />
                                Switch to {alternateColor.name} (In stock)
                              </button>
                            )}
                            {!alternateColor && comparableSku && (
                              <button
                                type="button"
                                onClick={() => {
                                  const targetVariant = defaultVariantSlug(
                                    comparableSku,
                                    stockMap,
                                  );
                                  trackFunnel("alternative_click", {
                                    skuId: line.sku.id,
                                    targetSkuId: comparableSku.id,
                                    variantSlug: targetVariant ?? "",
                                    placement: "cart_drawer",
                                  });
                                  replaceItem(
                                    line.sku.id,
                                    line.variantSlug,
                                    comparableSku.id,
                                    targetVariant,
                                    1,
                                  );
                                }}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-red-200 text-brand-ink font-semibold hover:bg-brand-cream transition-colors"
                              >
                                <ArrowRightLeft size={12} />
                                Swap with {comparableSku.name} (
                                {formatINR(comparableSku.retailINR)})
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {count > 0 && (
              <div className="border-t border-brand-line p-5 space-y-2.5">
                <div className="flex justify-between text-brand-ink-soft text-sm">
                  <span>Subtotal</span>
                  <span className="font-medium tabular-nums">
                    {formatINR(subtotal)}
                  </span>
                </div>
                {currentBundleBonus > 0 && (
                  <div className="flex justify-between text-success text-sm">
                    <span className="flex items-center gap-1.5">
                      <Gift size={13} className="shrink-0" aria-hidden />
                      Bundle bonus
                    </span>
                    <span className="font-semibold tabular-nums">
                      −{currentBundlePct}%
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-brand-ink font-bold pt-2 border-t border-brand-line">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatINR(Math.max(0, subtotal - currentBundleBonus))}
                  </span>
                </div>
                <p className="text-[11px] text-brand-ink-soft -mt-1">
                  Shipping &amp; taxes calculated at checkout
                </p>
                {hasStockConflict ? (
                  <div className="rounded-xl bg-amber-50 border border-amber-300 px-3.5 py-2.5 text-xs font-medium text-amber-900 text-center">
                    Please update or swap the unavailable item above to proceed
                    to checkout.
                  </div>
                ) : (
                  <Link
                    href="/checkout"
                    onClick={close}
                    aria-disabled={subtotal === 0}
                    className={
                      subtotal === 0
                        ? "bg-brand-red/50 text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 pointer-events-none"
                        : "bg-brand-red hover:bg-brand-red-hover text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2"
                    }
                  >
                    Checkout ·{" "}
                    {formatINR(Math.max(0, subtotal - currentBundleBonus))}
                  </Link>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
