"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAutoRoll } from "./useAutoRoll";
import { useLiveStock } from "@/lib/use-live-stock";
import { getSkuBySlug } from "@/lib/products";
import { resolveProductAvailability } from "@/lib/availability";

type Best = {
  slug: string;
  imgMobile: string;
  imgDesktop: string | null;
  wDesktop: number;
  hDesktop: number;
  href: string;
  alt: string;
  cta: string;
};

const BEST: Best[] = [
  {
    slug: "pocket-monster",
    imgMobile: "/landing/best-64.webp",
    imgDesktop: "/landing/best-64-desktop.webp",
    wDesktop: 1536,
    hDesktop: 1024,
    href: "/product/pocket-monster",
    alt: "Pocket Monster Truck — Off-Road Collection. Tap to shop.",
    cta: "Shop Monster Truck",
  },
  {
    slug: "drift-inferno",
    imgMobile: "/landing/best-16.webp",
    imgDesktop: "/landing/best-16-desktop.webp",
    wDesktop: 1536,
    hDesktop: 1024,
    href: "/product/drift-inferno",
    alt: "Drift Inferno — Performance Collection. Tap to shop.",
    cta: "Shop Drift Inferno",
  },
];

export default function HubBestSellers() {
  const railRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const { stockMap, overridesMap } = useLiveStock();

  useAutoRoll(railRef, BEST.length);

  const go = (i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const n = (i + BEST.length) % BEST.length;
    rail.scrollTo({ left: n * rail.clientWidth, behavior: "smooth" });
    setIdx(n);
  };

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const onScroll = () => {
      const w = rail.clientWidth;
      if (w) setIdx(Math.round(rail.scrollLeft / w));
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => rail.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section aria-labelledby="hub-best" className="bg-white py-8 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-4 text-center sm:mb-10">
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand-red">Best-sellers</span>
          <h2 id="hub-best" className="mt-12 font-display text-3xl font-extrabold uppercase tracking-wide text-brand-ink sm:mt-16 sm:text-4xl">
            <span className="sr-only">The Most Drifted</span>
            <span aria-hidden="true">
              The Most{" "}
              <span className="relative inline-block">
                <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 -rotate-3 whitespace-nowrap text-[0.78em] font-extrabold leading-none text-brand-red drop-shadow-sm">
                  Drifted
                </span>
                <span className="relative inline-block text-brand-ink">
                  Loved
                  <svg
                    aria-hidden
                    viewBox="0 0 240 48"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute left-[-8%] top-1/2 h-[1.35em] w-[116%] -translate-y-1/2 -rotate-1 overflow-visible text-brand-red"
                  >
                    <path
                      d="M6,30 L48,17 L30,35 L92,19 L72,37 L138,20 L118,37 L188,19 L168,35 L234,22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6,25 C64,34 120,15 180,29 C210,36 226,20 234,27"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      strokeLinecap="round"
                      opacity="0.9"
                    />
                  </svg>
                </span>
              </span>
            </span>
          </h2>
        </div>

        <div className="relative mx-auto max-w-5xl">
          <div
            ref={railRef}
            className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-2xl"
          >
            {BEST.map((b) => {
              const sku = getSkuBySlug(b.slug);
              const avail = sku && stockMap ? resolveProductAvailability(sku, stockMap, overridesMap?.[sku.id]) : null;
              const isSoldOut = Boolean(avail && !avail.purchasable);

              return (
                <div key={b.href} className="w-full flex-none snap-center">
                  <Link href={b.href} aria-label={b.alt} className="group relative block overflow-hidden">
                    <Image
                      src={b.imgMobile}
                      alt={b.alt}
                      width={1086}
                      height={1448}
                      sizes="(max-width: 640px) 100vw, 768px"
                      className={`h-auto w-full transition-transform duration-500 group-hover:scale-[1.02] sm:hidden ${
                        isSoldOut ? "opacity-80 saturate-50" : ""
                      }`}
                    />
                    <Image
                      src={b.imgDesktop ?? b.imgMobile}
                      alt=""
                      aria-hidden
                      width={b.wDesktop}
                      height={b.hDesktop}
                      sizes="768px"
                      className={`hidden h-auto w-full transition-transform duration-500 group-hover:scale-[1.02] sm:block ${
                        isSoldOut ? "opacity-80 saturate-50" : ""
                      }`}
                    />
                    {avail && avail.status === "LOW_STOCK" && (
                      <span className="absolute right-4 top-4 rounded-full bg-amber-500 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-zinc-950 shadow">
                        {avail.label}
                      </span>
                    )}
                    {isSoldOut && (
                      <span className="absolute right-4 top-4 rounded-full bg-red-600 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-white shadow">
                        Sold Out
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-4 flex justify-center">
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-lg ${
                          isSoldOut ? "bg-zinc-900/90" : "bg-brand-red animate-heartbeat"
                        }`}
                      >
                        {isSoldOut ? `${b.cta} (View Alternatives)` : b.cta}
                        <span aria-hidden className="transition-transform group-hover:translate-x-1">
                          →
                        </span>
                      </span>
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => go(idx - 1)}
            aria-label="Previous"
            className="absolute left-3 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-white/90 p-2 text-brand-ink shadow-md ring-1 ring-black/5 transition-colors hover:bg-white sm:grid"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={() => go(idx + 1)}
            aria-label="Next"
            className="absolute right-3 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-white/90 p-2 text-brand-ink shadow-md ring-1 ring-black/5 transition-colors hover:bg-white sm:grid"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="mt-5 flex justify-center gap-2">
          {BEST.map((b, i) => (
            <button
              key={b.href}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show best-seller ${i + 1}`}
              aria-current={i === idx}
              className={`h-2 rounded-full transition-all ${
                i === idx ? "w-6 bg-brand-red" : "w-2 bg-brand-line hover:bg-brand-ink-soft"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
