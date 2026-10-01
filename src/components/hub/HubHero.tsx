"use client";

import { useEffect, useRef } from "react";
import Image, { getImageProps } from "next/image";
import Link from "next/link";

/**
 * Hub hero — section 2. Full-bleed banner carousel that fills the screen
 * (100svh minus the announcement bar); the transparent site Header floats over
 * its top (the page pulls this up behind the header). A top scrim keeps the
 * white header legible even over the lighter banners.
 *
 * MOBILE: 2 portrait posters — full-bleed, small CTA pill on the image.
 * DESKTOP: 3 landscape 16:9 banners — full-bleed, CTA pill inside.
 * Both auto-roll. Assets in /public/landing.
 */

type Slide = { src: string; alt: string; href: string; cta: string };

/**
 * Every CTA must land on a page that isn't this one. These four used to point
 * at "/" — the homepage they're already on — so the largest, most animated
 * button on the site scrolled the visitor to the top and nothing else.
 *
 * Destinations mirror the CTA copy: a "Shop <collection>" pill goes to that
 * collection's grid, never to a single PDP. Category keys come from
 * `HUB_CATEGORIES` in lib/hub-categories.ts; changing a key there without
 * changing it here silently 404s the hero.
 */
const MOBILE_SLIDES: Slide[] = [
  {
    src: "/landing/mobile-1.webp",
    alt: "PRC 1:16 scale RC car lineup — precision, passion, performance",
    href: "/hub/shop/big16",
    cta: "Shop 1:16 Cars",
  },
  {
    src: "/landing/mobile-2.webp",
    alt: "PRC RC cars built for speed, made for adventure — racing, drifting and off-road",
    href: "/hub/shop/mini64",
    cta: "Shop Mini RC",
  },
  // 1:20 "Built for Legends" collection (Itachi · Sasuke · Naruto) → 1:20 category
  {
    src: "/landing/mobile-s20.webp",
    alt: "PRC 1:20 scale drift cars — Itachi Speed Racing, Sasuke AE86 Trueno and Naruto Future GT",
    href: "/hub/shop/s20",
    cta: "Shop 1:20 Cars",
  },
  // Construction 3-Pack (BUY ALL 3 · ₹4,999) → construction category
  {
    src: "/landing/mobile-construction.webp",
    alt: "PRC construction 3-pack — mining truck, excavator and forklift, buy all 3 for ₹4,999",
    href: "/hub/shop/construction",
    cta: "Shop the 3-Pack",
  },
];

const DESKTOP_SLIDES: Slide[] = [
  {
    src: "/landing/hero-1.webp",
    alt: "PRC pocket mini RC car lineup — big thrills, smaller size",
    href: "/hub/shop/mini64",
    cta: "Shop the Lineup",
  },
  {
    src: "/landing/hero-2.webp",
    alt: "PRC pocket mini cars — designed for precision",
    href: "/hub/shop/big16",
    cta: "Shop Drift Cars",
  },
  // 3rd slide — Construction 3-Pack banner (BUY ALL 3 · ₹4,999) → construction.
  // Uses the 16:9 hero-composed art (ribbon pushed clear of the header, no crop).
  {
    src: "/landing/hero-construction.webp",
    alt: "PRC construction 3-pack — mining truck, excavator and forklift, buy all 3 for ₹4,999",
    href: "/hub/shop/construction",
    cta: "Shop the 3-Pack",
  },
];

const AUTOROLL_MS = 3500;

/**
 * Seamless INFINITE forward loop. The rail renders `count` real slides plus one
 * clone of the first appended at the end (index `count`). The timer always
 * advances forward (never `% count` back to 0), so after the last real slide it
 * glides onto the clone — visually identical to slide 1 — and once the scroll
 * settles there we snap scrollLeft back to 0 with NO animation. The result is an
 * endless leftward roll with no jarring rewind. Pauses on touch/hover, disabled
 * for reduced-motion.
 */
