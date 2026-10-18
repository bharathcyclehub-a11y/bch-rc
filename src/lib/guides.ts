/**
 * Practical RC Buying Guides — Pocket RC Cars (PRC)
 *
 * Supports commercial category & product discovery without fluff or fake specs.
 * Every guide links directly to the relevant primary category store
 * (/collections/[slug]) and real in-catalog products (/product/[slug]).
 */

import { type PrimaryCategorySlug } from "./categories";

export interface BuyingGuideSection {
  heading: string;
  paragraphs: string[];
  comparisonRows?: Array<{
    attribute: string;
    colA: string;
    colB: string;
  }>;
  colHeaders?: [string, string];
}

export interface BuyingGuide {
  slug: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  kicker: string;
  readMinutes: number;
  updatedDate: string;
  heroImage: string;
  heroImageAlt: string;
  primaryCategorySlug: PrimaryCategorySlug;
  relatedCategorySlugs: PrimaryCategorySlug[];
  recommendedProductSlugs: string[];
  summary: string;
  sections: BuyingGuideSection[];
  faqs: Array<{ question: string; answer: string }>;
}

export const BUYING_GUIDES: BuyingGuide[] = [
  {
    slug: "mini-rc-cars-1-64-vs-1-43-guide",
    title: "1:64 vs 1:43 Mini RC Cars: Which Compact Scale Fits Your Space?",
    seoTitle:
      "1:64 vs 1:43 Mini RC Cars Guide in India — Size, 4WD Gyro & Runtime Compared | Pocket RC Cars",
    seoDescription:
      "Compare 1:64 pocket die-cast RC cars (~7.5 cm) vs 1:43 4WD gyro mini drift cars (~11 cm) in India. Real dimensions, drivetrain differences, floor surfaces, and battery life.",
    kicker: "Scale Comparison Guide",
    readMinutes: 4,
    updatedDate: "2026-10-16",
    heroImage: "/products/colors/PRC-bmw-white.webp",
    heroImageAlt: "1:64 Pocket BMW M3 E30 vs 1:43 Skyline GT-R R34 Mini RC Cars",
    primaryCategorySlug: "mini-rc-cars",
    relatedCategorySlugs: ["mini-rc-cars", "drift-racing"],
    recommendedProductSlugs: [
      "pocket-bmw",
      "pocket-porsche",
      "skyline-gtr-43",
      "porsche-911-rsr-43",
    ],
    summary:
      "Both 1:64 and 1:43 RC cars are designed for indoor driving, but they use very different chassis layouts. Here is how to choose between a 7.5 cm die-cast desktop cruiser and an 11 cm 4WD gyro-stabilized mini drifter.",
    sections: [
      {
        heading: "1. Physical Footprint & Where You Drive",
        paragraphs: [
          "A 1:64 scale RC car measures roughly 7.5 cm long—identical in footprint to a standard Hot Wheels or Matchbox die-cast model. Because its turning radius is under 25 cm, you can weave around keyboards, coffee mugs, and textbooks on an office desk or dining table.",
          "A 1:43 scale RC car is roughly 11 cm long and wider across the track. It needs a slightly larger smooth area—such as a living-room floor, hallway, or tiled balcony—where its higher 15 km/h speed and 4WD sideways drift angle can shine.",
        ],
        colHeaders: ["1:64 Pocket Series", "1:43 Gyro Drift Series"],
        comparisonRows: [
          {
            attribute: "Typical Length",
            colA: "~7.5 cm (Palm / Desk size)",
            colB: "~11 cm (Compact Floor size)",
          },
          {
            attribute: "Drivetrain",
            colA: "2WD / Rear-Wheel Drive",
            colB: "4WD All-Wheel Drive + Gyro",
          },
          {
            attribute: "Body Construction",
            colA: "Zinc-alloy die-cast metal shell",
            colB: "Lightweight polycarbonate racing shell",
          },
          {
            attribute: "Battery Runtime",
            colA: "35–40 mins via USB-C",
            colB: "20–25 mins via USB-C",
          },
          {
            attribute: "Starting Online Price",
            colA: "₹999 online (₹1,099 COD)",
            colB: "₹1,699 online (₹1,799 COD)",
          },
        ],
      },
      {
        heading: "2. Drivetrain & Steering Feel: 2WD Desktop vs 4WD Gyro",
        paragraphs: [
          "Our 1:64 Pocket Series (such as the BMW M3 E30, Porsche 911 Turbo, Classic F1 Racer, Thar SUV, and Monster Truck) uses a compact rear-wheel-drive motor paired with a zinc-alloy metal body. The extra weight of the metal shell gives stable traction on smooth wood and tile while allowing tail-out slides when you flick the steering.",
          "By contrast, the 1:43 Nissan Skyline GT-R R34 and Porsche 911 RSR feature a 4WD drivetrain, proportional steering servo, and an onboard electronic gyro. When the rear end steps out on vitrified tiles, the gyro automatically counter-steers to hold a clean, continuous drift arc around cones.",
        ],
      },
      {
        heading: "3. Which One Should You Pick?",
        paragraphs: [
          "Choose a 1:64 model if you want a heavy metal collectible that lives on your work desk, runs for up to 40 minutes per charge, or makes an sub-₹1,000 gift. Choose a 1:43 4WD Gyro model if your main goal is practicing continuous figure-eight drifts on smooth apartment floors.",
        ],
      },
    ],
    faqs: [
      {
        question: "Do both 1:64 and 1:43 models charge with a standard USB-C cable?",
        answer:
          "Yes. Both scales include a USB Type-C charging cable in the box that plugs into any phone adapter, laptop, or power bank.",
      },
      {
        question: "Are spare tires included with the 1:64 and 1:43 drift models?",
        answer:
          "Yes. Both the 1:64 drift cars and the 1:43 4WD gyro drift cars ship with spare wheel sets so you can swap between smooth drift slicks and rubber traction tires.",
      },
    ],
  },
  {
    slug: "best-rc-drift-cars-for-beginners-india",
    title: "Best RC Drift Cars for Beginners in India (1:64, 1:43, 1:20 & 1:16 Compared)",
    seoTitle:
      "Best RC Drift Cars for Beginners in India (2026 Buyer's Guide) | Pocket RC Cars",
    seoDescription:
      "Looking for your first RC drift car in India? Compare 1:64 desktop drifters, 1:43 gyro cars, 1:20 AE86 models, and 1:16 4WD LED smoke drift cars by budget and surface.",
    kicker: "Drift Buyer's Guide",
    readMinutes: 5,
    updatedDate: "2026-10-16",
    heroImage: "/store16-images/drift-inferno/1-hero.webp",
    heroImageAlt: "1:16 Drift Car Inferno 4WD with LED Exhaust Smoke",
    primaryCategorySlug: "drift-racing",
    relatedCategorySlugs: ["drift-racing", "mini-rc-cars", "hobby-grade"],
    recommendedProductSlugs: [
      "drift-inferno",
      "bmw-m4-dtm",
      "gtr-gt3",
      "toyota-ae86-20",
      "skyline-gtr-43",
    ],
    summary:
      "True RC drifting relies on matching tire compound and drivetrain to your driving surface. Here is a breakdown of every drift and racing platform we stock in India—and how to avoid buying a grip racer when you want sideways slides.",
    sections: [
      {
        heading: "1. What Actually Makes an RC Car Drift?",
        paragraphs: [
          "A genuine RC drift car breaks rear traction intentionally while maintaining front steering authority. In our catalog, that happens in one of two ways: either via a 4WD drivetrain spinning hard low-friction drift slicks (used on our 1:16 Smoke Drift series, 1:43 Gyro series, and 1:10 Mustang GT500), or via lightweight rear-wheel drive with slick tires on smooth indoor tiles (used on our 1:64 and 1:20 AE86 drift models).",
          "Important distinction: Not every racing-styled car in our Drift & Racing RC collection is a sideways drifter. For example, our Volkswagen Polo #95 (1:32 & 1:24) and Polo R WRC (1:14) models use grooved rubber tires for grip racing and rally sprints rather than sideways drifting.",
        ],
        colHeaders: ["1:16 4WD Smoke Drift Series", "1:20 & Polo Racing Series"],
        comparisonRows: [
          {
            attribute: "Drivetrain",
            colA: "4WD All-Wheel Drive",
            colB: "2WD Rear-Wheel Drive",
          },
          {
            attribute: "Tire Sets Included",
            colA: "4× Hard Drift Slicks + 4× Rubber Grip Tires",
            colB: "Model-specific (AE86 Drift vs Polo Grip)",
          },
          {
            attribute: "Special Features",
            colA: "Water-mist LED rear exhaust smoke + headlights",
            colB: "Compact indoor/courtyard chassis + LED lights",
          },
          {
            attribute: "Top Speed",
            colA: "25–30 km/h",
            colB: "15–20 km/h",
          },
        ],
      },
      {
        heading: "2. Best Picks by Budget & Surface",
        paragraphs: [
          "Under ₹1,300 (Indoor Tiles & Desks): Pick the 1:64 BMW M3 E30 or Porsche 911 Turbo (₹999 online) for tabletop slides, or the 1:20 Toyota AE86 Trueno (₹1,299 online) if you want classic pop-up-headlight JDM styling on living-room floors.",
          "₹1,699 – ₹2,099 (Hallways & Gyro Precision): The 1:43 Skyline GT-R R34 and Porsche 911 RSR add 4WD and an active electronic gyro that keeps beginners from spinning out.",
          "₹2,899 – ₹3,499 (Full 1:16 4WD + Water-Mist Exhaust Smoke): The 1:16 Drift Inferno, Dares Azure, BMW M4 DTM, Nissan GT-R GT3, and Mercedes-AMG GT3 are 28 cm 4WD machines with dual wheel sets and cool water-mist LED exhaust smoke—suitable for both indoor halls and smooth outdoor parking lots.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is the exhaust smoke on 1:16 drift cars safe indoors?",
        answer:
          "Yes. The rear exhaust mist uses plain tap water atomized ultrasonically—there is no oil, burning element, or chemical residue.",
      },
      {
        question: "What happens if my drift tires wear down on rough concrete?",
        answer:
          "Every 1:16 drift car comes with two full sets of wheels (8 wheels total) so you can use smooth plastic slicks on tile/marble and switch to grooved rubber tires on rougher tarmac.",
      },
    ],
  },
  {
    slug: "toy-grade-vs-hobby-grade-rc-cars",
    title: "Toy-Grade vs Hobby-Grade RC Cars: Proportional Control, 4WD & Crawlers Explained",
    seoTitle:
      "Toy-Grade vs Hobby-Grade RC Cars in India — Proportional Steering & 4WD Guide | Pocket RC Cars",
    seoDescription:
      "Understand the real difference between desktop toy-grade RC cars and proportional 4WD hobby-grade RC rock crawlers and off-road trucks in India.",
    kicker: "Technical Guide",
    readMinutes: 5,
    updatedDate: "2026-10-16",
    heroImage: "/products/rcai/defender-crawler-16/yellow.webp",
    heroImageAlt: "1:16 Land Rover Defender 4x4 Hobby-Grade RC Rock Crawler",
    primaryCategorySlug: "hobby-grade",
    relatedCategorySlugs: ["hobby-grade", "mini-rc-cars", "drift-racing"],
    recommendedProductSlugs: [
      "defender-crawler-16",
      "bronco-crawler-16",
      "land-cruiser-pickup-12",
      "bronco-desert-racer-18",
      "mustang-gt500",
    ],
    summary:
      "We never label a toy-grade car 'hobby grade' just to pad a category. Here is the honest engineering difference between desktop RC cars and true proportional 4WD hobby-grade crawlers and off-road trucks.",
    sections: [
      {
        heading: "1. Proportional Throttle & Steering vs On/Off Controls",
        paragraphs: [
          "In a standard desktop or entry-level RC car, pressing the trigger or steering wheel applies full power or full lock immediately. That is fun and simple on a flat tabletop, but on rocks or tight trails you need finesse.",
          "Hobby-grade RC vehicles—like our 1:16 Defender, Bronco, and Ford Pickup 4x4 Crawlers, 1:12 Land Cruiser 79 series, and 1:10 Mustang GT500—use proportional servos and electronic speed controllers (ESCs). Pull the trigger 15% and the truck creeps forward at walking pace over stones; turn the wheel 20 degrees and the front tires hold that exact 20-degree angle.",
        ],
        colHeaders: ["Desktop / Toy-Grade RC", "Hobby-Grade & Trail Crawler RC"],
        comparisonRows: [
          {
            attribute: "Throttle & Steering",
            colA: "Quick-response casual control",
            colB: "Proportional variable-angle servo & throttle",
          },
          {
            attribute: "Suspension",
            colA: "Compact spring or solid axle",
            colB: "Multi-link coil-over or independent long-travel suspension",
          },
          {
            attribute: "Terrain Capability",
            colA: "Smooth indoor floors, desks, tiles",
            colB: "Outdoor rocks, grass, dirt, sand, inclines up to 45°",
          },
          {
            attribute: "Typical Scales",
            colA: "1:64, 1:32, 1:24, 1:20",
            colB: "1:16, 1:18, 1:12, 1:10",
          },
        ],
      },
      {
        heading: "2. Choosing Between Rock Crawlers and High-Speed Off-Roaders",
        paragraphs: [
          "If you want slow, high-torque technical climbing over garden rocks, roots, and uneven trails, pick the 1:16 Land Rover Defender 4x4 Crawler (₹2,099 online) or the larger 36 cm 1:12 Toyota Land Cruiser 79 Pickup / Flatbed series (₹3,399–₹3,499 online).",
          "If you prefer fast dirt roosts and desert-truck jumps, choose the 1:18 Bronco R Baja Trophy Truck (₹2,699 online), or step up to the 1:10 Ford Mustang GT500 4WD (₹3,999 online) for 35 km/h tarmac performance.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is No-Cost EMI available on Hobby Grade RC cars?",
        answer:
          "Yes. Any order or multi-car cart of ₹2,500 or above unlocks 6-month No-Cost EMI at checkout via Razorpay (supported across major Indian credit cards and cardless EMI partners).",
      },
    ],
  },
  {
    slug: "rc-construction-vehicles-buying-guide",
    title: "RC Construction Vehicles Guide: Excavators, Forklifts & Heavy Haulers",
    seoTitle:
      "RC Construction Vehicles Buying Guide in India — Excavator, Forklift & Trucks | Pocket RC Cars",
    seoDescription:
      "Complete guide to radio-controlled construction vehicles in India: 1:64 alloy RC excavators, forklifts, dump trucks, 3-pack bundles, and 1:18 cement mixers.",
    kicker: "Construction Fleet Guide",
    readMinutes: 4,
    updatedDate: "2026-10-16",
    heroImage: "/landing/construction-3pack.webp",
    heroImageAlt: "1:64 RC Construction Crew 3-Pack — Excavator, Forklift & Dump Truck",
    primaryCategorySlug: "construction-rc",
    relatedCategorySlugs: ["construction-rc", "mini-rc-cars", "hobby-grade"],
    recommendedProductSlugs: [
      "construction-3pack",
      "rc-excavator",
      "rc-forklift",
      "mining-truck",
      "cement-mixer-truck-18",
      "lowbed-trailer-truck-18",
    ],
    summary:
      "Unlike ordinarycars that only drive forward and backward, RC construction rigs add remote-controlled digging arms, lifting forks, tipping dump beds, and rotating mixer drums.",
    sections: [
      {
        heading: "1. 1:64 Alloy Desktop Job-Site Series vs 1:18 Heavy Haulers",
        paragraphs: [
          "Our Construction RC lineup is split into two distinct scale families that can even work together on the same floor:",
          "The 1:64 Pocket Construction series (Tracked Excavator, Warehouse Forklift, and Mining Dump Truck) uses zinc-alloy metal cabins and fits on any desk or tabletop. Each machine has a dedicated 2.4 GHz remote that operates both driving and its working tool (digging arm, fork mast, or dump bed). Buying the Construction Crew 3-Pack saves ₹699 and includes all three vehicles with three separate remotes so three people can run a coordinated job site.",
          "The 1:18 Heavy Construction series steps up to 35–40 cm length: the 1:18 Heavy-Duty Cement Mixer features a motorized rotating drum and discharge chute, while the 1:18 Low-Bed Trailer Truck has a drop-down ramp wide enough to load and haul your 1:64 excavators or mini RC cars across the room.",
        ],
      },
    ],
    faqs: [
      {
        question: "Why are 1:64 construction vehicles in Construction RC instead of Mini RC Cars?",
        answer:
          "We classify products by their primary purpose and play pattern rather than scale alone. Shoppers looking for excavators, forklifts, and dump trucks want working multi-channel construction machinery rather than street drift cars.",
      },
    ],
  },
];

export function getBuyingGuideBySlug(slug: string): BuyingGuide | undefined {
  return BUYING_GUIDES.find((g) => g.slug === slug);
}
