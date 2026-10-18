/**
 * Centralized Category & Product Classification Architecture — Pocket RC Cars (PRC)
 *
 * Consolidates the legacy 8 circular categories into 4 approved primary shopping
 * categories while preserving backward-compatible legacy slug redirects and
 * structured attributes (scale, vehicleType, drivingStyle, brand, colorNames,
 * drivetrain, grade).
 *
 * Approved Primary Categories:
 *   1. Mini RC Cars         → /collections/mini-rc-cars
 *   2. Drift & Racing RC    → /collections/drift-racing
 *   3. Construction RC      → /collections/construction-rc
 *   4. Hobby Grade RC       → /collections/hobby-grade
 *
 * Classification rules enforced here:
 *   - Every product has ONE stable `primaryCategory` for breadcrumbs, canonicals,
 *     and primary merchandising.
 *   - Products may belong to multiple `collections` where genuinely relevant
 *     (e.g. 1:43 4WD gyro drift cars belong primarily to `mini-rc-cars` and
 *     secondarily to `drift-racing`).
 *   - Volkswagen Polo models are classified with `drivingStyle: "Racing & Rally"`
 *     (never falsely labeled as drift cars) while residing in `drift-racing`.
 *   - Toy-grade 1:64 cars are never labeled "Hobby-Grade".
 *   - 1:64 construction vehicles (`mining-truck`, `rc-excavator`, `rc-forklift`,
 *     `construction-3pack`) are placed in `construction-rc` based on primary use,
 *     not forced into `mini-rc-cars` by scale.
 *   - "Drone — Coming Soon" is kept outside the 4 primary shopping categories
 *     with no thin/empty indexable category page.
 */

import { ALL_SKUS, type Sku } from "./products";

export type PrimaryCategorySlug =
  | "mini-rc-cars"
  | "drift-racing"
  | "construction-rc"
  | "hobby-grade";

export type LegacyHubCategoryKey =
  | "mini64"
  | "big16"
  | "s20"
  | "construction"
  | "polo"
  | "s43"
  | "drone"
  | "hobby";

export type VehicleType =
  | "Drift & Sports Car"
  | "Formula / Track Racer"
  | "Rally & Hot-Hatch"
  | "SUV & 4x4"
  | "Monster Truck"
  | "Rock Crawler"
  | "Off-Road Pickup & Truck"
  | "Excavator"
  | "Forklift"
  | "Construction Truck & Hauler"
  | "Construction Bundle"
  | "Farm & Utility"
  | "ATV / Quad";

export type DrivingStyle =
  | "Drift"
  | "Racing & Rally"
  | "Rock Crawling & Trail"
  | "Off-Road & Stunt"
  | "Construction & Working Rig"
  | "Desktop Cruising";

export type DrivetrainType = "4WD" | "2WD / RWD";

export type RcGrade = "Hobby-Grade" | "Proportional Mini" | "Desktop / Toy-Grade";

export interface CategoryFaq {
  question: string;
  answer: string;
}

export interface CategoryShortcut {
  label: string;
  href: string;
}

export interface StoreCategory {
  /** Stable database/code identifier */
  id: string;
  /** URL slug under /collections/[slug] */
  slug: PrimaryCategorySlug;
  /** Legacy /hub/shop/[key] slugs that permanently redirect to this category */
  legacyKeys: LegacyHubCategoryKey[];
  /** Customer-facing category name on circular cards & navigation */
  name: string;
  /** Concise subtitle / scale pill on circular cards */
  shortLabel: string;
  /** Approved SEO target & H1 heading on collection page */
  seoTargetHeading: string;
  /** Document <title> for Google Search */
  seoTitle: string;
  /** Meta description for Google Search */
  seoDescription: string;
  /** Short original introduction shown at the top of the collection page */
  description: string;
  /** Extended buyer-guide copy shown on the collection page */
  longIntro: string;
  /** Primary circular category thumbnail image (genuine product image) */
  image: string;
  /** Image alt text for accessibility and Google Images */
  imageAlt: string;
  /** Gallery of 3 genuine product images for hero / preview cards */
  heroImages: [string, string, string];
  /** Sort order (1..4) */
  displayOrder: number;
  /** Whether category is live and indexable */
  published: boolean;
  /** Optional parent category slug (null for top-level categories) */
  primaryParent: string | null;
  /** Canonical path (/collections/[slug]) */
  url: `/collections/${PrimaryCategorySlug}`;
  /** Starting online (UPI/Card) price in INR */
  priceFloorINR: number;
  /** Scales represented in this collection */
  scales: string[];
  /** Scale or subtype shortcut links shown underneath the circular category tile */
  shortcuts: CategoryShortcut[];
  /** Key value-proposition bullets for the collection banner */
  highlights: string[];
  /** Helpful FAQs answering real customer questions */
  faqs: CategoryFaq[];
  /** Related category slugs for internal cross-linking */
  relatedCategorySlugs: PrimaryCategorySlug[];
}

