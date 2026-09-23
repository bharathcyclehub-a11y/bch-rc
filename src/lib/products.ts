/**
 * PRC Cars — Real product lineup (replaces Storm placeholder SKUs).
 *
 * All 4 are Trasped/Hengguan HG4-series 1:64 chassis with different body shells.
 * Per-SKU pricing (2026-06-05) — listed `retailINR` is the pre-coupon price; the
 * auto-applied CODEPRC100 (-₹100) brings the customer to the published "from"
 * target: BMW ₹999, Porsche/Thar ₹1,299, F1 Classic ₹1,499, Monster Truck ₹1,799.
 * MRP carries a ~30-35% strikethrough.
 */

export type Scale = "1:64" | "1:43" | "1:24" | "1:20" | "1:18" | "1:16" | "1:14" | "1:12" | "1:10";

/** Hub category a SKU belongs to. Defaults are derived from scale (1:64→mini,
 *  1:16→big, 1:20→s20); `construction` is an explicit override for the RC
 *  trucks/diggers, which sit on the 1:64 chassis but belong in their own tile.
 *  `hobby` (big-scale crawlers/racers) and `s43` fill their own tiles — and
 *  keep a 1:16 crawler out of the 1:16 drift lineup. */
export type ProductCategory = "mini" | "big" | "s20" | "construction" | "polo" | "hobby" | "s43";

/** One row of the PDP spec table. */
export type SpecRow = { label: string; value: string };

export type ColorVariant = {
  /** Display name, e.g. "Blue", "Multi Colour", "Red & Orange" */
  name: string;
  /** Slug used in image filenames + URL query, e.g. "blue", "multi", "red-orange" */
  slug: string;
  /** Swatch fill — solid hex, or "gradient:from,to" / "gradient:from,mid,to" */
  swatch: string;
  /** Units in hand from Syed's warehouse — used for stock badges + sold-out gating */
  stock: number;
  /** Optional variant image. Falls back to sku.heroImage if absent. */
  image?: string;
  /** Per-color additional angle thumbnails. When present, the PDP gallery
   *  shows [color hero, ...altImages] for this swatch. Avoids the AI-mismatch
   *  problem of using shared sku.altImages across colored SKUs. */
  altImages?: string[];
};

export type Sku = {
  id: string;
  slug: string;
  scale: Scale;
  name: string;
  /** Grid-card headline only — "{Model} + experience", e.g. "Pocket Porsche GT3
   *  Drift RC". Never used for cart lines, order snapshots, JSON-LD or the PDP
   *  <h1>; those stay on `name` so a copy tweak can't rewrite order history.
   *  Falls back to `name` when unset. Every claim here must be backed by
   *  `specs` (don't write "4x4" on a 2WD chassis). */
  cardTitle?: string;
  tagline: string;
  retailINR: number;
  mrpINR: number;
  bullets: [string, string, string, string];
  badge?: "MOST GIFTED" | "NEW" | "BESTSELLER" | "PRO";
  bodyShape: string;
  heroImage: string;
  /** Optional web-optimized MP4 (muted, ~6s loop). Plays on hover in SkuLineup. */
  heroVideo?: string;
  altImages: string[];
  /** When true, SKU exists in data but is hidden from the storefront grid
   *  AND returns 404 on the PDP — i.e. "doesn't exist as far as anyone can
   *  reach it". Use for future / discontinued SKUs you want to keep in code
   *  but not expose at all. */
  hidden?: boolean;
  /** When true, SKU is filtered from the storefront grid, sitemap, and
   *  static-params list — but the PDP renders normally for anyone who knows
   *  the slug. Use for internal QA / ops links (₹1 smoke-test SKU, gift
   *  cards for staff, etc.) where you need a live URL but don't want
   *  customers, Google, or the catalog to surface it. */
  internal?: boolean;
  /** Per-color stock + image. Listed in display order. */
  colors?: ColorVariant[];
  /** Hub category override. When unset the category is derived from `scale`.
   *  Use `"construction"` for the RC trucks/diggers so they land in that tile
   *  instead of the 1:64 Mini grid. */
  category?: ProductCategory;
  /** Teaser-only SKU: shown in the hub category grid as "Coming soon" (no price,
   *  no buy) but EXCLUDED from the live 1:64/1:16 storefronts, PDPs, sitemap and
   *  checkout. Set on products whose price/stock isn't live yet. */
  comingSoon?: boolean;
  /** Fixed-price bundle SKU (e.g. the Construction 3-Pack). Purchasable, but
   *  EXCLUDED from the normal product grid — surfaced via its own CTA banner. */
  bundle?: boolean;
  /** Legacy fixed spec sheet. Every field is optional so a product only states
   *  what has been verified — a missing field is omitted, never guessed. */
  specs: {
    lengthMM?: number;
    drive?: "2WD" | "4WD";
    topSpeedKmh?: number;
    batteryMin?: number;
    chargeMin?: number;
    rangeM?: number;
    minAge?: number;
    led?: string;
    drift?: string;
  };
  /** Verified spec rows (source-checked). When set, the PDP shows these after
   *  any `specs` fields and drops the legacy "Charger: USB-C" line. */
  specRows?: SpecRow[];
  /** Box contents. When unset the PDP shows the legacy 1:64 drift-car list. */
  inBox?: string[];
  /** PDP kicker material, e.g. "RC". Unset = the legacy
   *  "die-cast RC" line, which only the die-cast lineup can truthfully claim. */
  kind?: string;
};

/**
 * Rows for the PDP "Full specs" table. Legacy SKUs render exactly as before
 * (including the fixed charger line); SKUs with `specRows` show only verified
 * data and skip any field that isn't set.
 */
export function pdpSpecRows(sku: Sku): SpecRow[] {
  const s = sku.specs;
  const rows: SpecRow[] = [{ label: "Scale", value: sku.scale }];
  const add = (label: string, value: string | number | undefined, unit = "") => {
    if (value !== undefined && value !== "") rows.push({ label, value: `${value}${unit}` });
  };
  add("Length", s.lengthMM, " mm");
  add("Drive", s.drive);
  add("Top speed", s.topSpeedKmh, " km/h");
  add("Battery life", s.batteryMin, " min");
  add("Charge time", s.chargeMin, " min");
  add("Range", s.rangeM, " m");
  add("LED", s.led);
  add("Drift mode", s.drift);
  if (sku.specRows) rows.push(...sku.specRows);
  else rows.push({ label: "Charger", value: "USB-C" });
  return rows;
}

