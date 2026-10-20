"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Bell, ShoppingBag } from "lucide-react";
import type { Sku } from "@/lib/products";
import { defaultVariantSlug } from "@/lib/products";
import { formatINR } from "@/lib/utils";
import { useCart } from "@/lib/cart-store";
import type { AvailabilityStatus } from "@/lib/availability";

/**
 * Sticky bottom bar (mobile + desktop) that slides up after the user scrolls
 * past the primary Buy Now button (~600px). Strictly obeys the same live
 * inventory availability state as the main PDP buy-box.
 */
export default function PDPStickyCTA({
  sku,
  selectedColorSlug,
  selectedColorName,
  selectedColorImage,
  disabled = false,
  status = "IN_STOCK",
  statusLabel = "In Stock",
  maxOrderQty = 10,
  onUnavailableAction,
}: {
  sku: Sku;
  selectedColorSlug?: string | null;
  selectedColorName?: string;
  selectedColorImage?: string;
  disabled?: boolean;
  status?: AvailabilityStatus;
  statusLabel?: string;
  maxOrderQty?: number;
  onUnavailableAction?: () => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const variantSlug = selectedColorSlug ?? defaultVariantSlug(sku);
  const onlinePrice = sku.id === "qa-1rs" ? 1 : Math.max(0, sku.retailINR - 100);

  function buyNow() {
    if (disabled) return;
    useCart.getState().add(sku.id, variantSlug, 1, maxOrderQty);
    router.push("/checkout");
  }

  function addToCart() {
    if (disabled) return;
    useCart.getState().add(sku.id, variantSlug, 1, maxOrderQty);
    useCart.getState().open();
  }

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
      aria-hidden={!visible}
    >
      <div className="bg-white/95 backdrop-blur-md border-t border-brand-line shadow-2xl">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center gap-3 sm:gap-5">
          {/* Thumb */}
          <div className="relative w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-lg overflow-hidden bg-brand-cream border border-brand-line">
            <Image
              src={selectedColorImage ?? sku.heroImage}
              alt={sku.name}
              fill
              sizes="56px"
              className="object-contain"
            />
          </div>

          {/* Name + color + price + availability */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs sm:text-sm font-bold text-brand-ink truncate">
                {sku.name}
                {selectedColorName && (
                  <span className="font-normal text-brand-ink-soft">
                    {" "}
                    · {selectedColorName}
                  </span>
                )}
              </p>
              <span
                className={`hidden sm:inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  disabled
                    ? "bg-red-100 text-red-800"
                    : status === "LOW_STOCK"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {statusLabel}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 sm:gap-2 mt-0.5">
              <span className="text-sm sm:text-lg font-extrabold text-brand-ink">
                {formatINR(onlinePrice)}
              </span>
              <span className="text-[10px] font-mono uppercase text-brand-ink-soft">
                online
              </span>
              <span className="hidden sm:inline text-xs text-brand-ink-soft">
                ({formatINR(sku.retailINR)} COD)
              </span>
            </div>
          </div>

          {disabled ? (
            <button
              type="button"
              onClick={
                onUnavailableAction ??
                (() => window.scrollTo({ top: 320, behavior: "smooth" }))
              }
              className="px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Bell size={15} />
              {status === "DISCONTINUED" ? "See Alternatives ↑" : "Notify Me / Alternatives ↑"}
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={addToCart}
                className="px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl border-2 border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white font-semibold text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ShoppingBag size={15} />
                <span className="hidden sm:inline">Add to Cart</span>
                <span className="sm:hidden">Add</span>
              </button>

              <button
                type="button"
                onClick={buyNow}
                className="px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-brand-red hover:bg-brand-red-hover text-white font-bold text-xs sm:text-sm transition-colors cursor-pointer"
              >
                Buy Now · {formatINR(onlinePrice)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