export interface ProductClassification {
  skuId: string;
  /** Single stable primary category for breadcrumbs, canonical context, and primary merchandising */
  primaryCategory: PrimaryCategorySlug;
  /** All collections this SKU appears in (first element is always primaryCategory) */
  collections: PrimaryCategorySlug[];
  scale: Sku["scale"];
  vehicleType: VehicleType;
  drivingStyle: DrivingStyle;
  brand: string;
  colorNames: string[];
  drivetrain: DrivetrainType;
  grade: RcGrade;
  /** Search-focused SEO title for PDP <title> */
  seoTitle: string;
  /** Search-focused meta description for PDP */
  seoDescription: string;
  /** Descriptive alt text for primary product image */
  primaryImageAlt: string;
}

/**
  * The 4 approved primary shopping categories for Pocket RC Cars.
  */
export const PRIMARY_CATEGORIES: StoreCategory[] = [
  {
    id: "cat-mini-rc-cars",
    slug: "mini-rc-cars",
    legacyKeys: ["mini64", "s43"],
    name: "Mini RC Cars",
    shortLabel: "1:64 & 1:43 Scale",
    seoTargetHeading: "Mini RC Cars in India – 1:64 & 1:43",
    seoTitle:
      "Mini RC Cars in India – 1:64 & 1:43 Pocket Drift & Desktop RC | Pocket RC Cars",
    seoDescription:
      "Shop 1:64 & 1:43 mini RC cars in India from ₹999 online. Die-cast metal desktop drift cars, 4WD gyro racers, Thar SUVs & monster trucks with USB-C charging and 24-hr Bangalore dispatch.",
    description:
      "Palm-sized 1:64 die-cast pocket RC cars and 1:43 4WD gyro mini drift cars built for smooth indoor floors, desks, and living-room circuits. Every box arrives ready to run with a 2.4 GHz remote and USB-C rechargeable battery.",
    longIntro:
      "Our Mini RC Cars collection brings together two compact scales tailored for indoor driving in India: 1:64 pocket die-cast RC models (~7.5 cm long) that fit in your palm and run for up to 40 minutes on a USB-C charge, and 1:43 4WD gyro mini drift cars (~11 cm long) with proportional steering and interchangeable slick + grip wheel sets. Whether you want a desk-friendly BMW E30, Porsche 911, Mahindra Thar-inspired 4x4, high-clearance Monster Truck, or a 1:43 Skyline GT-R R34, every model ships from our Bangalore warehouse within 24 hours.",
    image: "/landing/cat-crawlers.webp",
    imageAlt: "1:64 and 1:43 Mini RC Cars in India by Pocket RC Cars",
    heroImages: [
      "/products/colors/PRC-bmw-white.webp",
      "/products/colors/PRC-porsche-green-v2.webp",
      "/products/rcai/skyline-gtr-43/default.webp",
    ],
    displayOrder: 1,
    published: true,
    primaryParent: null,
    url: "/collections/mini-rc-cars",
    priceFloorINR: 999,
    scales: ["1:64", "1:43"],
    shortcuts: [
      { label: "1:64", href: "/collections/mini-rc-cars?scale=1:64" },
      { label: "1:43", href: "/collections/mini-rc-cars?scale=1:43" },
    ],
    highlights: [
      "1:64 die-cast metal & 1:43 4WD gyro models",
      "USB-C rechargeable Li-Po battery in the box",
      "2.4 GHz interference-free multi-car racing",
      "Ships in 24 hrs from Bangalore · Pan-India COD",
    ],
    faqs: [
      {
        question: "What is the difference between 1:64 and 1:43 mini RC cars?",
        answer:
          "1:64 scale RC cars are roughly 7.5 cm long (Hot Wheels size) with zinc-alloy die-cast bodies, rear-wheel drive, and 35–40 minutes of USB-C runtime—ideal for desks and dining tables. 1:43 scale RC cars are slightly larger (~11 cm long) and feature 4WD all-wheel drive, built-in gyro stabilization, and proportional steering for tighter hallway and living-room drift circuits.",
      },
      {
        question: "What surfaces work best for 1:64 and 1:43 mini RC cars?",
        answer:
          "Smooth indoor surfaces such as vitrified tiles, marble, hardwood floors, laminated desks, and smooth concrete deliver the best drifting and cornering performance. For rough tiles or outdoor patio stones, choose the 1:64 Monster Truck or Thar SUV which have higher ground clearance and rubber treaded tires.",
      },
      {
        question: "Do these mini RC cars come with a charger and remote?",
        answer:
          "Yes. Every 1:64 and 1:43 model is Ready-to-Run (RTR) and includes the assembled car, a 2.4 GHz pistol-grip or pocket remote controller, a USB Type-C charging cable, and spare drift wheels or race cones where specified on the product page.",
      },
      {
        question: "Can two or more mini RC cars race together without signal clash?",
        answer:
          "Yes. All Pocket RC Cars use 2.4 GHz frequency-hopping radios that pair automatically to their own car, allowing 4 to 8 cars to race side-by-side in the same room without interference.",
      },
    ],
    relatedCategorySlugs: ["drift-racing", "construction-rc", "hobby-grade"],
  },
  {
    id: "cat-drift-racing",
    slug: "drift-racing",
    legacyKeys: ["big16", "s20", "polo"],
    name: "Drift & Racing RC",
    shortLabel: "1:16, 1:20 & Rally",
    seoTargetHeading: "RC Drift Cars & Racing Cars in India",
    seoTitle:
      "RC Drift Cars & Racing Cars in India – 1:16 4WD Smoke Drift, 1:20 & Rally | Pocket RC Cars",
    seoDescription:
      "Buy RC drift cars and racing cars in India. Explore 1:16 4WD LED tail-smoke drift cars, 1:20 touring racers, and Volkswagen Polo rally RC models. Spare slick + grip tires included.",
    description:
      "High-speed 1:16 4WD drift machines with water-mist LED exhaust smoke, 1:20 touring and drift racers, and licensed-style Volkswagen Polo rally hatchbacks. Built for controlled sideways slides and multi-car track battles.",
    longIntro:
      "From full-feature 1:16 4WD drift cars (~28 cm long, 25–30 km/h top speed) with water-mist rear exhaust smoke and interchangeable slick + rubber wheel sets to agile 1:20 scale AE86 and Huracán track cars and Volkswagen Polo #95 / R WRC rally hatchbacks, this collection covers dedicated drift and circuit racing RC cars across India. Notice how we distinguish true sideways drift setups (4WD or gyro-assisted with hard slick tires) from grip-focused rally and track racers like the Polo series so you can pick the exact driving feel you want.",
    image: "/landing/cat-drift.webp",
    imageAlt: "1:16 4WD RC Drift Cars and Racing Cars in India with LED Exhaust Smoke",
    heroImages: [
      "/store16-images/drift-inferno/1-hero.webp",
      "/products/rcai/bmw-m4-dtm/default.webp",
      "/products/rcai/toyota-ae86-20/default.webp",
    ],
    displayOrder: 2,
    published: true,
    primaryParent: null,
    url: "/collections/drift-racing",
    priceFloorINR: 899,
    scales: ["1:16", "1:20", "1:14", "1:24", "1:32", "1:43", "1:64", "1:10"],
    shortcuts: [
      { label: "1:16", href: "/collections/drift-racing?scale=1:16" },
      { label: "1:20", href: "/collections/drift-racing?scale=1:20" },
    ],
    highlights: [
      "1:16 4WD drift cars with LED water-mist exhaust smoke",
      "Both hard drift slicks & rubber grip tires included on 1:16 models",
      "1:20 AE86 & GT3 racers + VW Polo rally hatchbacks",
      "24-hr dispatch from Bangalore · ₹100 off online payment",
    ],
    faqs: [
      {
        question: "How does the rear smoke effect work on 1:16 RC drift cars?",
        answer:
          "Our 1:16 4WD drift models feature a built-in ultrasonic water atomizer at the rear exhaust illuminated by red LEDs. Simply add clean tap water using the included dropper bottle—no oil or heat is used, so the mist is cool, odourless, and safe for indoor use.",
      },
      {
        question: "Are the Volkswagen Polo RC models drift cars or rally racers?",
        answer:
          "The Volkswagen Polo #95 (1:32 and 1:24) and Polo R WRC (1:14) are grip-focused rally and track hatchbacks with rubber treaded tires rather than hard plastic drift slicks. They are designed for responsive apex cornering and straight-line sprints rather than sideways drifting.",
      },
      {
        question: "Can I switch between drifting and normal grip racing on 1:16 cars?",
        answer:
          "Yes. Every 1:16 drift car includes two complete sets of 4 wheels in the box: smooth hard-compound slicks for effortless sideways powerslides on tile or asphalt, and grooved rubber racing tires for high-grip speed runs.",
      },
      {
        question: "What is the top speed and battery life of the 1:16 drift series?",
        answer:
          "The 1:16 4WD series reaches 25–30 km/h and delivers 20–25 minutes of active driving per charge via the included 7.4V rechargeable Li-ion battery pack.",
      },
    ],
    relatedCategorySlugs: ["mini-rc-cars", "hobby-grade", "construction-rc"],
  },
  {
    id: "cat-construction-rc",
    slug: "construction-rc",
    legacyKeys: ["construction"],
    name: "Construction RC",
    shortLabel: "Excavators & Trucks",
    seoTargetHeading: "RC Construction Vehicles in India",
    seoTitle:
      "RC Construction Vehicles in India – RC Excavator, Forklift, Dump Truck & Mixer | Pocket RC Cars",
    seoDescription:
      "Shop radio-controlled construction vehicles in India. 1:64 alloy RC excavators, forklifts, mining dump trucks, 3-car site bundles & 1:18 cement mixers and low-bed haulers.",
    description:
      "Radio-controlled excavators, forklifts, mining dump trucks, rotating cement mixers, and articulated low-bed heavy haulers with multi-channel working booms, forks, and beds.",
    longIntro:
      "Turn any desk, sandbox, or living room into a working job site. Our RC Construction Vehicles collection spans compact 1:64 zinc-alloy desktop machines—including tracked excavators with articulated digging arms, warehouse forklifts with lifting masts, and tipping dump trucks—all the way to 40 cm 1:18 heavy haulers and rotating-drum cement mixers. Every vehicle runs on an independent 2.4 GHz multi-channel radio so multiple operators can dig, load, and haul together.",
    image: "/landing/cat-construction.webp",
    imageAlt: "RC Construction Vehicles in India — RC Excavator, Forklift and Dump Truck Fleet",
    heroImages: [
      "/products/rcai/rc-excavator/default.webp",
      "/products/rcai/rc-forklift/default.webp",
      "/products/rcai/mining-truck/default.webp",
    ],
    displayOrder: 3,
    published: true,
    primaryParent: null,
    url: "/collections/construction-rc",
    priceFloorINR: 1099,
    scales: ["1:64", "1:18"],
    shortcuts: [
      { label: "Excavators", href: "/collections/construction-rc?type=Excavator" },
      {
        label: "Trucks",
        href: "/collections/construction-rc?type=Construction+Truck+%26+Hauler",
      },
    ],
    highlights: [
      "Remote-operated digging arms, lifting forks & tipping beds",
      "1:64 alloy desktop rigs + 1:18 heavy cement mixer & low-bed trailer",
      "Save ₹699 on the complete 3-Vehicle Construction Crew Bundle",
      "2.4 GHz multi-channel remotes for coordinated fleet play",
    ],
    faqs: [
      {
        question: "Do the excavator arm, forklift mast, and dump bed move via the remote?",
        answer:
          "Yes! Unlike static push toys, every RC construction vehicle in this collection has motorized working functions controlled directly from the 2.4 GHz transmitter—the excavator digs and scoops, the forklift raises and lowers pallets, the dump truck tips its bed, and the 1:18 cement mixer rotates its drum.",
      },
      {
        question: "Should I buy individual 1:64 rigs or the Construction Crew 3-Pack?",
        answer:
          "If you want the complete job-site experience, the Construction Crew 3-Pack includes the 1:64 Excavator, Forklift, and Mining Dump Truck with three separate 2.4 GHz remotes and save ₹699 compared to buying each machine individually.",
      },
      {
        question: "Can the 1:18 Low-Bed Trailer Truck actually carry other RC cars?",
        answer:
          "Yes. The 1:18 Heavy Hauler Low-Bed Trailer is 40 cm long with a drop-down loading ramp capable of transporting 1:64 and 1:43 RC cars or the 1:64 construction machines across the room.",
      },
    ],
    relatedCategorySlugs: ["mini-rc-cars", "hobby-grade", "drift-racing"],
  },
  {
    id: "cat-hobby-grade",
    slug: "hobby-grade",
    legacyKeys: ["hobby"],
    name: "Hobby Grade RC",
    shortLabel: "Crawlers & Off-Road",
    seoTargetHeading: "Hobby Grade RC Cars & Off-Road Vehicles",
    seoTitle:
      "Hobby Grade RC Cars & Off-Road Crawlers in India – 1:10, 1:12 & 1:16 4WD | Pocket RC Cars",
    seoDescription:
      "Shop genuine hobby-grade RC cars, 4WD rock crawlers & off-road RC trucks in India. Proportional throttle & steering, metal-link suspension, Land Rover Defender, Bronco & Land Cruiser rigs.",
    description:
      "True proportional 4WD rock crawlers, 1:12 scale trail pickups, 1:18 Baja desert trophy trucks, and 1:10 high-speed hobby-grade RC cars engineered for outdoor trails, rocks, grass, and tarmac.",
    longIntro:
      "Built for enthusiasts who want real mechanical articulation and proportional control rather than simple on/off toy steering. Our Hobby Grade RC collection features 1:16 and 1:12 4WD rock crawlers (Land Rover Defender, Ford Bronco, and Toyota Land Cruiser 79 series) with high-torque brushed motors, multi-link coil suspension, and high-grip beadlock-style rubber tires, alongside the 1:18 Bronco R desert racer and the 1:10 Mustang GT500 4WD platform. We never pad this category with toy-grade 1:64 cars—every vehicle here is a genuine large-scale proportional or trail-ready 4WD machine.",
    image: "/landing/cat-hobby.jpg",
    imageAlt: "Hobby Grade RC Cars and 4WD Off-Road Rock Crawlers in India",
    heroImages: [
      "/products/rcai/defender-crawler-16/yellow.webp",
      "/products/rcai/bronco-crawler-16/default.webp",
      "/products/rcai/land-cruiser-pickup-12/default.webp",
    ],
    displayOrder: 4,
    published: true,
    primaryParent: null,
    url: "/collections/hobby-grade",
    priceFloorINR: 2099,
    scales: ["1:10", "1:12", "1:16", "1:18"],
    shortcuts: [
      { label: "Crawlers", href: "/collections/hobby-grade?type=Rock+Crawler" },
      {
        label: "Off-Road",
        href: "/collections/hobby-grade?type=Off-Road+Pickup+%26+Truck",
      },
    ],
    highlights: [
      "True 4WD drivetrains with proportional throttle & steering",
      "High-articulation suspension for rocks, grass, mud & trails",
      "1:12 Land Cruiser & Defender pickups + 1:16 crawlers + 1:10 GT500",
      "No-Cost EMI available on eligible orders above ₹2,500",
    ],
    faqs: [
      {
        question: "What makes an RC car 'Hobby Grade' compared to a standard toy RC car?",
        answer:
          "Hobby-grade and trail-crawler RC vehicles use proportional throttle and steering servos (allowing gradual throttle control and precise steering angles rather than full-left/full-right snapping), independent or multi-link suspension with real travel, 4WD shaft drivetrains, and replaceable battery packs.",
      },
      {
        question: "Can these 4WD rock crawlers drive outdoors on rocks, grass, and dirt?",
        answer:
          "Yes. Models like the 1:16 Defender, Bronco, Ford Pickup Crawlers and the 1:12 Land Cruiser 79 series are specifically geared for high low-end torque to climb over stones, garden roots, sand, and uneven outdoor terrain.",
      },
      {
        question: "Which hobby-grade model is best for high speed vs slow rock crawling?",
        answer:
          "For high-speed tarmac driving and power-sliding (~35 km/h), choose the 1:10 Ford Mustang GT500 or the 1:18 Bronco R Desert Trophy Truck. For technical climbing over obstacles and rough trails, choose any of the 1:16 4x4 Crawlers or 1:12 Land Cruiser / Defender pickups.",
      },
    ],
    relatedCategorySlugs: ["drift-racing", "construction-rc", "mini-rc-cars"],
  },
];