function useAutoRoll(ref: { current: HTMLDivElement | null }, count: number) {
  useEffect(() => {
    const rail = ref.current;
    if (!rail || count < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let paused = false;
    const pause = () => (paused = true);
    const resume = () => (paused = false);
    const evPause = ["pointerdown", "mouseenter", "touchstart"] as const;
    const evResume = ["pointerup", "pointercancel", "mouseleave", "touchend"] as const;
    evPause.forEach((e) => rail.addEventListener(e, pause, { passive: true }));
    evResume.forEach((e) => rail.addEventListener(e, resume, { passive: true }));

    // Once motion settles on the clone (index === count), jump back to the real
    // first slide instantly (behavior auto) so the forward loop is invisible.
    let settle: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const w = rail.clientWidth;
        if (w && Math.round(rail.scrollLeft / w) >= count) {
          const prev = rail.style.scrollBehavior;
          rail.style.scrollBehavior = "auto";
          rail.scrollLeft = 0;
          rail.style.scrollBehavior = prev;
        }
      }, 140);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });

    const id = setInterval(() => {
      if (paused) return;
      const w = rail.clientWidth;
      if (!w) return; // hidden carousel
      const cur = Math.round(rail.scrollLeft / w);
      // Always forward; cur+1 may be the clone (index count) — onScroll resets it.
      rail.scrollTo({ left: (cur + 1) * w, behavior: "smooth" });
    }, AUTOROLL_MS);

    return () => {
      clearInterval(id);
      clearTimeout(settle);
      rail.removeEventListener("scroll", onScroll);
      evPause.forEach((e) => rail.removeEventListener(e, pause));
      evResume.forEach((e) => rail.removeEventListener(e, resume));
    };
  }, [ref, count]);
}

/** Full-bleed banner with the CTA pill overlaid on the image. `small` = the
 *  compact mobile pill; default = the bigger desktop pill. */
function Banner({
  s,
  w,
  h,
  small = false,
  priority = false,
}: {
  s: Slide;
  w: number;
  h: number;
  small?: boolean;
  priority?: boolean;
}) {
  const imageProps = getImageProps({
    src: s.src,
    alt: s.alt,
    width: w,
    height: h,
    sizes: "100vw",
  }).props;
  return (
    <>
      {/* Only preload the visible carousel. CSS hiding alone does not stop
          next/image's unconditional priority preloads on the other viewport. */}
      {priority && (
        <link
          rel="preload"
          as="image"
          href={imageProps.src}
          imageSrcSet={imageProps.srcSet}
          imageSizes={imageProps.sizes}
          media={small ? "(max-width: 639px)" : "(min-width: 640px)"}
          fetchPriority="high"
        />
      )}
    <div className="relative h-[calc(100svh-2rem)] w-full shrink-0 snap-center">
      {/* next/link, not <a>: a raw anchor tears down the whole React tree and
          re-downloads the page for what should be a client transition. */}
      <Link href={s.href} aria-label={s.cta} tabIndex={-1} className="block h-full w-full overflow-hidden">
        <Image
          src={s.src}
          alt={s.alt}
          width={w}
          height={h}
          sizes="100vw"
          loading="lazy"
          fetchPriority={priority ? "high" : undefined}
          className="h-full w-full object-cover"
        />
      </Link>
      {/* Centered via a flex wrapper so the button's own transform is free for
          the heartbeat animation (translate-x centering would clash with it). */}
      <div
        className={`absolute inset-x-0 flex justify-center ${small ? "bottom-6" : "bottom-8"}`}
      >
        <Link
          href={s.href}
          className={`group inline-flex items-center rounded-full bg-brand-red font-bold text-white animate-heartbeat focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 ${
            small
              ? "gap-1.5 px-6 py-2.5 text-sm shadow-lg"
              : "gap-2 px-10 py-4 text-lg shadow-xl"
          }`}
        >
          {s.cta}
          <span aria-hidden className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </Link>
      </div>
    </div>
    </>
  );
}

export default function HubHero() {
  const mobileRef = useRef<HTMLDivElement>(null);
  const desktopRef = useRef<HTMLDivElement>(null);
  useAutoRoll(mobileRef, MOBILE_SLIDES.length);
  useAutoRoll(desktopRef, DESKTOP_SLIDES.length);

  return (
    <section aria-label="Featured drift cars" className="relative bg-brand-cream">
      {/* Top scrim — keeps the transparent white header legible over the
          lighter banners without darkening the whole image. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-24 bg-gradient-to-b from-black/40 to-transparent" />

      {/* MOBILE: portrait posters + a clone of the 1st appended for the
          seamless infinite loop (see useAutoRoll). */}
      <div
        ref={mobileRef}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto sm:hidden"
      >
        {[...MOBILE_SLIDES, MOBILE_SLIDES[0]].map((s, i) => (
          <Banner key={i} s={s} w={1054} h={1492} small priority={i === 0} />
        ))}
      </div>

      {/* DESKTOP: landscape 16:9 banners + a clone of the 1st for the seamless loop */}
      <div
        ref={desktopRef}
        className="no-scrollbar hidden snap-x snap-mandatory overflow-x-auto sm:flex"
      >
        {[...DESKTOP_SLIDES, DESKTOP_SLIDES[0]].map((s, i) => (
          <Banner key={i} s={s} w={1672} h={941} priority={i === 0} />
        ))}
      </div>
    </section>
  );
}
