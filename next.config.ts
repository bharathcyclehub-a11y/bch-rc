import type { NextConfig } from "next";

/**
 * VPS build (`NEXT_OUTPUT=standalone`, set by .github/workflows/deploy-vps.yml).
 * On Vercel these stay off: vercel.json already supplies the redirects and
 * security headers there, so Vercel's output is unchanged. A VPS has no
 * vercel.json, so the same rules are applied here instead — keep both in sync.
 */
const isVps = process.env.NEXT_OUTPUT === "standalone";

const VPS_REDIRECTS = [
  { source: "/products", destination: "/#sku", permanent: true },
  { source: "/products/", destination: "/#sku", permanent: true },
  { source: "/shop", destination: "/#sku", permanent: true },
  { source: "/collection", destination: "/#sku", permanent: true },
  { source: "/collections", destination: "/#sku", permanent: true },
  { source: "/cart", destination: "/?openCart=1", permanent: false },
];

const VPS_HEADERS = [
  {
    source: "/(.*)",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ],
  },
  {
    source: "/(robots.txt|sitemap.xml)",
    headers: [{ key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400" }],
  },
  {
    source: "/ugc/(.*)",
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  },
];

const nextConfig: NextConfig = {
  ...(isVps ? { output: "standalone" as const } : {}),
  async redirects() {
    return isVps ? VPS_REDIRECTS : [];
  },
  images: {
    // DEV-ONLY: bypass the image optimizer locally. The Next 16 + Turbopack dev
    // optimizer was failing to render optimized images on this machine (blank
    // tiles). Serving originals directly in dev sidesteps it entirely; PRODUCTION
    // still runs the optimizer (qualities + sizes below apply there). Flip by
    // NODE_ENV so `next build`/Vercel are unaffected.
    unoptimized: process.env.NODE_ENV !== "production",
    // Our source assets cap at 1024px (rembg pipeline outputs 1024x1024
    // canvases). Default Next.js deviceSizes [640, 750, 828, 1080, 1200,
    // 1920, 2048, 3840] would request 3840w variants for any image with
    // sizes="100vw" - the optimizer can't upscale, but it still generates
    // the soft "1024 stretched to 3840" cache key and serves a fuzzy result.
    // Capping at 1920 reflects what we actually have and stops the wasted
    // cache entries.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Next.js 16 requires every `quality` value used by <Image> to be declared
    // here — anything unlisted makes the optimizer error and the image fails to
    // render. We use 75 (default) and 85 (product/hero shots). Without 85, the
    // whole site's imagery broke after the Next 16 upgrade.
    qualities: [75, 85],
    // Prefer AVIF (~20-30% smaller than WebP), fall back to WebP for older
    // browsers. Only takes effect in production, where the optimizer runs.
    formats: ["image/avif", "image/webp"],
    // Customer review photos live in a public Supabase Storage bucket
    // (see /api/reviews/upload). The optimizer rejects any remote host not
    // listed here, so the admin moderation queue's next/image thumbnails —
    // and any storefront <Image> pointed at these URLs — need this pattern.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    // B07 — long-immutable cache TTLs on the heaviest, never-versioned
    // static media. Vercel's default for files in /public is `public,
    // max-age=0, must-revalidate` (i.e. cache-busted on every request),
    // which means og-image.jpg and product MP4s get re-fetched against
    // origin under load. Pinning these to immutable / 1y stops a surge
    // from hammering the origin. Hashed bundles in /_next/static already
    // ship with `immutable` so they don't need a rule here.
    //
    // Trade-off: changing one of these files now requires renaming the
    // file (or busting via a query param) since browsers + CDN cache
    // it for a year. For og-image / hero / product MP4s this is the
    // correct trade — we change them rarely and we want them sticky.
    const immutableYear = "public, max-age=31536000, immutable";
    return [
      ...(isVps ? VPS_HEADERS : []),
      {
        source: "/og-image.jpg",
        headers: [{ key: "Cache-Control", value: immutableYear }],
      },
      {
        source: "/hero/:path*",
        headers: [{ key: "Cache-Control", value: immutableYear }],
      },
      {
        source: "/products/:path*",
        headers: [{ key: "Cache-Control", value: immutableYear }],
      },
      {
        source: "/logo/:path*",
        headers: [{ key: "Cache-Control", value: immutableYear }],
      },
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: immutableYear }],
      },
    ];
  },
};

export default nextConfig;