/**
 * Non-indexable teaser metadata for "Drone — Coming Soon".
 * Kept strictly outside the 4 primary shopping categories until products launch.
 */
export const COMING_SOON_ANNOUNCEMENT = {
  slug: "drone",
  name: "RC Drones",
  statusLabel: "Coming Soon",
  note: "Micro FPV & altitude-hold indoor quadcopters are currently in flight testing and will launch once warehouse stock arrives.",
} as const;

/**
 * Legacy `/hub/shop/[category]` → new `/collections/[slug]` redirect table.
 */
export const LEGACY_CATEGORY_REDIRECTS: Record<string, string> = {
  mini64: "/collections/mini-rc-cars",
  s43: "/collections/mini-rc-cars",
  big16: "/collections/drift-racing",
  s20: "/collections/drift-racing",
  polo: "/collections/drift-racing",
  construction: "/collections/construction-rc",
  hobby: "/collections/hobby-grade",
  drone: "/collections",
  "mini-rc-cars": "/collections/mini-rc-cars",
  "drift-racing": "/collections/drift-racing",
  "construction-rc": "/collections/construction-rc",
  "hobby-grade": "/collections/hobby-grade",
};

/**
 * Lookup a primary category by its slug (`mini-rc-cars`, `drift-racing`, etc.)
 * or by a legacy hub key (`mini64`, `big16`, etc.).
 */
