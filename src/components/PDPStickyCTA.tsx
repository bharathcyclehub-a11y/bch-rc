"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ShoppingBag } from "lucide-react";
import type { Sku } from "@/lib/products";
import { defaultVariantSlug } from "@/lib/products";
import { formatINR } from "@/lib/utils";
import { useCart } from "@/lib/cart-store";

/**
 * Desktop-only sticky bottom bar that slides up after the user scrolls past
 * the primary Buy Now button (~500px). Keeps the conversion CTA visible at
 * all times so users don't lose the price/buy action while reading specs.
 * Mobile already has StickyMobileCTA -- this fills the desktop gap.
 */
export default function PDPStickyCTA({
  sku,
  selectedColorSlug,
  selectedColorName,
  disabled = false,
}: {
  sku: Sku;
  selectedColorSlug?: string | null;
  selectedColorName?: string;
  /** Selected colour is sold out — block add/buy so we can't create an
   *  impossible order from the sticky bar. */
  disabled?: boolean;
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

  function buyNow() {
    if (disabled) return;
    useCart.getState().add(sku.id, variantSlug, 1);
    router.push("/checkout");
  }

  function addToCart() {
    if (disabled) return;
    useCart.getState().add(sku.id, variantSlug, 1);
    useCart.getState().open();
  }

  return (
    <div
      className={`hidden lg:block fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
      aria-hidden={!visible}
    >
      <div className="bg-white/95 backdrop-blur-md border-t border-brand-line shadow-2xl">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-5">
          {/* Thumb */}
          <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-brand-cream border border-brand-line">
            <Image
              src={sku.heroImage}
              alt={sku.name}
              fill
              sizes="56px"
              className="object-contain"
            />
          </div>

          {/* Name + color + price */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-brand-ink truncate">
              {sku.name}
              {selectedColorName && (
                <span className="font-normal text-brand-ink-soft">
                  {" "}
                  · {selectedColorName}
                </span>
              )}
            </p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg font-bold text-brand-ink">
                {formatINR(sku.retailINR)}
              </span>
              {sku.mrpINR > sku.retailINR && (
                <>
                  <span className="text-xs text-brand-ink-soft line-through">
                    {formatINR(sku.mrpINR)}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-success font-semibold">
                    Save {formatINR(sku.mrpINR - sku.retailINR)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Add to cart (secondary) */}
          <button
            type="button"
            onClick={addToCart}
            disabled={disabled}
            className="px-5 py-3 rounded-xl border-2 border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white font-semibold text-sm transition-colors inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-brand-ink"
          >
            <ShoppingBag size={16} />
            Add to Cart
          </button>

          {/* Buy now (primary) */}
          <button
            type="button"
            onClick={buyNow}
            disabled={disabled}
            className="px-6 py-3 rounded-xl bg-brand-red hover:bg-brand-red-hover text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-red"
          >
            {disabled ? "Sold out" : `Buy Now · ${formatINR(sku.retailINR)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