export const PRODUCTS: Sku[] = [
  {
    id: "pocket-bmw",
    slug: "pocket-bmw",
    scale: "1:64",
    name: "Pocket BMW",
    cardTitle: "Pocket BMW Mini Racer",
    tagline: "M-striped racing icon · 2.4 GHz · LED headlights",
    retailINR: 1099,
    mrpINR: 1599,
    bullets: [
      "Die-cast alloy BMW M-style body",
      "2.4 GHz · race 3 cars side-by-side",
      "USB-C · 12-15 min real drift per charge",
      "Drift + grip wheels swappable in seconds",
    ],
    badge: "NEW",
    bodyShape: "BMW M-style sport coupe",
    heroImage: "/products/colors/PRC-bmw-white.webp",
    heroVideo: "/products/PRC-bmw.mp4",
    altImages: [
      "/products/PRC-bmw-2.webp",
      "/products/PRC-bmw-3.webp",
      "/products/PRC-bmw-4.webp",
    ],
    colors: [
      { name: "White",  slug: "white",  swatch: "#f1f1ef", stock: 35, image: "/products/colors/PRC-bmw-white.webp",
        altImages: ["/products/colors/PRC-bmw-white-2.webp","/products/colors/PRC-bmw-white-3.webp","/products/colors/PRC-bmw-white-4.webp"] },
      { name: "Blue",   slug: "blue",   swatch: "#1d4ed8", stock: 18, image: "/products/colors/PRC-bmw-blue.webp",
        altImages: ["/products/colors/PRC-bmw-blue-2.webp","/products/colors/PRC-bmw-blue-3.webp","/products/colors/PRC-bmw-blue-4.webp"] },
      { name: "Black",  slug: "black",  swatch: "#111827", stock: 16, image: "/products/colors/PRC-bmw-black.webp",
        altImages: ["/products/colors/PRC-bmw-black-2.webp","/products/colors/PRC-bmw-black-3.webp","/products/colors/PRC-bmw-black-4.webp"] },
    ],
    specs: {
      lengthMM: 72,
      drive: "2WD",
      topSpeedKmh: 14,
      batteryMin: 14,
      chargeMin: 30,
      rangeM: 25,
      minAge: 8,
      led: "Tail + Headlight",
      drift: "Yes",
    },
  },
  {
    id: "pocket-porsche",
    slug: "pocket-porsche",
    scale: "1:64",
    name: "Pocket Porsche",
    cardTitle: "Pocket Porsche GT3 Drift RC",
    tagline: "GT3 silhouette · drift wheels · iconic Stuttgart lines",
    retailINR: 1399,
    mrpINR: 1999,
    bullets: [
      "Porsche 911 GT3-inspired die-cast body",
      "Pre-tuned for tight corner drifts",
      "USB-C charge · 30 min full",
      "LED headlights + tail-lights · 7-day replacement",
    ],
    badge: "MOST GIFTED",
    bodyShape: "Porsche 911 GT3-style",
    heroImage: "/products/colors/PRC-porsche-green-v2.webp",
    heroVideo: "/products/PRC-porsche.mp4",
    altImages: [
      "/products/PRC-porsche-2.webp",
      "/products/PRC-porsche-3.webp",
      "/products/PRC-porsche-4.webp",
    ],
    colors: [
      { name: "Dark Blue",    slug: "dark-blue",    swatch: "#1e3a8a", stock: 18, image: "/products/colors/PRC-porsche-dark-blue.webp",
        altImages: ["/products/colors/PRC-porsche-dark-blue-2.webp","/products/colors/PRC-porsche-dark-blue-3-v2.webp","/products/colors/PRC-porsche-dark-blue-4.webp"] },
      { name: "Green",        slug: "green",        swatch: "#16a34a", stock: 18, image: "/products/colors/PRC-porsche-green-v2.webp",
        altImages: ["/products/colors/PRC-porsche-green-2-v2.webp","/products/colors/PRC-porsche-green-3-v2.webp","/products/colors/PRC-porsche-green-4-v2.webp"] },
      { name: "Yellow",       slug: "yellow",       swatch: "#facc15", stock: 18, image: "/products/colors/PRC-porsche-yellow.webp",
        altImages: ["/products/colors/PRC-porsche-yellow-2.webp","/products/colors/PRC-porsche-yellow-3.webp","/products/colors/PRC-porsche-yellow-4.webp"] },
      { name: "Multi Colour", slug: "multi",        swatch: "gradient:#f97316,#facc15,#16a34a,#2563eb", stock: 18, image: "/products/colors/PRC-porsche-multi.webp",
        altImages: ["/products/colors/PRC-porsche-multi-2.webp","/products/colors/PRC-porsche-multi-3.webp","/products/colors/PRC-porsche-multi-4.webp"] },
    ],
    specs: {
      lengthMM: 70,
      drive: "2WD",
      topSpeedKmh: 15,
      batteryMin: 15,
      chargeMin: 30,
      rangeM: 28,
      minAge: 8,
      led: "Tail + Headlight",
      drift: "Pro drift mode",
    },
  },
  {
    id: "pocket-thar",
    slug: "pocket-thar",
    scale: "1:64",
    name: "Pocket Thar",
    // 2WD chassis — "Off-Road" is backed by specs.drift ("Off-road grip"); do
    // NOT upgrade this to "4x4"/"4WD".
    cardTitle: "Pocket Thar Off-Road RC",
    tagline: "Off-road champ · grippy treads · made for Indian roads",
    retailINR: 1399,
    mrpINR: 1999,
    bullets: [
      "Mahindra Thar-style off-road body",
      "Grippy treaded tyres for marble + tile",
      "USB-C · 12-15 min real drift per charge",
      "LED headlights · drop-tested 1.2m",
    ],
    badge: "BESTSELLER",
    bodyShape: "Mahindra Thar-style SUV",
    heroImage: "/products/colors/PRC-thar-blue-v2.webp",
    altImages: [
      "/products/PRC-thar-2.webp",
      "/products/PRC-thar-3.webp",
      "/products/PRC-thar-4.webp",
    ],
    colors: [
      { name: "Blue",   slug: "blue",   swatch: "#2563eb", stock: 11, image: "/products/colors/PRC-thar-blue-v2.webp",
        altImages: ["/products/colors/PRC-thar-blue-2-v2.webp","/products/colors/PRC-thar-blue-3-v2.webp","/products/colors/PRC-thar-blue-4-v2.webp"] },
      { name: "Yellow", slug: "yellow", swatch: "#facc15", stock:  8, image: "/products/colors/PRC-thar-yellow-v2.webp",
        altImages: ["/products/colors/PRC-thar-yellow-2-v2.webp","/products/colors/PRC-thar-yellow-3-v2.webp","/products/colors/PRC-thar-yellow-4-v2.webp"] },
      { name: "White",  slug: "white",  swatch: "#f1f1ef", stock:  5, image: "/products/colors/PRC-thar-white-v2.webp",
        altImages: ["/products/colors/PRC-thar-white-2-v2.webp","/products/colors/PRC-thar-white-3-v2.webp","/products/colors/PRC-thar-white-4-v2.webp"] },
      { name: "Black",  slug: "black",  swatch: "#111827", stock:  1, image: "/products/colors/PRC-thar-black-v5.webp",
        altImages: ["/products/colors/PRC-thar-black-2-v2.webp","/products/colors/PRC-thar-black-3-v2.webp","/products/colors/PRC-thar-black-4-v2.webp"] },
    ],
    specs: {
      lengthMM: 75,
      drive: "2WD",
      topSpeedKmh: 13,
      batteryMin: 15,
      chargeMin: 30,
      rangeM: 25,
      minAge: 8,
      led: "Headlight",
      drift: "Off-road grip",
    },
  },
  {
    id: "pocket-monster",
    slug: "pocket-monster",
    scale: "1:64",
    name: "Pocket Monster Truck",
    cardTitle: "Pocket Monster 4WD Off-Road RC",
    tagline: "Oversized wheels · 4WD · climbs anything · LED roof bar",
    retailINR: 1899,
    mrpINR: 2699,
    bullets: [
      "Massive over-scaled rubber wheels",
      "4WD drive · climbs cushions, books, steps",
      "LED roof light-bar + headlights",
      "USB-C · 25 min runtime · 7-day replacement",
    ],
    badge: "PRO",
    bodyShape: "Monster Truck oversize chassis",
    heroImage: "/products/colors/PRC-monster-blue-v2.webp",
    heroVideo: "/products/PRC-monster.mp4",
    altImages: [
      "/products/PRC-monster-2.webp",
      "/products/PRC-monster-3.webp",
      "/products/PRC-monster-4.webp",
    ],
    colors: [
      { name: "Blue",           slug: "blue",        swatch: "#2563eb", stock: 11, image: "/products/colors/PRC-monster-blue-v2.webp",
        altImages: ["/products/colors/PRC-monster-blue-2-v2.webp","/products/colors/PRC-monster-blue-3-v2.webp","/products/colors/PRC-monster-blue-4-v2.webp"] },
      { name: "Yellow",         slug: "yellow",      swatch: "#facc15", stock: 11, image: "/products/colors/PRC-monster-yellow-v2.webp",
        altImages: ["/products/colors/PRC-monster-yellow-2-v2.webp","/products/colors/PRC-monster-yellow-3-v2.webp","/products/colors/PRC-monster-yellow-4-v2.webp"] },
      { name: "White & Red",    slug: "white-red",   swatch: "gradient:#f8fafc,#dc2626", stock: 11, image: "/products/colors/PRC-monster-white-red-v2.webp",
        altImages: ["/products/colors/PRC-monster-white-red-2-v2.webp","/products/colors/PRC-monster-white-red-3-v2.webp","/products/colors/PRC-monster-white-red-4-v2.webp"] },
      { name: "Multi Colour",   slug: "multi",       swatch: "gradient:#f97316,#facc15,#16a34a,#2563eb", stock: 11, image: "/products/colors/PRC-monster-multi-v2.webp",
        altImages: ["/products/colors/PRC-monster-multi-2-v2.webp","/products/colors/PRC-monster-multi-3-v2.webp","/products/colors/PRC-monster-multi-4-v2.webp"] },
      { name: "Red & Orange",   slug: "red-orange",  swatch: "gradient:#dc2626,#f97316", stock: 12, image: "/products/colors/PRC-monster-red-orange-v2.webp",
        altImages: ["/products/colors/PRC-monster-red-orange-2-v2.webp","/products/colors/PRC-monster-red-orange-3-v2.webp","/products/colors/PRC-monster-red-orange-4-v2.webp"] },
    ],
    specs: {
      lengthMM: 85,
      drive: "4WD",
      topSpeedKmh: 12,
      batteryMin: 18,
      chargeMin: 35,
      rangeM: 25,
      minAge: 8,
      led: "Roof bar + Headlight",
      drift: "All-terrain grip",
    },
  },

  // ---- Scraped competitor SKU variants (Trasped HG4 family) ----
  // Sourced from Indian competitor research (REF_1_64_COMPETITOR_PRODUCTS.md).
  // Same chassis as above; different bodies → different model numbers.

  {
    id: "pocket-f1-classic",
    slug: "pocket-f1-classic",
    scale: "1:64",
    name: "Pocket F1 Classic",
    cardTitle: "Pocket F1 Classic Track RC",
    tagline: "Formula racing silhouette · entry-grade · most popular",
    retailINR: 1799,
    mrpINR: 2299,
    bullets: [
      "Trasped HG4-218 Formula 1 generic body",
      "2.4 GHz · 3-speed adjustable",
      "USB-C · 12-15 min real drift per charge",
      "LED headlights · drift wheels included",
    ],
    bodyShape: "F1 generic open-wheel",
    heroImage: "/products/colors/PRC-f1-classic-white-v2.webp",
    altImages: [
      "/products/PRC-f1-classic-2.webp",
      "/products/PRC-f1-classic-3.webp",
      "/products/PRC-f1-classic-4.webp",
    ],
    colors: [
      { name: "White", slug: "white", swatch: "#f1f1ef", stock: 36, image: "/products/colors/PRC-f1-classic-white-v2.webp",
        altImages: ["/products/colors/PRC-f1-classic-white-2-v2.webp","/products/colors/PRC-f1-classic-white-3-v2.webp","/products/colors/PRC-f1-classic-white-4-v2.webp"] },
      { name: "Red",   slug: "red",   swatch: "#dc2626", stock: 36, image: "/products/colors/PRC-f1-classic-red-v2.webp",
        altImages: ["/products/colors/PRC-f1-classic-red-2-v2.webp","/products/colors/PRC-f1-classic-red-3-v2.webp","/products/colors/PRC-f1-classic-red-4-v2.webp"] },
    ],
    specs: {
      lengthMM: 70,
      drive: "2WD",
      topSpeedKmh: 14,
      batteryMin: 14,
      chargeMin: 25,
      rangeM: 25,
      minAge: 8,
      led: "Headlight",
      drift: "Yes",
    },
  },
  {
    id: "pocket-f1-ferrari",
    slug: "pocket-f1-ferrari",
    scale: "1:64",
    name: "Pocket F1 Ferrari White",
    tagline: "Ferrari-livery aero · white edition · race-detail body",
    retailINR: 1299,
    mrpINR: 1999,
    bullets: [
      "Trasped HG4-234 Ferrari-style F1 in white",
      "Detailed aero kit + exposed wheels",
      "2.4 GHz · race 3 cars side-by-side",
      "USB-C · LED headlights · drift wheels swap",
    ],
    bodyShape: "Ferrari-style F1, white livery",
    hidden: true,
    heroImage: "/products/PRC-f1-ferrari.webp",
    altImages: [
      "/products/PRC-f1-ferrari-2.webp",
      "/products/PRC-f1-ferrari-3.webp",
      "/products/PRC-f1-ferrari-4.webp",
    ],
    specs: {
      lengthMM: 70,
      drive: "2WD",
      topSpeedKmh: 15,
      batteryMin: 15,
      chargeMin: 30,
      rangeM: 25,
      minAge: 8,
      led: "Tail + Headlight",
      drift: "Yes",
    },
  },
  {
    id: "pocket-beetle",
    slug: "pocket-beetle",
    scale: "1:64",
    name: "Pocket Beetle",
    tagline: "Round-body classic · pocket-friendly drift · iconic curves",
    retailINR: 1299,
    mrpINR: 1999,
    bullets: [
      "Trasped HG4-216 Beetle-style body",
      "Smooth drift on tile + marble",
      "USB-C · 12-15 min real drift per charge",
      "LED tail-lights · age 6+ friendly",
    ],
    bodyShape: "VW Beetle-style round-roof",
    hidden: true,
    heroImage: "/products/PRC-beetle.webp",
    altImages: [
      "/products/PRC-beetle-2.webp",
      "/products/PRC-beetle-3.webp",
      "/products/PRC-beetle-4.webp",
    ],
    specs: {
      lengthMM: 68,
      drive: "2WD",
      topSpeedKmh: 12,
      batteryMin: 14,
      chargeMin: 25,
      rangeM: 22,
      minAge: 6,
      led: "Tail-light",
      drift: "Yes",
    },
  },
  {
    id: "pocket-f1-driver",
    slug: "pocket-f1-driver",
    scale: "1:64",
    name: "Pocket F1 + Driver",
    tagline: "Premium tier · with mounted driver figurine · collector grade",
    retailINR: 1899,
    mrpINR: 2699,
    bullets: [
      "F1 Leclerc-style body with seated driver figurine",
      "Higher-detail livery + collector finish",
      "Same Trasped 2.4 GHz drift chassis",
      "Premium gift box · display-ready",
    ],
    badge: "PRO",
    bodyShape: "F1 Leclerc-style with driver",
    hidden: true,
    heroImage: "/products/PRC-f1-driver.webp",
    altImages: [
      "/products/PRC-f1-driver-2.webp",
      "/products/PRC-f1-driver-3.webp",
      "/products/PRC-f1-driver-4.webp",
    ],
    specs: {
      lengthMM: 72,
      drive: "2WD",
      topSpeedKmh: 15,
      batteryMin: 15,
      chargeMin: 30,
      rangeM: 28,
      minAge: 8,
      led: "Tail + Headlight",
      drift: "Pro drift mode",
    },
  },
  // ---- 1:64 "RC AI" batch (2026-07) — new bodies on the same 1:64 chassis.
  //      Online (UPI) price = retailINR − ₹100; COD = retailINR; MRP ~30% off.
  //      Media: /products/rcai/<slug>/<colour>[-N].webp (AI product art). ----
  {
    id: "cybertruck-camper",
    slug: "cybertruck-camper",
    scale: "1:64",
    name: "Mini Cybertruck Camper",
    tagline: "Angular EV pickup + pop-top camper · 2.4 GHz · LED",
    retailINR: 2099,
    mrpINR: 2999,
    bullets: [
      "Cybertruck-style body with detachable camper shell",
      "2.4 GHz · race up to 3 side-by-side",
      "USB-C · 12–15 min run per charge",
      "Full-function RC · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "Angular EV pickup + camper",
    heroImage: "/products/rcai/cybertruck-camper/default.webp",
    altImages: [
      "/products/rcai/cybertruck-camper/default-2.webp",
      "/products/rcai/cybertruck-camper/default-3.webp",
      "/products/rcai/cybertruck-camper/default-4.webp",
    ],
    specs: {
      lengthMM: 80,
      drive: "4WD",
      topSpeedKmh: 13,
      batteryMin: 14,
      chargeMin: 35,
      rangeM: 25,
      minAge: 6,
      led: "Head + Tail",
      drift: "No — grip tyres",
    },
  },
  {
    id: "ferrari-drift",
    slug: "ferrari-drift",
    scale: "1:64",
    name: "Mini Ferrari Drift",
    tagline: "Prancing-horse GT · pro drift wheels · 4 colours",
    retailINR: 1599,
    mrpINR: 2299,
    bullets: [
      "Ferrari-style GT die-cast body",
      "Pre-tuned drift wheels · tail-out on tap",
      "2.4 GHz · USB-C · LED head + tail lights",
      "Pick from 4 colours · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "Ferrari-style GT coupe",
    heroImage: "/products/rcai/ferrari-drift/red.webp",
    altImages: [
      "/products/rcai/ferrari-drift/red-2.webp",
      "/products/rcai/ferrari-drift/red-3.webp",
      "/products/rcai/ferrari-drift/red-4.webp",
    ],
    colors: [
      { name: "Red", slug: "red", swatch: "#e11d2a", stock: 30, image: "/products/rcai/ferrari-drift/red.webp",
        altImages: ["/products/rcai/ferrari-drift/red-2.webp", "/products/rcai/ferrari-drift/red-3.webp", "/products/rcai/ferrari-drift/red-4.webp"] },
      { name: "Black", slug: "black", swatch: "#111827", stock: 24, image: "/products/rcai/ferrari-drift/black.webp",
        altImages: ["/products/rcai/ferrari-drift/black-2.webp", "/products/rcai/ferrari-drift/black-3.webp", "/products/rcai/ferrari-drift/black-4.webp"] },
      { name: "White", slug: "white", swatch: "#f1f1ef", stock: 22, image: "/products/rcai/ferrari-drift/white.webp",
        altImages: ["/products/rcai/ferrari-drift/white-2.webp", "/products/rcai/ferrari-drift/white-3.webp", "/products/rcai/ferrari-drift/white-4.webp"] },
      { name: "Yellow", slug: "yellow", swatch: "#f4c400", stock: 18, image: "/products/rcai/ferrari-drift/yellow.webp",
        altImages: ["/products/rcai/ferrari-drift/yellow-2.webp", "/products/rcai/ferrari-drift/yellow-3.webp", "/products/rcai/ferrari-drift/yellow-4.webp"] },
    ],
    specs: {
      lengthMM: 74,
      drive: "4WD",
      topSpeedKmh: 15,
      batteryMin: 14,
      chargeMin: 30,
      rangeM: 28,
      minAge: 8,
      led: "Head + Tail",
      drift: "Yes — pro drift wheels",
    },
  },
  {
    id: "mini-atv",
    slug: "mini-atv",
    scale: "1:64",
    name: "Mini ATV Quad",
    tagline: "Knobby-tyre quad · 4WD grip · all-terrain",
    retailINR: 1999,
    mrpINR: 2899,
    bullets: [
      "Chunky all-terrain quad-bike body",
      "4WD grip tyres · climbs rough ground",
      "2.4 GHz · USB-C rechargeable",
      "Full-function RC · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "All-terrain ATV quad",
    heroImage: "/products/rcai/mini-atv/default.webp",
    altImages: [
      "/products/rcai/mini-atv/default-2.webp",
      "/products/rcai/mini-atv/default-3.webp",
      "/products/rcai/mini-atv/default-4.webp",
    ],
    specs: {
      lengthMM: 70,
      drive: "4WD",
      topSpeedKmh: 12,
      batteryMin: 15,
      chargeMin: 35,
      rangeM: 22,
      minAge: 6,
      led: "Head lamp",
      drift: "No — off-road grip",
    },
  },
  {
    id: "mini-bmw-m4",
    slug: "mini-bmw-m4",
    scale: "1:64",
    name: "Mini BMW M4",
    tagline: "Wide-body M coupe · drift-tuned · LED",
    retailINR: 1599,
    mrpINR: 2299,
    bullets: [
      "Wide-body M-style coupe die-cast",
      "Drift-tuned wheels · 2.4 GHz control",
      "USB-C · LED head + tail lights",
      "Silver or Black · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "Wide-body M coupe",
    heroImage: "/products/rcai/mini-bmw-m4/grey.webp",
    altImages: [
      "/products/rcai/mini-bmw-m4/grey-2.webp",
      "/products/rcai/mini-bmw-m4/grey-3.webp",
      "/products/rcai/mini-bmw-m4/grey-4.webp",
    ],
    colors: [
      { name: "Silver", slug: "silver", swatch: "#c8ccce", stock: 26, image: "/products/rcai/mini-bmw-m4/grey.webp",
        altImages: ["/products/rcai/mini-bmw-m4/grey-2.webp", "/products/rcai/mini-bmw-m4/grey-3.webp", "/products/rcai/mini-bmw-m4/grey-4.webp"] },
      { name: "Black", slug: "black", swatch: "#111827", stock: 20, image: "/products/rcai/mini-bmw-m4/black.webp",
        altImages: ["/products/rcai/mini-bmw-m4/black-2.webp", "/products/rcai/mini-bmw-m4/black-3.webp", "/products/rcai/mini-bmw-m4/black-4.webp"] },
    ],
    specs: {
      lengthMM: 74,
      drive: "4WD",
      topSpeedKmh: 15,
      batteryMin: 14,
      chargeMin: 30,
      rangeM: 28,
      minAge: 8,
      led: "Head + Tail",
      drift: "Yes — drift wheels",
    },
  },
  {
    id: "mini-land-rover",
    slug: "mini-land-rover",
    scale: "1:64",
    name: "Mini Land Rover",
    tagline: "Boxy off-roader · roof rack + bull bar · 4WD",
    retailINR: 1899,
    mrpINR: 2699,
    bullets: [
      "Boxy Defender-style off-road body",
      "Roof rack + bull bar detailing · 4WD",
      "2.4 GHz · USB-C rechargeable",
      "Lilac or Sand · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "Boxy off-road SUV",
    heroImage: "/products/rcai/mini-land-rover/two.webp",
    altImages: [
      "/products/rcai/mini-land-rover/two-2.webp",
      "/products/rcai/mini-land-rover/two-3.webp",
      "/products/rcai/mini-land-rover/two-4.webp",
    ],
    colors: [
      { name: "Sand", slug: "sand", swatch: "#c9b183", stock: 22, image: "/products/rcai/mini-land-rover/two.webp",
        altImages: ["/products/rcai/mini-land-rover/two-2.webp", "/products/rcai/mini-land-rover/two-3.webp", "/products/rcai/mini-land-rover/two-4.webp"] },
      { name: "Lilac", slug: "lilac", swatch: "#b9a3dd", stock: 18, image: "/products/rcai/mini-land-rover/one.webp",
        altImages: ["/products/rcai/mini-land-rover/one-2.webp", "/products/rcai/mini-land-rover/one-3.webp", "/products/rcai/mini-land-rover/one-4.webp"] },
    ],
    specs: {
      lengthMM: 78,
      drive: "4WD",
      topSpeedKmh: 12,
      batteryMin: 15,
      chargeMin: 35,
      rangeM: 24,
      minAge: 6,
      led: "Head + roof",
      drift: "No — off-road grip",
    },
  },
  {
    id: "mini-porsche",
    slug: "mini-porsche",
    scale: "1:64",
    name: "Mini Porsche GT3",
    tagline: "911 GT3 RS silhouette · drift wheels · LED",
    retailINR: 1599,
    mrpINR: 2299,
    bullets: [
      "911 GT3 RS-style body with rear wing",
      "Pre-tuned drift wheels · 2.4 GHz",
      "USB-C · LED head + tail lights",
      "White or Blue · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "911 GT3 RS-style",
    heroImage: "/products/rcai/mini-porsche/silver.webp",
    altImages: [
      "/products/rcai/mini-porsche/silver-2.webp",
      "/products/rcai/mini-porsche/silver-3.webp",
      "/products/rcai/mini-porsche/silver-4.webp",
    ],
    colors: [
      { name: "White", slug: "white", swatch: "#f1f1ef", stock: 24, image: "/products/rcai/mini-porsche/silver.webp",
        altImages: ["/products/rcai/mini-porsche/silver-2.webp", "/products/rcai/mini-porsche/silver-3.webp", "/products/rcai/mini-porsche/silver-4.webp"] },
      { name: "Blue", slug: "blue", swatch: "#1d4ed8", stock: 20, image: "/products/rcai/mini-porsche/blue.webp",
        altImages: ["/products/rcai/mini-porsche/blue-2.webp", "/products/rcai/mini-porsche/blue-3.webp", "/products/rcai/mini-porsche/blue-4.webp"] },
    ],
    specs: {
      lengthMM: 73,
      drive: "4WD",
      topSpeedKmh: 15,
      batteryMin: 14,
      chargeMin: 30,
      rangeM: 28,
      minAge: 8,
      led: "Head + Tail",
      drift: "Yes — pro drift wheels",
    },
  },
  {
    id: "rc-tractor",
    slug: "rc-tractor",
    scale: "1:64",
    name: "Mini RC Tractor",
    tagline: "Farm tractor · big rear tyres · 2.4 GHz",
    retailINR: 1999,
    mrpINR: 2899,
    bullets: [
      "Detailed farm-tractor body + big rear tyres",
      "2.4 GHz full-function control",
      "USB-C rechargeable · LED work lamp",
      "Blue or Yellow · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "Farm tractor",
    heroImage: "/products/rcai/rc-tractor/blue.webp",
    altImages: [
      "/products/rcai/rc-tractor/blue-2.webp",
      "/products/rcai/rc-tractor/blue-3.webp",
      "/products/rcai/rc-tractor/blue-4.webp",
    ],
    colors: [
      { name: "Blue", slug: "blue", swatch: "#1d4ed8", stock: 22, image: "/products/rcai/rc-tractor/blue.webp",
        altImages: ["/products/rcai/rc-tractor/blue-2.webp", "/products/rcai/rc-tractor/blue-3.webp", "/products/rcai/rc-tractor/blue-4.webp"] },
      { name: "Yellow", slug: "yellow", swatch: "#f4c400", stock: 20, image: "/products/rcai/rc-tractor/yellow.webp",
        altImages: ["/products/rcai/rc-tractor/yellow-2.webp", "/products/rcai/rc-tractor/yellow-3.webp", "/products/rcai/rc-tractor/yellow-4.webp"] },
    ],
    specs: {
      lengthMM: 70,
      drive: "2WD",
      topSpeedKmh: 8,
      batteryMin: 18,
      chargeMin: 35,
      rangeM: 20,
      minAge: 6,
      led: "Work lamp",
      drift: "No — farm grip",
    },
  },
  {
    id: "tiger-monster",
    slug: "tiger-monster",
    scale: "1:64",
    name: "Tiger Monster Truck",
    tagline: "Monster 4x4 · giant grip tyres · bounce-proof",
    retailINR: 1999,
    mrpINR: 2899,
    bullets: [
      "Monster-truck body on giant grip tyres",
      "4WD · climbs and crushes obstacles",
      "2.4 GHz · USB-C rechargeable",
      "Tough bounce-proof shell · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "Monster truck 4x4",
    heroImage: "/products/rcai/tiger-monster/default.webp",
    altImages: [
      "/products/rcai/tiger-monster/default-2.webp",
      "/products/rcai/tiger-monster/default-3.webp",
      "/products/rcai/tiger-monster/default-4.webp",
    ],
    specs: {
      lengthMM: 82,
      drive: "4WD",
      topSpeedKmh: 14,
      batteryMin: 14,
      chargeMin: 35,
      rangeM: 25,
      minAge: 6,
      led: "Head lamp",
      drift: "No — monster grip",
    },
  },
  {
    id: "toyota-trueno",
    slug: "toyota-trueno",
    scale: "1:64",
    name: "Toyota Trueno AE86",
    tagline: "AE86 panda drift legend · pro drift wheels",
    retailINR: 1599,
    mrpINR: 2299,
    bullets: [
      "AE86 Trueno panda-style drift body",
      "Pre-tuned drift wheels · tail-out on tap",
      "2.4 GHz · USB-C · LED pop-up lights",
      "Red or White · 7-day replacement",
    ],
    badge: "NEW",
    bodyShape: "AE86 Trueno hatch",
    heroImage: "/products/rcai/toyota-trueno/default.webp",
    altImages: [
      "/products/rcai/toyota-trueno/default-2.webp",
      "/products/rcai/toyota-trueno/default-3.webp",
      "/products/rcai/toyota-trueno/default-4.webp",
    ],
    colors: [
      { name: "Red", slug: "red", swatch: "#c81e1e", stock: 24, image: "/products/rcai/toyota-trueno/default.webp",
        altImages: ["/products/rcai/toyota-trueno/default-2.webp", "/products/rcai/toyota-trueno/default-3.webp", "/products/rcai/toyota-trueno/default-4.webp"] },
      { name: "White", slug: "white", swatch: "#eceae7", stock: 22, image: "/products/rcai/toyota-trueno/white.webp",
        altImages: ["/products/rcai/toyota-trueno/white-2.webp", "/products/rcai/toyota-trueno/white-3.webp", "/products/rcai/toyota-trueno/white-4.webp"] },
    ],
    specs: {
      lengthMM: 74,
      drive: "4WD",
      topSpeedKmh: 15,
      batteryMin: 14,
      chargeMin: 30,
      rangeM: 28,
      minAge: 8,
      led: "Pop-up + Tail",
      drift: "Yes — pro drift wheels",
    },
  },
  {
    id: "samtop-camera",
    slug: "samtop-camera",
    scale: "1:64",
    name: "Camera Drift RC — SAMTOP C6",
    tagline: "FPV camera drift car · stream to your phone · LED",
    retailINR: 2999,
    mrpINR: 4299,
    bullets: [
      "Built-in FPV camera — stream live to your phone",
      "Pro drift wheels · 2.4 GHz control",
      "USB-C · LED head + tail lights",
      "Black or White · 7-day replacement",
    ],
    badge: "PRO",
    bodyShape: "FPV-camera drift coupe",
    heroImage: "/products/rcai/samtop-camera/black.webp",
    altImages: [
      "/products/rcai/samtop-camera/black-2.webp",
      "/products/rcai/samtop-camera/black-3.webp",
      "/products/rcai/samtop-camera/black-4.webp",
    ],
    colors: [
      { name: "Black", slug: "black", swatch: "#111827", stock: 16, image: "/products/rcai/samtop-camera/black.webp",
        altImages: ["/products/rcai/samtop-camera/black-2.webp", "/products/rcai/samtop-camera/black-3.webp", "/products/rcai/samtop-camera/black-4.webp"] },
      { name: "White", slug: "white", swatch: "#f1f1ef", stock: 14, image: "/products/rcai/samtop-camera/white.webp",
        altImages: ["/products/rcai/samtop-camera/white-2.webp", "/products/rcai/samtop-camera/white-3.webp", "/products/rcai/samtop-camera/white-4.webp"] },
    ],
    specs: {
      lengthMM: 76,
      drive: "4WD",
      topSpeedKmh: 15,
      batteryMin: 12,
      chargeMin: 35,
      rangeM: 25,
      minAge: 10,
      led: "Head + Tail",
      drift: "Yes — FPV drift",
    },
  },
  // ---- 1:16 "Big" series (the /16 storefront) ----
  // Separate store, separate cart (useCart16), but the SAME order pipeline.
  // Excluded from the 1:64 grid/PDP via the scale filter in getVisibleProducts
  // and the /product PDP guard. Colourless SKUs (one colourway each) → inventory
  // key "". Specs scraped from the 1:16 competitor listings. Images are
  // placeholders until the real shoot lands.
  {
    id: "drift-inferno",
    slug: "drift-inferno",
    scale: "1:16",
    name: "Drift Inferno",
    tagline: "Pillar-box red · 4WD · 2.4 GHz full-proportional",
    retailINR: 2999,
    mrpINR: 3999,
    bullets: [
      "4WD drivetrain · up to ~25 km/h",
      "2.4 GHz full-proportional — steer, throttle, brake + speed trim",
      "ESP stability · rubber drift tyres + spare set",
      "USB-C rechargeable · full LED · ready-to-run",
    ],
    badge: "NEW",
    bodyShape: "1:16 drift car",
    heroImage: "/store16-images/drift-inferno/1-hero.webp",
    altImages: [
      "/store16-images/drift-inferno/2-side.webp",
      "/store16-images/drift-inferno/3-detail.webp",
      "/store16-images/drift-inferno/4-lifestyle.webp",
    ],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "drift-toxic",
    hidden: true, // merged into "Mercedes AMG GT3" (AI image) — kept for reference
    slug: "drift-toxic",
    scale: "1:16",
    name: "Drift Toxic",
    tagline: "Neon green · 4WD · 2.4 GHz full-proportional",
    retailINR: 2999,
    mrpINR: 3999,
    bullets: [
      "4WD drivetrain · up to ~25 km/h",
      "2.4 GHz full-proportional — steer, throttle, brake + speed trim",
      "ESP stability · rubber drift tyres + spare set",
      "USB-C rechargeable · full LED · ready-to-run",
    ],
    bodyShape: "1:16 drift car",
    heroImage: "/store16-images/drift-toxic/1-hero.webp",
    altImages: [
      "/store16-images/drift-toxic/2-side.webp",
      "/store16-images/drift-toxic/3-detail.webp",
      "/store16-images/drift-toxic/4-lifestyle.webp",
    ],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "drift-phantom",
    hidden: true, // merged into "BMW M4 DTM" (AI image) — kept for reference
    slug: "drift-phantom",
    scale: "1:16",
    name: "Drift Phantom",
    tagline: "Murdered-out black · 4WD · 2.4 GHz full-proportional",
    retailINR: 2999,
    mrpINR: 3999,
    bullets: [
      "4WD drivetrain · up to ~25 km/h",
      "2.4 GHz full-proportional — steer, throttle, brake + speed trim",
      "ESP stability · rubber drift tyres + spare set",
      "USB-C rechargeable · full LED · ready-to-run",
    ],
    bodyShape: "1:16 drift car",
    heroImage: "/store16-images/drift-phantom/1-hero.webp",
    altImages: [
      "/store16-images/drift-phantom/2-side.webp",
      "/store16-images/drift-phantom/3-detail.webp",
      "/store16-images/drift-phantom/4-lifestyle.webp",
    ],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "drift-carbon",
    hidden: true, // merged into "GT-R GT3" (AI image) — kept for reference
    slug: "drift-carbon",
    scale: "1:16",
    category: "big",
    badge: "NEW",
    name: "Speed Racing GT-R",
    tagline: "Carbon-fibre look · 4WD · 2.4 GHz full-proportional",
    retailINR: 2999,
    mrpINR: 3999,
    bullets: [
      "4WD drivetrain · up to ~25 km/h",
      "2.4 GHz full-proportional — steer, throttle, brake + speed trim",
      "ESP stability · rubber drift tyres + spare set",
      "USB-C rechargeable · full LED · ready-to-run",
    ],
    bodyShape: "1:16 drift car",
    heroImage: "/store16-images/drift-carbon/1-hero.webp",
    altImages: [
      "/store16-images/drift-carbon/2-side.webp",
      "/store16-images/drift-carbon/3-detail.webp",
      "/store16-images/drift-carbon/4-lifestyle.webp",
    ],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "dares-azure",
    slug: "dares-azure",
    scale: "1:16",
    name: "Dares Azure",
    tagline: "White & blue race livery · flagship · 4WD",
    retailINR: 3599,
    mrpINR: 4999,
    bullets: [
      "Sharper, wider race-livery shell",
      "4WD · up to ~25 km/h · 2.4 GHz full-proportional",
      "ESP stability · rubber drift tyres + spare set",
      "USB-C rechargeable · full LED · ready-to-run",
    ],
    badge: "PRO",
    bodyShape: "1:16 race-livery drift car",
    heroImage: "/store16-images/dares-azure/1-hero.webp",
    altImages: [
      "/store16-images/dares-azure/2-side.webp",
      "/store16-images/dares-azure/3-detail.webp",
      "/store16-images/dares-azure/4-lifestyle.webp",
    ],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "dares-recon",
    hidden: true, // merged into "Extreme Street Drift" (AI image) — kept for reference
    slug: "dares-recon",
    scale: "1:16",
    name: "Dares Recon",
    tagline: "Green & grey stealth livery · flagship · 4WD",
    retailINR: 3599,
    mrpINR: 4999,
    bullets: [
      "Sharper, wider race-livery shell",
      "4WD · up to ~25 km/h · 2.4 GHz full-proportional",
      "ESP stability · rubber drift tyres + spare set",
      "USB-C rechargeable · full LED · ready-to-run",
    ],
    badge: "PRO",
    bodyShape: "1:16 race-livery drift car",
    heroImage: "/store16-images/dares-recon/1-hero.webp",
    altImages: [
      "/store16-images/dares-recon/2-side.webp",
      "/store16-images/dares-recon/3-detail.webp",
      "/store16-images/dares-recon/4-lifestyle.webp",
    ],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },

  // -----------------------------------------------------------------------
  // INTERNAL QA SKU — accessible via /product/qa-1rs but excluded from the
  // catalog, sitemap, and static params. Priced so that subtotal (₹16) plus
  // shipping (₹85, no free-ship since <₹1099) minus the UPI prepaid
  // discount (₹100) lands exactly at ₹1. Use for end-to-end live smoke
  // tests without burning ₹1,299 per attempt. Stock is seeded by
  // src/db/seed-inventory.ts with variant_slug = ''.
  // -----------------------------------------------------------------------
  // ---- COMING SOON teasers (2026-07) — shown in the hub category grid only,
  //      no price/stock yet. Excluded from live storefronts, PDPs, sitemap and
  //      checkout via `comingSoon`. Prices land later. ----
  {
    id: "bmw-m4-dtm", slug: "bmw-m4-dtm", scale: "1:16", category: "big",
    name: "BMW M4 DTM", tagline: "Murdered-out black · 4WD · 2.4 GHz full-proportional",
    retailINR: 2999, mrpINR: 3999, badge: "NEW",
    bullets: ["4WD drivetrain · up to ~25 km/h", "2.4 GHz full-proportional — steer, throttle, brake + speed trim", "ESP stability · rubber drift tyres + spare set", "USB-C rechargeable · full LED · ready-to-run"],
    bodyShape: "1:16 drift car",
    heroImage: "/products/rcai/bmw-m4-dtm/default.webp",
    altImages: ["/products/rcai/bmw-m4-dtm/default-2.webp", "/products/rcai/bmw-m4-dtm/default-3.webp", "/products/rcai/bmw-m4-dtm/default-4.webp"],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "extreme-street-drift", slug: "extreme-street-drift", scale: "1:16", category: "big",
    name: "Extreme Street Drift", tagline: "Green & grey stealth livery · flagship · 4WD",
    retailINR: 3599, mrpINR: 4999, badge: "PRO",
    bullets: ["Sharper, wider race-livery shell", "4WD · up to ~25 km/h · 2.4 GHz full-proportional", "ESP stability · rubber drift tyres + spare set", "USB-C rechargeable · full LED · ready-to-run"],
    bodyShape: "1:16 race-livery drift car",
    heroImage: "/products/rcai/extreme-street-drift/default.webp",
    altImages: ["/products/rcai/extreme-street-drift/default-2.webp", "/products/rcai/extreme-street-drift/default-3.webp", "/products/rcai/extreme-street-drift/default-4.webp"],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "gtr-gt3", slug: "gtr-gt3", scale: "1:16", category: "big",
    name: "GT-R GT3", tagline: "Carbon-fibre look · 4WD · 2.4 GHz full-proportional",
    retailINR: 2999, mrpINR: 3999, badge: "NEW",
    bullets: ["4WD drivetrain · up to ~25 km/h", "2.4 GHz full-proportional — steer, throttle, brake + speed trim", "ESP stability · rubber drift tyres + spare set", "USB-C rechargeable · full LED · ready-to-run"],
    bodyShape: "1:16 drift car",
    heroImage: "/products/rcai/gtr-gt3/default.webp",
    altImages: ["/products/rcai/gtr-gt3/default-2.webp", "/products/rcai/gtr-gt3/default-3.webp", "/products/rcai/gtr-gt3/default-4.webp"],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "mercedes-amg-gt3", slug: "mercedes-amg-gt3", scale: "1:16", category: "big",
    name: "Mercedes AMG GT3", tagline: "Neon green · 4WD · 2.4 GHz full-proportional",
    retailINR: 2999, mrpINR: 3999, badge: "NEW",
    bullets: ["4WD drivetrain · up to ~25 km/h", "2.4 GHz full-proportional — steer, throttle, brake + speed trim", "ESP stability · rubber drift tyres + spare set", "USB-C rechargeable · full LED · ready-to-run"],
    bodyShape: "1:16 drift car",
    heroImage: "/products/rcai/mercedes-amg-gt3/default.webp",
    altImages: ["/products/rcai/mercedes-amg-gt3/default-2.webp", "/products/rcai/mercedes-amg-gt3/default-3.webp", "/products/rcai/mercedes-amg-gt3/default-4.webp"],
    specs: { lengthMM: 280, drive: "4WD", topSpeedKmh: 25, batteryMin: 18, chargeMin: 90, rangeM: 30, minAge: 6, led: "Full LED", drift: "ESP-assisted" },
  },
  {
    id: "lamborghini-vision-gt", slug: "lamborghini-vision-gt", scale: "1:20", category: "s20",
    name: "Lamborghini Vision GT", tagline: "1:20 concept hypercar · 2.4 GHz · LED",
    retailINR: 1799, mrpINR: 2599,
    bullets: ["1:20 Vision GT-style body", "2.4 GHz full-function control", "USB-C · LED lights", "7-day replacement"],
    badge: "NEW",
    bodyShape: "Vision GT concept",
    heroImage: "/products/rcai/lamborghini-vision-gt/default.webp",
    altImages: ["/products/rcai/lamborghini-vision-gt/default-2.webp", "/products/rcai/lamborghini-vision-gt/default-3.webp", "/products/rcai/lamborghini-vision-gt/default-4.webp"],
    specs: { lengthMM: 210, drive: "4WD", topSpeedKmh: 16, batteryMin: 15, chargeMin: 60, rangeM: 25, minAge: 8, led: "Head + Tail", drift: "Yes" },
  },
  {
    id: "toyota-ae86-20", slug: "toyota-ae86-20", scale: "1:20", category: "s20",
    name: "Toyota AE86 Trueno · 1:20", tagline: "1:20 AE86 drift legend · 2.4 GHz · LED",
    retailINR: 1699, mrpINR: 2399,
    bullets: ["1:20 AE86 Trueno body", "2.4 GHz full-function control", "USB-C · LED lights", "7-day replacement"],
    badge: "NEW",
    bodyShape: "AE86 Trueno hatch",
    heroImage: "/products/rcai/toyota-ae86-20/default.webp",
    altImages: ["/products/rcai/toyota-ae86-20/default-2.webp", "/products/rcai/toyota-ae86-20/default-3.webp", "/products/rcai/toyota-ae86-20/default-4.webp"],
    specs: { lengthMM: 210, drive: "4WD", topSpeedKmh: 16, batteryMin: 15, chargeMin: 60, rangeM: 25, minAge: 8, led: "Pop-up + Tail", drift: "Yes" },
  },
  {
    id: "track-rover", slug: "track-rover", scale: "1:20", category: "s20",
    name: "Track Rover", tagline: "1:20 rally off-roader · 2.4 GHz · LED",
    retailINR: 1799, mrpINR: 2599,
    bullets: ["1:20 rally off-road body", "2.4 GHz full-function control", "USB-C · LED lights", "7-day replacement"],
    badge: "NEW",
    bodyShape: "Rally off-roader",
    heroImage: "/products/rcai/track-rover/default.webp",
    altImages: ["/products/rcai/track-rover/default-2.webp", "/products/rcai/track-rover/default-3.webp", "/products/rcai/track-rover/default-4.webp"],
    specs: { lengthMM: 210, drive: "4WD", topSpeedKmh: 14, batteryMin: 15, chargeMin: 60, rangeM: 24, minAge: 8, led: "Head + roof", drift: "No" },
  },
  {
    id: "vw-polo-95-white", slug: "vw-polo-95-white", scale: "1:20", category: "polo",
    name: "VW Polo Racing 95 — White", tagline: "1:20 Polo racing hot-hatch · 2.4 GHz · LED",
    retailINR: 1899, mrpINR: 2699,
    bullets: ["Polo racing hot-hatch body", "2.4 GHz full-function control", "USB-C · LED head + tail lights", "7-day replacement"],
    badge: "NEW",
    bodyShape: "Racing hot-hatch",
    heroImage: "/products/rcai/vw-polo-95/white.webp",
    altImages: ["/products/rcai/vw-polo-95/white-2.webp", "/products/rcai/vw-polo-95/white-3.webp", "/products/rcai/vw-polo-95/white-4.webp"],
    specs: { lengthMM: 210, drive: "2WD", topSpeedKmh: 16, batteryMin: 15, chargeMin: 60, rangeM: 25, minAge: 8, led: "Head + Tail", drift: "No" },
  },
  {
    id: "vw-polo-95-blue", slug: "vw-polo-95-blue", scale: "1:20", category: "polo",
    name: "VW Polo Racing 95 — Blue", tagline: "1:20 Polo racing hot-hatch · 2.4 GHz · LED",
    retailINR: 1899, mrpINR: 2699,
    bullets: ["Polo racing hot-hatch body", "2.4 GHz full-function control", "USB-C · LED head + tail lights", "7-day replacement"],
    badge: "NEW",
    bodyShape: "Racing hot-hatch",
    heroImage: "/products/rcai/vw-polo-95/blue.webp",
    altImages: ["/products/rcai/vw-polo-95/blue-2.webp", "/products/rcai/vw-polo-95/blue-3.webp", "/products/rcai/vw-polo-95/blue-4.webp"],
    specs: { lengthMM: 210, drive: "2WD", topSpeedKmh: 16, batteryMin: 15, chargeMin: 60, rangeM: 25, minAge: 8, led: "Head + Tail", drift: "No" },
  },
  {
    // Fixed-price bundle SKU: one cart line at ₹4,999 that represents all three
    // construction rigs. Priced as its own product so checkout/receipts hit the
    // exact ₹4,999 (the % ladder can't land on that number). Ships as all 3.
    id: "construction-3pack", slug: "construction-3pack", scale: "1:64", category: "construction", bundle: true,
    name: "Construction 3-Pack", tagline: "Mining Truck + Excavator + Forklift — all three, one price",
    retailINR: 4999, mrpINR: 6297,
    bullets: ["Heavy Duty Mining Truck included", "Mini RC Excavator included", "Mini RC Forklift included", "Save ~₹1,300 vs buying all three separately"],
    badge: "NEW",
    bodyShape: "3-in-1 construction bundle",
    heroImage: "/landing/construction-3pack.webp",
    altImages: [],
    specs: { lengthMM: 120, drive: "4WD", topSpeedKmh: 8, batteryMin: 20, chargeMin: 60, rangeM: 20, minAge: 6, led: "Work lamps", drift: "No" },
  },
  {
    id: "mining-truck", slug: "mining-truck", scale: "1:64", category: "construction",
    name: "Heavy Duty Mining Truck", tagline: "RC haul truck · 2.4 GHz · work lamp",
    retailINR: 2099, mrpINR: 2999,
    bullets: ["Heavy-duty mining haul body", "2.4 GHz full-function control", "USB-C rechargeable", "7-day replacement"],
    badge: "NEW",
    bodyShape: "Mining haul truck",
    // The shared default list describes the 1:64 drift cars (drift wheels etc.),
    // which is wrong for a construction toy.
    inBox: ["1:64 RC mining truck (assembled)", "2.4 GHz gamepad remote", "USB-C charging cable", "Gift-ready box"],
    heroImage: "/products/rcai/mining-truck/default.webp",
    altImages: ["/products/rcai/mining-truck/default-2.webp", "/products/rcai/mining-truck/default-3.webp", "/products/rcai/mining-truck/default-4.webp"],
    // Sep 2026 colour shoot — see the excavator note above.
    colors: [
      { name: "Yellow", slug: "yellow", swatch: "#f4b41a", stock: 10, image: "/products/rcai/mining-truck/default.webp",
        altImages: ["/products/rcai/mining-truck/default-2.webp", "/products/rcai/mining-truck/default-3.webp", "/products/rcai/mining-truck/default-4.webp"] },
      { name: "Blue", slug: "blue", swatch: "#29a3d9", stock: 10, image: "/products/rcai/mining-truck/blue.webp",
        altImages: ["/products/rcai/mining-truck/blue-2.webp", "/products/rcai/mining-truck/blue-3.webp", "/products/rcai/mining-truck/blue-4.webp"] },
      { name: "Green", slug: "green", swatch: "#8bc11f", stock: 10, image: "/products/rcai/mining-truck/green.webp",
        altImages: ["/products/rcai/mining-truck/green-2.webp", "/products/rcai/mining-truck/green-3.webp", "/products/rcai/mining-truck/green-4.webp"] },
      { name: "Red", slug: "red", swatch: "#d32f2f", stock: 10, image: "/products/rcai/mining-truck/red.webp",
        altImages: ["/products/rcai/mining-truck/red-2.webp", "/products/rcai/mining-truck/red-3.webp", "/products/rcai/mining-truck/red-4.webp"] },
    ],
    specs: { lengthMM: 120, drive: "4WD", topSpeedKmh: 8, batteryMin: 20, chargeMin: 60, rangeM: 20, minAge: 6, led: "Work lamp", drift: "No" },
  },
  {
    id: "rc-excavator", slug: "rc-excavator", scale: "1:64", category: "construction",
    name: "Mini RC Excavator", tagline: "RC digger with working arm · 2.4 GHz",
    retailINR: 2099, mrpINR: 2999,
    bullets: ["Excavator with articulating arm", "2.4 GHz full-function control", "USB-C rechargeable", "7-day replacement"],
    badge: "NEW",
    bodyShape: "Tracked excavator",
    inBox: ["1:64 RC excavator (assembled)", "2.4 GHz gamepad remote", "USB-C charging cable", "Gift-ready box"],
    heroImage: "/products/rcai/rc-excavator/default.webp",
    altImages: ["/products/rcai/rc-excavator/default-2.webp", "/products/rcai/rc-excavator/default-3.webp", "/products/rcai/rc-excavator/default-4.webp"],
    // Sep 2026 colour shoot. Yellow carries the original stock; the new colours
    // are 0 until the owner confirms counts (STOCK_REVIEW_REQUIRED).
    colors: [
      { name: "Yellow", slug: "yellow", swatch: "#f4b41a", stock: 10, image: "/products/rcai/rc-excavator/default.webp",
        altImages: ["/products/rcai/rc-excavator/default-2.webp", "/products/rcai/rc-excavator/default-3.webp", "/products/rcai/rc-excavator/default-4.webp"] },
      { name: "Sky Blue", slug: "sky-blue", swatch: "#4fc3e8", stock: 10, image: "/products/rcai/rc-excavator/sky-blue.webp",
        altImages: ["/products/rcai/rc-excavator/sky-blue-2.webp", "/products/rcai/rc-excavator/sky-blue-3.webp", "/products/rcai/rc-excavator/sky-blue-4.webp"] },
      { name: "Dark Blue", slug: "dark-blue", swatch: "#1f47c4", stock: 10, image: "/products/rcai/rc-excavator/dark-blue.webp",
        altImages: ["/products/rcai/rc-excavator/dark-blue-2.webp", "/products/rcai/rc-excavator/dark-blue-3.webp", "/products/rcai/rc-excavator/dark-blue-4.webp"] },
      { name: "Green", slug: "green", swatch: "#8bc11f", stock: 10, image: "/products/rcai/rc-excavator/green.webp",
        altImages: ["/products/rcai/rc-excavator/green-2.webp", "/products/rcai/rc-excavator/green-3.webp", "/products/rcai/rc-excavator/green-4.webp"] },
      { name: "Orange", slug: "orange", swatch: "#f4511e", stock: 10, image: "/products/rcai/rc-excavator/orange.webp",
        altImages: ["/products/rcai/rc-excavator/orange-2.webp", "/products/rcai/rc-excavator/orange-3.webp", "/products/rcai/rc-excavator/orange-4.webp"] },
      { name: "Pink", slug: "pink", swatch: "#f48fb1", stock: 10, image: "/products/rcai/rc-excavator/pink.webp",
        altImages: ["/products/rcai/rc-excavator/pink-2.webp", "/products/rcai/rc-excavator/pink-3.webp", "/products/rcai/rc-excavator/pink-4.webp"] },
    ],
    specs: { lengthMM: 120, drive: "2WD", topSpeedKmh: 5, batteryMin: 20, chargeMin: 60, rangeM: 18, minAge: 6, led: "Work lamp", drift: "No" },
  },
  {
    id: "rc-forklift", slug: "rc-forklift", scale: "1:64", category: "construction",
    name: "Mini RC Forklift", tagline: "RC forklift with lift mast · 2.4 GHz",
    retailINR: 2099, mrpINR: 2999,
    bullets: ["Forklift with working lift mast", "2.4 GHz full-function control", "USB-C rechargeable", "7-day replacement"],
    badge: "NEW",
    bodyShape: "Warehouse forklift",
    inBox: ["1:64 RC forklift (assembled)", "2.4 GHz gamepad remote", "USB-C charging cable", "Gift-ready box"],
    heroImage: "/products/rcai/rc-forklift/default.webp",
    altImages: ["/products/rcai/rc-forklift/default-2.webp", "/products/rcai/rc-forklift/default-3.webp", "/products/rcai/rc-forklift/default-4.webp"],
    // Sep 2026 colour shoot — see the excavator note above.
    colors: [
      { name: "Yellow", slug: "yellow", swatch: "#f4b41a", stock: 10, image: "/products/rcai/rc-forklift/default.webp",
        altImages: ["/products/rcai/rc-forklift/default-2.webp", "/products/rcai/rc-forklift/default-3.webp", "/products/rcai/rc-forklift/default-4.webp"] },
      { name: "Blue", slug: "blue", swatch: "#29a3d9", stock: 10, image: "/products/rcai/rc-forklift/blue.webp",
        altImages: ["/products/rcai/rc-forklift/blue-2.webp", "/products/rcai/rc-forklift/blue-3.webp", "/products/rcai/rc-forklift/blue-4.webp"] },
      { name: "Pink", slug: "pink", swatch: "#f48fb1", stock: 10, image: "/products/rcai/rc-forklift/pink.webp",
        altImages: ["/products/rcai/rc-forklift/pink-2.webp", "/products/rcai/rc-forklift/pink-3.webp", "/products/rcai/rc-forklift/pink-4.webp"] },
      { name: "Red", slug: "red", swatch: "#d32f2f", stock: 10, image: "/products/rcai/rc-forklift/red.webp",
        altImages: ["/products/rcai/rc-forklift/red-2.webp", "/products/rcai/rc-forklift/red-3.webp", "/products/rcai/rc-forklift/red-4.webp"] },
    ],
    specs: { lengthMM: 110, drive: "2WD", topSpeedKmh: 5, batteryMin: 20, chargeMin: 60, rangeM: 16, minAge: 6, led: "Work lamp", drift: "No" },
  },
  // ---- Sep 2026 intake (photo shoot 2026-09-15) ----------------------------
  // Prices are the owner's COD prices from the Bharath Cycle Hub price list
  // (2026-09-16; .50 rounded to the rupee). No MRP was given, so mrpINR equals
  // retailINR and no strikethrough shows. Stock = listed qty (code `stock` for
  // colour variants, `inventory` rows in the DB). The Huina cement mixer is not
  // on the list: ₹6,375 matches the owner's price for its 1:18 Huina sibling
  // (1533 dump truck) — PRICE_REVIEW_REQUIRED + STOCK_REVIEW_REQUIRED.
  // Spec rows state only what is verified from the product, its remote or the
  // confirmed model. Gallery = 4 images; extra colours get their own hero and
  // share the primary colour's images 2-4.
  {
    id: "mustang-gt500", slug: "mustang-gt500", kind: "RC", scale: "1:10", category: "hobby",
    name: "Mustang GT500", tagline: "1:10 muscle-car RC · twin racing stripes · race wing",
    retailINR: 53125, mrpINR: 53125, badge: "NEW",
    bullets: ["Licensed-look 1:10 GT500 body, metallic blue with white stripes", "4WD with a sensored brushless motor and 80A ESC", "Up to 47 km/h on 2S, 70 km/h on 3S", "2.4GHz radio with ~120 m range"],
    bodyShape: "1:10 muscle coupe",
    heroImage: "/products/rcai/mustang-gt500/default.webp",
    altImages: ["/products/rcai/mustang-gt500/default-2.webp", "/products/rcai/mustang-gt500/default-3.webp", "/products/rcai/mustang-gt500/default-4.webp"],
    specs: { drive: "4WD" },
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:10 RC car", "Pistol-grip remote"],
  },
  {
    id: "defender-crawler-16", slug: "defender-crawler-16", kind: "RC", scale: "1:16", category: "hobby",
    name: "Defender Crawler", tagline: "1:16 scale crawler · roof rack · rear spare",
    retailINR: 9188, mrpINR: 9188, badge: "NEW",
    bullets: ["Classic four-door Defender-style wagon body", "4WD crawler chassis with LED lights", "Roof rack with light bar, rear-door spare wheel", "2.4GHz remote · 7.4V rechargeable battery"],
    bodyShape: "1:16 scale crawler",
    heroImage: "/products/rcai/defender-crawler-16/yellow.webp",
    altImages: ["/products/rcai/defender-crawler-16/yellow-2.webp", "/products/rcai/defender-crawler-16/yellow-3.webp", "/products/rcai/defender-crawler-16/yellow-4.webp"],
    colors: [
      { name: "Yellow", slug: "yellow", swatch: "#d99a1e", stock: 1, image: "/products/rcai/defender-crawler-16/yellow.webp",
        altImages: ["/products/rcai/defender-crawler-16/yellow-2.webp", "/products/rcai/defender-crawler-16/yellow-3.webp", "/products/rcai/defender-crawler-16/yellow-4.webp"] },
      { name: "Black", slug: "black", swatch: "#1c1c1c", stock: 1, image: "/products/rcai/defender-crawler-16/black.webp",
        altImages: ["/products/rcai/defender-crawler-16/yellow-2.webp", "/products/rcai/defender-crawler-16/yellow-3.webp", "/products/rcai/defender-crawler-16/yellow-4.webp"] },
    ],
    specs: { drive: "4WD" },
    specRows: [{ label: "Colours", value: "Yellow, Black" }, { label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:16 RC crawler", "Pistol-grip remote"],
  },
  {
    id: "ford-pickup-crawler-16", slug: "ford-pickup-crawler-16", kind: "RC", scale: "1:16", category: "hobby",
    name: "Ford Pickup Crawler", tagline: "1:16 scale rock crawler · classic two-tone pickup",
    retailINR: 9188, mrpINR: 9188, badge: "NEW",
    bullets: ["Late-’70s full-size pickup body, blue over white", "Chrome-look grille and bumpers", "Cab-mounted roof light bar, tall crawler tyres", "Pistol-grip remote — trigger throttle, wheel steering"],
    bodyShape: "1:16 rock crawler",
    heroImage: "/products/rcai/ford-pickup-crawler-16/default.webp",
    altImages: ["/products/rcai/ford-pickup-crawler-16/default-2.webp", "/products/rcai/ford-pickup-crawler-16/default-3.webp", "/products/rcai/ford-pickup-crawler-16/default-4.webp"],
    specs: {},
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:16 RC crawler", "Pistol-grip remote"],
  },
  {
    id: "bronco-crawler-16", slug: "bronco-crawler-16", kind: "RC", scale: "1:16", category: "hobby",
    name: "Bronco Crawler", tagline: "1:16 scale crawler · hardtop · tailgate spare",
    retailINR: 9188, mrpINR: 9188, badge: "NEW",
    bullets: ["Modern four-door Bronco-style body in pale blue-grey", "4WD crawler chassis · ~10 km/h", "LED head, tail and roof-bar lights", "2.4GHz remote · 7.4V rechargeable battery"],
    bodyShape: "1:16 scale crawler",
    heroImage: "/products/rcai/bronco-crawler-16/default.webp",
    altImages: ["/products/rcai/bronco-crawler-16/default-2.webp", "/products/rcai/bronco-crawler-16/default-3.webp", "/products/rcai/bronco-crawler-16/default-4.webp"],
    specs: { drive: "4WD" },
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:16 RC crawler", "Pistol-grip remote"],
  },
  {
    id: "bronco-desert-racer-18", slug: "bronco-desert-racer-18", kind: "RC", scale: "1:18", category: "hobby",
    name: "Bronco Desert Racer", tagline: "1:18 desert racer · race livery · roll cage",
    retailINR: 20625, mrpINR: 20625, badge: "NEW",
    bullets: ["Two-door Bronco-style desert-racer body", "Red, white and black race livery", "Exposed rear roll cage, red beadlock-style wheels", "Pistol-grip remote — trigger throttle, wheel steering"],
    bodyShape: "1:18 desert racer",
    heroImage: "/products/rcai/bronco-desert-racer-18/default.webp",
    altImages: ["/products/rcai/bronco-desert-racer-18/default-2.webp", "/products/rcai/bronco-desert-racer-18/default-3.webp", "/products/rcai/bronco-desert-racer-18/default-4.webp"],
    specs: {},
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:18 RC truck", "Pistol-grip remote"],
  },
  {
    id: "land-cruiser-pickup-12", slug: "land-cruiser-pickup-12", kind: "RC", scale: "1:12", category: "hobby",
    name: "Land Cruiser Pickup", tagline: "1:12 scale off-roader · canopy · bull bar",
    retailINR: 11125, mrpINR: 11125, badge: "NEW",
    bullets: ["Classic single-cab utility body with rear canopy", "4WD with a 2-speed switch", "Working head, brake, reverse and turn lights", "2.4GHz remote · 7.4V 1200mAh battery"],
    bodyShape: "1:12 scale off-roader",
    heroImage: "/products/rcai/land-cruiser-pickup-12/default.webp",
    altImages: ["/products/rcai/land-cruiser-pickup-12/default-2.webp", "/products/rcai/land-cruiser-pickup-12/default-3.webp", "/products/rcai/land-cruiser-pickup-12/default-4.webp"],
    specs: { drive: "4WD" },
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:12 RC truck", "Pistol-grip remote"],
  },
  {
    id: "defender-pickup-12", slug: "defender-pickup-12", kind: "RC", scale: "1:12", category: "hobby",
    name: "Defender Pickup", tagline: "1:12 scale off-roader · snorkel · bed spare",
    retailINR: 8000, mrpINR: 8000, badge: "NEW",
    bullets: ["Short-wheelbase utility pickup body in yellow", "Black cab roof and side snorkel", "Spare wheel standing in the open bed", "Pistol-grip remote — trigger throttle, wheel steering"],
    bodyShape: "1:12 scale off-roader",
    heroImage: "/products/rcai/defender-pickup-12/default.webp",
    altImages: ["/products/rcai/defender-pickup-12/default-2.webp", "/products/rcai/defender-pickup-12/default-3.webp", "/products/rcai/defender-pickup-12/default-4.webp"],
    specs: {},
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:12 RC truck", "Pistol-grip remote"],
  },
  {
    id: "land-cruiser-flatbed-12", slug: "land-cruiser-flatbed-12", kind: "RC", scale: "1:12", category: "hobby",
    name: "Land Cruiser Flatbed", tagline: "1:12 scale work truck · flat tray · hook frame",
    retailINR: 11500, mrpINR: 11500, badge: "NEW",
    bullets: ["Classic single-cab work-truck body in yellow", "Flat tray with lifting boom and winch hook", "4WD · working lights · ~45 min run time", "2.4GHz remote · 7.4V 1200mAh battery"],
    bodyShape: "1:12 scale work truck",
    heroImage: "/products/rcai/land-cruiser-flatbed-12/default.webp",
    altImages: ["/products/rcai/land-cruiser-flatbed-12/default-2.webp", "/products/rcai/land-cruiser-flatbed-12/default-3.webp", "/products/rcai/land-cruiser-flatbed-12/default-4.webp"],
    specs: { drive: "4WD" },
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:12 RC truck", "Pistol-grip remote"],
  },
  {
    id: "polo-wrc-14", slug: "polo-wrc-14", kind: "RC", scale: "1:14", category: "polo",
    name: "Polo WRC", tagline: "1:14 rally-car replica · WRC livery",
    retailINR: 25750, mrpINR: 25750, badge: "NEW",
    bullets: ["Rally hatchback body in navy-to-white WRC livery", "Printed rally graphics and POLO plates", "Rear roof spoiler, multi-spoke wheels", "Pistol-grip remote — trigger throttle, wheel steering"],
    bodyShape: "1:14 rally car",
    heroImage: "/products/rcai/polo-wrc-14/default.webp",
    altImages: ["/products/rcai/polo-wrc-14/default-2.webp", "/products/rcai/polo-wrc-14/default-3.webp", "/products/rcai/polo-wrc-14/default-4.webp"],
    specs: {},
    specRows: [{ label: "Remote", value: "Pistol-grip transmitter" }],
    inBox: ["1:14 RC car", "Pistol-grip remote"],
  },
  {
    id: "skyline-gtr-43", slug: "skyline-gtr-43", kind: "RC", scale: "1:43", category: "s43",
    name: "Skyline GT-R", tagline: "1:43 palm-sized RC · 2.4GHz · ESP",
    retailINR: 4875, mrpINR: 4875, badge: "NEW",
    bullets: ["Palm-sized 1:43 GT-R body in silver with blue graphics", "2.4GHz pistol-grip remote", "ESP and light buttons on the remote", "Steering trim on the remote"],
    bodyShape: "1:43 sports coupe",
    heroImage: "/products/rcai/skyline-gtr-43/default.webp",
    altImages: ["/products/rcai/skyline-gtr-43/default-2.webp", "/products/rcai/skyline-gtr-43/default-3.webp", "/products/rcai/skyline-gtr-43/default-4.webp"],
    specs: {},
    specRows: [{ label: "Remote", value: "2.4GHz pistol-grip" }, { label: "Remote controls", value: "ESP, Light, Steering trim, On/Off" }],
    inBox: ["1:43 RC car", "2.4GHz pistol-grip remote"],
  },
  {
    id: "porsche-911-rsr-43", slug: "porsche-911-rsr-43", kind: "RC", scale: "1:43", category: "s43",
    name: "Porsche 911 RSR", tagline: "1:43 palm-sized RC · 2.4GHz · ESP",
    retailINR: 4875, mrpINR: 4875, badge: "NEW",
    bullets: ["Palm-sized 1:43 race-car body in white race livery", "Rear race wing on swan-neck mounts", "2.4GHz pistol-grip remote with ESP and light buttons", "Steering trim on the remote"],
    bodyShape: "1:43 race car",
    heroImage: "/products/rcai/porsche-911-rsr-43/default.webp",
    altImages: ["/products/rcai/porsche-911-rsr-43/default-2.webp", "/products/rcai/porsche-911-rsr-43/default-3.webp", "/products/rcai/porsche-911-rsr-43/default-4.webp"],
    specs: {},
    specRows: [{ label: "Remote", value: "2.4GHz pistol-grip" }, { label: "Remote controls", value: "ESP, Light, Steering trim, On/Off" }],
    inBox: ["1:43 RC car", "2.4GHz pistol-grip remote"],
  },
  {
    id: "cement-mixer-truck-18", slug: "cement-mixer-truck-18", kind: "RC", scale: "1:18", category: "construction",
    name: "Cement Mixer Truck", tagline: "1:18 RC construction · three-axle mixer",
    retailINR: 6375, mrpINR: 6375, badge: "NEW",
    bullets: ["Three-axle concrete-mixer body with white cab", "Black drum with green spiral and green chute", "Six-wheel truck chassis", "Twin-stick gamepad remote"],
    bodyShape: "1:18 mixer truck",
    heroImage: "/products/rcai/cement-mixer-truck-18/default.webp",
    altImages: ["/products/rcai/cement-mixer-truck-18/default-2.webp", "/products/rcai/cement-mixer-truck-18/default-3.webp", "/products/rcai/cement-mixer-truck-18/default-4.webp"],
    specs: {},
    specRows: [{ label: "Brand", value: "Huina" }, { label: "Remote", value: "Twin-stick gamepad" }],
    inBox: ["1:18 RC mixer truck", "Gamepad remote"],
  },
  {
    id: "lowbed-trailer-truck-18", slug: "lowbed-trailer-truck-18", kind: "RC", scale: "1:18", category: "construction",
    name: "Low-Bed Trailer Truck", tagline: "1:18 RC heavy haulage · tractor + low-bed trailer",
    retailINR: 6500, mrpINR: 6500, badge: "NEW",
    bullets: ["Grey three-axle tractor unit with roof beacons", "Long low-bed trailer with manual folding ramps", "9-channel 2.4GHz control", "~83 cm long as a complete rig"],
    bodyShape: "1:18 tractor and low-bed trailer",
    heroImage: "/products/rcai/lowbed-trailer-truck-18/default.webp",
    altImages: ["/products/rcai/lowbed-trailer-truck-18/default-2.webp", "/products/rcai/lowbed-trailer-truck-18/default-3.webp", "/products/rcai/lowbed-trailer-truck-18/default-4.webp"],
    specs: {},
    specRows: [{ label: "Remote", value: "Twin-stick gamepad" }],
    inBox: ["1:18 RC tractor unit", "Low-bed trailer", "Gamepad remote"],
  },
  {
    id: "qa-1rs",
    slug: "qa-1rs",
    scale: "1:64",
    name: "QA — Test Purchase ₹1",
    tagline: "Internal smoke-test SKU — DO NOT FULFIL",
    retailINR: 16,
    mrpINR: 16,
    bullets: [
      "Internal QA only — do not ship",
      "Buy via UPI to land at ₹1 total",
      "Refund the payment in Razorpay after the test",
      "Hidden from catalog, sitemap, and search",
    ],
    bodyShape: "n/a — diagnostic SKU",
    internal: true,
    heroImage: "/products/PRC-bmw.webp",
    altImages: [],
    specs: {
      lengthMM: 0,
      drive: "2WD",
      topSpeedKmh: 0,
      batteryMin: 0,
      chargeMin: 0,
      rangeM: 0,
      minAge: 0,
      led: "n/a",
      drift: "n/a",
    },
  },
];

export const HERO_SKU_ID = "pocket-porsche";

export function getProductById(id: string): Sku | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/** Explicit display order for the storefront grid, by SKU id. Anything not
 *  listed falls to the end in its original array order. Keep this as the one
 *  place that controls card order so the big PRODUCTS array stays stable for
 *  sitemap/static-params/PDP lookups. */
const STOREFRONT_ORDER = [
  "pocket-monster",
  "pocket-f1-classic",
  "pocket-thar",
  "pocket-porsche",
  "pocket-bmw",
];

/** Storefront grid — the 1:64 store. Excludes `hidden`/`internal` AND the 1:16
 *  "Big" series (which lives at /16 with its own cart), ordered per
 *  STOREFRONT_ORDER. */
export function getVisibleProducts(): Sku[] {
  const rank = (id: string) => {
    const i = STOREFRONT_ORDER.indexOf(id);
    return i === -1 ? STOREFRONT_ORDER.length : i;
  };
  return PRODUCTS.filter(
    (p) =>
      !p.hidden &&
      !p.internal &&
      !p.comingSoon &&
      p.category !== "construction" &&
      p.scale === "1:64"
  ).sort((a, b) => rank(a.id) - rank(b.id));
}

/** Display order for the 1:16 /16 lineup, by SKU id. */
const STORE16_ORDER = [
  "drift-inferno",
  "drift-toxic",
  "drift-phantom",
  "drift-carbon",
  "dares-azure",
  "dares-recon",
];

/** The 1:16 "Big" series products, in lineup order. */
export function getStore16Skus(): Sku[] {
  const rank = (id: string) => {
    const i = STORE16_ORDER.indexOf(id);
    return i === -1 ? STORE16_ORDER.length : i;
  };
  return PRODUCTS.filter(
    (p) => p.scale === "1:16" && p.category !== "hobby" && !p.hidden && !p.internal && !p.comingSoon
  ).sort((a, b) => rank(a.id) - rank(b.id));
}

// ── Hub category grids ──────────────────────────────────────────────────────
// The hub Shop shows categories that INCLUDE coming-soon teasers (unlike the
// live /64 + /16 storefronts above, which exclude them). Each helper returns
// the buyable products first, coming-soon last.

const bySoon = (a: Sku, b: Sku) =>
  Number(a.comingSoon ?? false) - Number(b.comingSoon ?? false);

/** Hub "Mini RC · 1:64" tile — the live 1:64 lineup (no coming-soon here). */
export function getHubMiniSkus(): Sku[] {
  return getVisibleProducts();
}

/** Hub "Big Drift · 1:16" tile — the live 1:16 lineup + any 1:16 teasers. */
export function getHubBig16Skus(): Sku[] {
  return PRODUCTS.filter(
    (p) => p.scale === "1:16" && p.category !== "hobby" && !p.hidden && !p.internal
  ).sort(bySoon);
}

/** Hub "1:43 Scale" tile. */
export function getHub43Skus(): Sku[] {
  return PRODUCTS.filter((p) => p.category === "s43" && !p.hidden && !p.internal).sort(bySoon);
}

/** Hub "Hobby Grade" tile — big-scale crawlers, trucks and racers. */
export function getHubHobbySkus(): Sku[] {
  return PRODUCTS.filter((p) => p.category === "hobby" && !p.hidden && !p.internal).sort(bySoon);
}

/** Hub "1:20 Scale" tile — 1:20 products, minus those pulled into their own
 *  tile (e.g. the VW Polos live under the Polo tile). */
export function getHub20Skus(): Sku[] {
  return PRODUCTS.filter(
    (p) => p.scale === "1:20" && p.category !== "polo" && !p.hidden && !p.internal
  ).sort(bySoon);
}

/** Hub "Construction" tile — RC trucks/diggers (category override). */
export function getHubConstructionSkus(): Sku[] {
  return PRODUCTS.filter(
    (p) => p.category === "construction" && !p.hidden && !p.internal && !p.bundle
  ).sort(bySoon);
}

/** The Construction 3-Pack bundle SKU (surfaced via its own CTA banner). */
export function getConstructionBundle(): Sku | undefined {
  return PRODUCTS.find((p) => p.id === "construction-3pack");
}

/** Hub "Polo" tile — the VW Polo cars as individual products. */
export function getHubPoloSkus(): Sku[] {
  return PRODUCTS.filter(
    (p) => p.category === "polo" && !p.hidden && !p.internal
  ).sort(bySoon);
}

export function getHeroSku(): Sku {
  return PRODUCTS.find((p) => p.id === HERO_SKU_ID)!;
}

/** Sum of stock across all color variants. Falls back to 0 if no variants. */
export function totalStock(sku: Sku): number {
  if (!sku.colors?.length) return 0;
  return sku.colors.reduce((sum, c) => sum + c.stock, 0);
}

/**
 * Default variant slug for quick-add CTAs (Hero, FinalCta, sticky bars, bundle).
 * Picks the first IN-STOCK color, falls back to the first color, falls back
 * to null for SKUs without colors. The PDP color picker can always override.
 */
export function defaultVariantSlug(sku: Sku): string | null {
  if (!sku.colors?.length) return null;
  return sku.colors.find((c) => c.stock > 0)?.slug ?? sku.colors[0].slug;
}

export const WHOLESALE_TIERS = [
  { id: "starter", label: "Starter", moq: 12, discountPct: 35 },
  { id: "standard", label: "Standard", moq: 48, discountPct: 45 },
  { id: "distributor", label: "Distributor", moq: 144, discountPct: 52 },
] as const;

export function tradePerUnit(mrp: number, discountPct: number): number {
  return Math.round(mrp * (1 - discountPct / 100));
}

export function tradeMarginPerUnit(
  mrp: number,
  discountPct: number,
  landingCost: number
): number {
  return tradePerUnit(mrp, discountPct) - landingCost;
}