export function getCategoryBySlug(slugOrKey: string): StoreCategory | undefined {
  const direct = PRIMARY_CATEGORIES.find((c) => c.slug === slugOrKey);
  if (direct) return direct;
  return PRIMARY_CATEGORIES.find((c) =>
    c.legacyKeys.includes(slugOrKey as LegacyHubCategoryKey),
  );
}

/**
 * Extract normalized colour names for faceted filtering from a SKU.
 */
function inferColorNames(sku: Sku): string[] {
  if (sku.colors && sku.colors.length > 0) {
    const set = new Set<string>();
    for (const c of sku.colors) {
      const n = c.name.toLowerCase();
      if (n.includes("blue") || n.includes("azure") || n.includes("cyan")) set.add("Blue");
      if (n.includes("orange") || n.includes("papaya")) set.add("Orange");
      if (n.includes("white")) set.add("White");
      if (n.includes("silver") || n.includes("grey") || n.includes("gray")) set.add("Silver / Grey");
      if (n.includes("black")) set.add("Black");
      if (n.includes("red") || n.includes("crimson")) set.add("Red");
      if (n.includes("yellow") || n.includes("gold")) set.add("Yellow / Gold");
      if (n.includes("green") || n.includes("olive")) set.add("Green");
      if (set.size === 0) set.add(c.name);
    }
    return Array.from(set);
  }
  const text = `${sku.name} ${sku.cardTitle ?? ""} ${sku.tagline} ${sku.colourNote ?? ""}`.toLowerCase();
  const colors = new Set<string>();
  if (text.includes("white")) colors.add("White");
  if (text.includes("blue") || text.includes("azure")) colors.add("Blue");
  if (text.includes("red") || text.includes("inferno")) colors.add("Red");
  if (text.includes("yellow") || text.includes("amber")) colors.add("Yellow / Gold");
  if (text.includes("orange")) colors.add("Orange");
  if (text.includes("black")) colors.add("Black");
  if (text.includes("silver") || text.includes("grey")) colors.add("Silver / Grey");
  if (text.includes("green")) colors.add("Green");
  if (sku.colourNote) colors.add("Assorted / Mixed");
  if (colors.size === 0) colors.add("Multi / Standard");
  return Array.from(colors);
}

