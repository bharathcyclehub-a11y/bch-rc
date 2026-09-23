"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Sku } from "@/lib/products";
import { ProductPlaceholder } from "@/components/ProductPlaceholder";
import blurMap from "@/lib/blur-map.json";

/**
 * Renders the product hero image with a graceful fallback.
 * If the SKU has a heroVideo, the video plays on hover — muted, looped,
 * web-optimized H.264. Image stays as the poster. If the image fails to
 * load, the colored ProductPlaceholder SVG shows.
 *
 * Hover trigger: by default the image owns its own hover (the `active` prop
 * is undefined). But the card-wide `<Link>` overlay in SkuLineup covers the
 * image, and the image is only a slice of the card, so a self-owned hover is
 * a tiny, unreliable hit target. When a parent passes `active`, this component
 * runs in CONTROLLED mode: the card decides play/pause from hovering ANYWHERE
 * on the card, and we react via an effect. This is what makes the preview fire
 * reliably — the whole card is the target, not the image-under-the-overlay.
 *
 * Earlier we tried an Aritzia-style lazy-load (preload=none + JS src injection
 * + IntersectionObserver) but it caused first-hover playback to stutter while
 * the browser fetched and parsed the file. Reverted to this simpler pattern
 * where the browser preloads metadata so playback starts cleanly.
 */
export function ProductImage({
  sku,
  className,
  active,
  src: srcOverride,
}: {
  sku: Sku;
  className?: string;
  /** When provided, the parent controls hover (whole-card trigger). When
   *  undefined, the image manages its own hover. */
  active?: boolean;
  /** Show a specific image instead of the SKU hero — used by cards with a
   *  colour picker so the card follows the selected swatch. */
  src?: string;
}) {
  // Remember WHICH src failed, so switching colour re-tries rather than
  // leaving the placeholder up for every later image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlled = active !== undefined;
  const src = srcOverride ?? sku.heroImage;
  // Zepto-style blur-up: tiny base64 preview shows instantly, real image fades
  // in over it. Map is generated at build time (scripts/gen-blur.ts).
  const blur = (blurMap as Record<string, string>)[src];

  const startVideo = useCallback(() => {
    if (!sku.heroVideo || !videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current
      .play()
      .then(() => setPlaying(true))
      .catch(() => {});
  }, [sku.heroVideo]);

  const stopVideo = useCallback(() => {
    if (!sku.heroVideo || !videoRef.current) return;
    videoRef.current.pause();
    setPlaying(false);
  }, [sku.heroVideo]);

  // Controlled mode: play/pause follows the parent's `active` flag.
  useEffect(() => {
    if (!controlled) return;
    if (active) startVideo();
    else stopVideo();
  }, [controlled, active, startVideo, stopVideo]);

  if (!src || failedSrc === src) {
    return (
      <ProductPlaceholder sku={sku} showLabel={false} className={className} />
    );
  }

  // Self-managed hover handlers only when the parent isn't driving it.
  const selfHover = controlled
    ? {}
    : {
        onMouseEnter: startVideo,
        onMouseLeave: stopVideo,
        onTouchStart: startVideo,
        onTouchEnd: stopVideo,
      };

  return (
    <div
      className={`relative w-full h-full bg-brand-cream ${className ?? ""}`}
      {...selfHover}
    >
      {/* Static image — always rendered, fades out when video plays.
          The parent's `bg-brand-cream` is the load-state backdrop; we no
          longer render a coloured SVG car silhouette behind the image
          because it flashed for ~1s before the real photo arrived. The
          `onError` fallback above still swaps to the ProductPlaceholder
          if the image fails to load entirely. */}
      <Image
        src={src}
        alt={sku.name}
        fill
        sizes="(max-width: 768px) 50vw, (max-width: 1280px) 50vw, 25vw"
        quality={85}
        placeholder={blur ? "blur" : undefined}
        blurDataURL={blur}
        className={`object-contain object-center transition-opacity duration-300 ${
          playing ? "opacity-0" : "opacity-100"
        }`}
        onError={() => setFailedSrc(src)}
      />

      {/* Hover video — preloads metadata so first hover plays cleanly.
          transform-gpu forces a compositor layer so Chrome uses hardware video
          decode from the start (without it, decode runs on CPU/software path
          and looks blurry until a repaint promotes it — eg. scrolling). */}
      {sku.heroVideo && (
        <video
          ref={videoRef}
          src={sku.heroVideo}
          poster={src}
          muted
          loop
          playsInline
          preload="none"
          className={`absolute inset-0 w-full h-full object-cover transform-gpu will-change-transform transition-opacity duration-300 ${
            playing ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* Tiny play-indicator dot — desktop only ("Hover" makes no sense on
          mobile where there's no hover event; tap-to-play is implicit). */}
      {sku.heroVideo && !playing && (
        <span
          aria-hidden
          className="hidden sm:flex absolute bottom-2 right-2 z-10 items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-brand-red animate-pulse" />
          <span className="text-[9px] font-mono uppercase tracking-wider text-white/90">
            Hover
          </span>
        </span>
      )}
    </div>
  );
}