/**
 * Explicit, verified product classification map for every RC SKU in the catalog.
 * Excludes internal test items (`samtop-camera`).
 */
const EXPLICIT_PRODUCT_CLASSIFICATIONS: Record<
  string,
  Omit<ProductClassification, "skuId" | "scale" | "colorNames" | "seoTitle" | "seoDescription" | "primaryImageAlt">
> = {
  // ── Category 1: Mini RC Cars (1:64 & 1:43) ──
  "pocket-bmw": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "BMW Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "pocket-porsche": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Porsche Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "pocket-thar": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars"],
    vehicleType: "SUV & 4x4",
    drivingStyle: "Desktop Cruising",
    brand: "Mahindra Thar Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "pocket-monster": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars"],
    vehicleType: "Monster Truck",
    drivingStyle: "Off-Road & Stunt",
    brand: "Pocket RC",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "pocket-f1-classic": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Formula / Track Racer",
    drivingStyle: "Racing & Rally",
    brand: "Formula Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "cybertruck-camper": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars"],
    vehicleType: "SUV & 4x4",
    drivingStyle: "Desktop Cruising",
    brand: "Cybertruck Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "ferrari-drift": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Pocket RC",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "mini-atv": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars"],
    vehicleType: "ATV / Quad",
    drivingStyle: "Off-Road & Stunt",
    brand: "Pocket RC",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "mini-bmw-m4": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "BMW Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "mini-land-rover": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars"],
    vehicleType: "SUV & 4x4",
    drivingStyle: "Desktop Cruising",
    brand: "Land Rover Defender Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "mini-porsche": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Porsche Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "rc-tractor": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars"],
    vehicleType: "Farm & Utility",
    drivingStyle: "Desktop Cruising",
    brand: "Pocket RC",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "tiger-monster": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars"],
    vehicleType: "Monster Truck",
    drivingStyle: "Off-Road & Stunt",
    brand: "Pocket RC",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "toyota-trueno": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Toyota Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "skyline-gtr-43": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Nissan GT-R Style",
    drivetrain: "4WD",
    grade: "Proportional Mini",
  },
  "porsche-911-rsr-43": {
    primaryCategory: "mini-rc-cars",
    collections: ["mini-rc-cars", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Porsche Style",
    drivetrain: "4WD",
    grade: "Proportional Mini",
  },

  // ── Category 2: Drift & Racing RC (1:16, 1:20, Polo Rally) ──
  "drift-inferno": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Pocket RC",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "dares-azure": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Pocket RC",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "bmw-m4-dtm": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "BMW Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "extreme-street-drift": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Pocket RC",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "gtr-gt3": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Nissan GT-R Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "mercedes-amg-gt3": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Mercedes-AMG Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "lamborghini-vision-gt": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Racing & Rally",
    brand: "Lamborghini Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "toyota-ae86-20": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Toyota Style",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "track-rover": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "SUV & 4x4",
    drivingStyle: "Racing & Rally",
    brand: "Pocket RC",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "vw-polo-95-white": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Rally & Hot-Hatch",
    drivingStyle: "Racing & Rally",
    brand: "Volkswagen Polo",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "vw-polo-95-blue": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Rally & Hot-Hatch",
    drivingStyle: "Racing & Rally",
    brand: "Volkswagen Polo",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "polo-wrc-14": {
    primaryCategory: "drift-racing",
    collections: ["drift-racing"],
    vehicleType: "Rally & Hot-Hatch",
    drivingStyle: "Racing & Rally",
    brand: "Volkswagen Polo",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },

  // ── Category 3: Construction RC (1:64 & 1:18) ──
  "mining-truck": {
    primaryCategory: "construction-rc",
    collections: ["construction-rc"],
    vehicleType: "Construction Truck & Hauler",
    drivingStyle: "Construction & Working Rig",
    brand: "Heavy Construction Series",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "rc-excavator": {
    primaryCategory: "construction-rc",
    collections: ["construction-rc"],
    vehicleType: "Excavator",
    drivingStyle: "Construction & Working Rig",
    brand: "Heavy Construction Series",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "rc-forklift": {
    primaryCategory: "construction-rc",
    collections: ["construction-rc"],
    vehicleType: "Forklift",
    drivingStyle: "Construction & Working Rig",
    brand: "Heavy Construction Series",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "construction-3pack": {
    primaryCategory: "construction-rc",
    collections: ["construction-rc"],
    vehicleType: "Construction Bundle",
    drivingStyle: "Construction & Working Rig",
    brand: "Heavy Construction Series",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "cement-mixer-truck-18": {
    primaryCategory: "construction-rc",
    collections: ["construction-rc"],
    vehicleType: "Construction Truck & Hauler",
    drivingStyle: "Construction & Working Rig",
    brand: "Heavy Construction Series",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },
  "lowbed-trailer-truck-18": {
    primaryCategory: "construction-rc",
    collections: ["construction-rc"],
    vehicleType: "Construction Truck & Hauler",
    drivingStyle: "Construction & Working Rig",
    brand: "Heavy Construction Series",
    drivetrain: "2WD / RWD",
    grade: "Desktop / Toy-Grade",
  },

  // ── Category 4: Hobby Grade RC (Crawlers, Off-Road & 1:10 HobbyGrade) ──
  "mustang-gt500": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade", "drift-racing"],
    vehicleType: "Drift & Sports Car",
    drivingStyle: "Drift",
    brand: "Ford Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "defender-crawler-16": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade"],
    vehicleType: "Rock Crawler",
    drivingStyle: "Rock Crawling & Trail",
    brand: "Land Rover Defender Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "ford-pickup-crawler-16": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade"],
    vehicleType: "Rock Crawler",
    drivingStyle: "Rock Crawling & Trail",
    brand: "Ford Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "bronco-crawler-16": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade"],
    vehicleType: "Rock Crawler",
    drivingStyle: "Rock Crawling & Trail",
    brand: "Ford Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "bronco-desert-racer-18": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade"],
    vehicleType: "Off-Road Pickup & Truck",
    drivingStyle: "Off-Road & Stunt",
    brand: "Ford Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "land-cruiser-pickup-12": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade"],
    vehicleType: "Off-Road Pickup & Truck",
    drivingStyle: "Rock Crawling & Trail",
    brand: "Toyota Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "defender-pickup-12": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade"],
    vehicleType: "Off-Road Pickup & Truck",
    drivingStyle: "Rock Crawling & Trail",
    brand: "Land Rover Defender Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
  "land-cruiser-flatbed-12": {
    primaryCategory: "hobby-grade",
    collections: ["hobby-grade"],
    vehicleType: "Off-Road Pickup & Truck",
    drivingStyle: "Rock Crawling & Trail",
    brand: "Toyota Style",
    drivetrain: "4WD",
    grade: "Hobby-Grade",
  },
};

/**
 * Build search-focused, honest SEO title, meta description, and image alt text
 * for a SKU based on its verified attributes and pricing.
 */
function buildProductSeoFields(
  sku: Sku,
  meta: Omit<
    ProductClassification,
    "skuId" | "scale" | "colorNames" | "seoTitle" | "seoDescription" | "primaryImageAlt"
  >,
): { seoTitle: string; seoDescription: string; primaryImageAlt: string } {
  const onlinePrice = Math.max(0, sku.retailINR - 100);
  const formattedOnline = `₹${onlinePrice.toLocaleString("en-IN")}`;
  const colorCount = sku.colors?.length ?? 0;
  const colorSuffix =
    colorCount > 1 ? ` (${colorCount} Colours)` : "";

  let typeLabel: string = meta.vehicleType;
  if (meta.drivingStyle === "Drift") {
    typeLabel = meta.drivetrain === "4WD" ? "4WD RC Drift Car" : "Mini Drift RC Car";
  } else if (meta.vehicleType === "Rock Crawler") {
    typeLabel = "4WD RC Rock Crawler";
  } else if (meta.vehicleType === "Off-Road Pickup & Truck") {
    typeLabel = "4WD Off-Road RC Truck";
  } else if (meta.primaryCategory === "construction-rc") {
    typeLabel = "RC Construction Vehicle";
  } else if (meta.vehicleType === "Rally & Hot-Hatch") {
    typeLabel = "Rally RC Car";
  } else {
    typeLabel = "Die-Cast RC Car";
  }

  const seoTitle = `${sku.name} (${sku.scale} ${typeLabel})${colorSuffix} – ${formattedOnline} | Pocket RC Cars India`;

  const featureSnippet =
    sku.bullets?.[0] ??
    sku.tagline ??
    `${sku.scale} radio-controlled model with 2.4 GHz remote.`;

  const seoDescription = `Buy ${sku.name} (${sku.scale} ${typeLabel}) online in India at ${formattedOnline} (${sku.retailINR.toLocaleString("en-IN")} COD). ${featureSnippet} Ready-to-run with 2.4 GHz remote, fast 24-hr Bangalore dispatch & 7-day replacement.`;

  const primaryImageAlt = `${sku.name} — ${sku.scale} ${typeLabel} (${meta.drivetrain}) in India by Pocket RC Cars`;

  return { seoTitle, seoDescription, primaryImageAlt };
}

/**
 * Return the full structured classification for a given SKU, or `null` if the
 * SKU is not an RC product (e.g., `samtop-camera` test item).
 */
export function getProductClassification(sku: Sku): ProductClassification | null {
  if (sku.id === "samtop-camera") return null;

  const explicit = EXPLICIT_PRODUCT_CLASSIFICATIONS[sku.id];
  if (explicit) {
    const seo = buildProductSeoFields(sku, explicit);
    return {
      skuId: sku.id,
      scale: sku.scale,
      colorNames: inferColorNames(sku),
      ...explicit,
      ...seo,
    };
  }

  // Safe fallback for any newly added SKU not yet in EXPLICIT_PRODUCT_CLASSIFICATIONS
  let primaryCategory: PrimaryCategorySlug = "mini-rc-cars";
  if (sku.category === "construction") {
    primaryCategory = "construction-rc";
  } else if (sku.kind === "hobby" || sku.scale === "1:12" || sku.scale === "1:10") {
    primaryCategory = "hobby-grade";
  } else if (
    sku.scale === "1:16" ||
    sku.scale === "1:20" ||
    sku.scale === "1:14" ||
    sku.scale === "1:24" ||
    (sku.scale as string) === "1:32"
  ) {
    primaryCategory = "drift-racing";
  }

  const fallbackMeta = {
    primaryCategory,
    collections: [primaryCategory] as PrimaryCategorySlug[],
    vehicleType: "Drift & Sports Car" as VehicleType,
    drivingStyle: (sku.specs.drift && sku.specs.drift !== "No"
      ? "Drift"
      : "Desktop Cruising") as DrivingStyle,
    brand: "Pocket RC",
    drivetrain: (sku.specs.drive?.includes("4WD")
      ? "4WD"
      : "2WD / RWD") as DrivetrainType,
    grade: (sku.kind === "hobby" ? "Hobby-Grade" : "Desktop / Toy-Grade") as RcGrade,
  };

  const seo = buildProductSeoFields(sku, fallbackMeta);
  return {
    skuId: sku.id,
    scale: sku.scale,
    colorNames: inferColorNames(sku),
    ...fallbackMeta,
    ...seo,
  };
}

/**
 * Return the primary `StoreCategory` for a SKU (used for breadcrumbs, PDP
 * links, Merchant Center `product_type`, and structured data).
 */
export function getPrimaryCategoryForSku(sku: Sku): StoreCategory {
  const cls = getProductClassification(sku);
  const slug = cls?.primaryCategory ?? "mini-rc-cars";
  return (
    PRIMARY_CATEGORIES.find((c) => c.slug === slug) ?? PRIMARY_CATEGORIES[0]
  );
}

/**
 * Return all SKUs belonging to a category slug (`mini-rc-cars`, `drift-racing`,
 * `construction-rc`, `hobby-grade`), respecting both catalog `hidden` and
 * optional DB `overridesMap`.
 *
 * Products whose `primaryCategory` matches the collection are ordered first,
 * followed by secondary multi-collection matches.
 */
type OverridesMapLike =
  | Record<string, { hidden?: boolean | null; comingSoon?: boolean | null }>
  | Map<string, { hidden?: boolean | null; comingSoon?: boolean | null }>
  | null
  | undefined;

function lookupOverride(
  map: OverridesMapLike,
  skuId: string,
): { hidden?: boolean | null; comingSoon?: boolean | null } | undefined {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(skuId);
  return map[skuId];
}

export function getSkusForCategory(
  categorySlug: PrimaryCategorySlug,
  options?: {
    includeHidden?: boolean;
    overridesMap?: OverridesMapLike;
    primaryOnly?: boolean;
  },
): Sku[] {
  const includeHidden = options?.includeHidden ?? false;
  const overridesMap = options?.overridesMap ?? null;
  const primaryOnly = options?.primaryOnly ?? false;

  const primaryMatches: Sku[] = [];
  const secondaryMatches: Sku[] = [];

  for (const sku of ALL_SKUS) {
    if (sku.id === "samtop-camera") continue;

    if (!includeHidden) {
      const ovHidden = lookupOverride(overridesMap, sku.id)?.hidden;
      const isHidden =
        ovHidden !== undefined && ovHidden !== null ? ovHidden : Boolean(sku.hidden);
      if (isHidden) continue;
    }

    const cls = getProductClassification(sku);
    if (!cls) continue;

    if (cls.primaryCategory === categorySlug) {
      primaryMatches.push(sku);
    } else if (!primaryOnly && cls.collections.includes(categorySlug)) {
      secondaryMatches.push(sku);
    }
  }

  return [...primaryMatches, ...secondaryMatches];
}

/**
 * Return all indexable, storefront-visible RC SKUs across all 4 categories,
 * respecting both code `sku.hidden` and DB `product_overrides.hidden`.
 */
export function getAllIndexableSkus(
  overridesMap?: OverridesMapLike,
): Sku[] {
  return ALL_SKUS.filter((sku) => {
    if (sku.id === "samtop-camera") return false;
    const ov = lookupOverride(overridesMap, sku.id);
    const isHidden =
      ov?.hidden !== undefined && ov?.hidden !== null ? ov.hidden : Boolean(sku.hidden);
    if (isHidden) return false;
    const isComingSoon =
      ov?.comingSoon !== undefined && ov?.comingSoon !== null
        ? ov.comingSoon
        : Boolean(sku.comingSoon);
    if (isComingSoon) return false;
    return getProductClassification(sku) !== null;
  });
}
