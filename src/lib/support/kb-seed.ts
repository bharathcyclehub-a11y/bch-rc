/**
 * Starter help articles, loaded on demand from /admin/support/articles
 * ("Load starter articles" — inserts missing slugs only, never overwrites).
 *
 * Every statement here is taken from copy already published on the site
 * (src/lib/faqs.ts, src/components/HowToUse.tsx, src/lib/policies.ts) or from
 * the support system itself. Product numbers (charge time, run time, range)
 * are NOT written into articles: the article page shows each product's own
 * catalogue specs instead. Anything not backed by product documentation is
 * flagged needsVerification, which shows customers a "being verified" note
 * until staff confirm it.
 */

export type SeedArticle = {
  slug: string;
  title: string;
  summary: string;
  category: "GETTING_STARTED" | "TROUBLESHOOTING" | "MAINTENANCE" | "ORDERS" | "POLICY";
  difficulty: "EASY" | "MEDIUM" | "ADVANCED";
  needsVerification: boolean;
  /** Hub categories (src/lib/products.ts `category`) the article applies to; empty = all. */
  productCategories: string[];
  steps: Array<{ title: string; text: string }>;
  note?: string;
  related: string[];
  sources: string[];
};

export const SEED_ARTICLES: SeedArticle[] = [
  {
    slug: "getting-started-pocket-rc",
    title: "First drive: charge, pair and drift",
    summary: "Set up your Pocket RC car in three steps.",
    category: "GETTING_STARTED",
    difficulty: "EASY",
    needsVerification: true,
    productCategories: ["mini"],
    steps: [
      { title: "Charge the car", text: "Plug the USB-C cable into the car and charge it fully before the first drive. Your car's charge time is listed under Product facts on this page." },
      { title: "Fit the remote batteries", text: "The 2.4 GHz remote runs on 2× AAA batteries." },
      { title: "Switch on and pair", text: "Flip the switch on the car, then turn on the remote. It pairs automatically in a couple of seconds." },
      { title: "Pick the right floor", text: "Tile, marble or hardwood are best for drifting. It works on smooth paved surfaces too, but not on grass, sand or rough concrete. It is not waterproof." },
    ],
    related: ["car-not-moving", "remote-not-pairing", "safe-use"],
    sources: ["HowToUse.tsx", "faqs.ts"],
  },
  {
    slug: "car-not-moving",
    title: "Car not moving",
    summary: "Quick checks when the car won't drive or respond.",
    category: "TROUBLESHOOTING",
    difficulty: "EASY",
    needsVerification: true,
    productCategories: [],
    steps: [
      { title: "Charge the car fully", text: "A flat battery is the most common cause. Charge with the USB-C cable from the box and try again." },
      { title: "Check the remote batteries", text: "Put fresh AAA batteries in the remote." },
      { title: "Switch on in the right order", text: "Turn the car OFF and the remote OFF. Switch the car ON first, then the remote, so they pair again." },
      { title: "Check the wheels", text: "Make sure nothing (hair, carpet fibre, thread) is caught around the wheels or axles." },
    ],
    note: "Still not moving? If it's within 7 days of delivery, a manufacturing defect is covered by our replacement policy — raise a request below and attach a short video.",
    related: ["remote-not-pairing", "battery-not-charging", "replacement-policy"],
    sources: ["HowToUse.tsx", "faqs.ts", "policies.ts"],
  },
  {
    slug: "remote-not-pairing",
    title: "Remote not pairing or keeps disconnecting",
    summary: "Re-pair the 2.4 GHz remote with the car.",
    category: "TROUBLESHOOTING",
    difficulty: "EASY",
    needsVerification: true,
    productCategories: [],
    steps: [
      { title: "Fresh batteries", text: "Weak AAA batteries in the remote cause drop-outs. Replace them first." },
      { title: "Re-pair", text: "Switch both off. Switch the car on, then the remote, and keep them close together while they pair." },
      { title: "Charge the car", text: "A low car battery can also look like a pairing problem — charge it fully and try again." },
    ],
    note: "\"Remote not pairing\" is listed as a manufacturing defect in our replacement policy (7 days from delivery).",
    related: ["car-not-moving", "battery-not-charging"],
    sources: ["HowToUse.tsx", "faqs.ts", "policies.ts"],
  },
  {
    slug: "battery-not-charging",
    title: "Battery not charging or running out fast",
    summary: "What to check, and when to stop using the car.",
    category: "TROUBLESHOOTING",
    difficulty: "EASY",
    needsVerification: true,
    productCategories: [],
    steps: [
      { title: "Use the cable from the box", text: "Charge with the USB-C cable that came with the car." },
      { title: "Try another USB port or adapter", text: "Some phone adapters and ports don't supply power reliably. Try a different one." },
      { title: "Compare with the expected times", text: "Check the charge and run times under Product facts on this page — run time depends on the floor and how hard you drive." },
      { title: "Stop if it gets hot", text: "If the car or battery gets very hot, smells of burning, smokes or swells, unplug it, stop using it and raise a request — we treat this as urgent." },
    ],
    note: "\"Won't charge\" is a manufacturing defect under our replacement policy (7 days from delivery).",
    related: ["car-not-moving", "safe-use", "spare-parts"],
    sources: ["faqs.ts", "policies.ts"],
  },
  {
    slug: "safe-use",
    title: "Safe use and care",
    summary: "Where to drive, age guidance and what voids the replacement cover.",
    category: "MAINTENANCE",
    difficulty: "EASY",
    needsVerification: false,
    productCategories: [],
    steps: [
      { title: "Age", text: "Recommended for ages 8+. Small parts (wheels, antenna) are not suitable for children under 3." },
      { title: "Keep it dry", text: "The car is not waterproof. Driving into water is misuse and isn't covered." },
      { title: "Avoid drops and modifications", text: "Drops from above 1.5 m, modifications and objects jammed in the gears aren't covered by the replacement policy." },
    ],
    related: ["spare-parts", "replacement-policy"],
    sources: ["faqs.ts", "policies.ts"],
  },
  {
    slug: "spare-parts",
    title: "Spare parts",
    summary: "Batteries, shells, drift wheels and remotes after the 7-day window.",
    category: "MAINTENANCE",
    difficulty: "EASY",
    needsVerification: false,
    productCategories: [],
    steps: [
      { title: "What we sell", text: "Body shell ₹99, battery ₹199, drift wheels ₹99 per set, remote ₹299 (from our replacement policy)." },
      { title: "How to order", text: "Raise a \"Spare parts request\" below or WhatsApp us with your order ID and the part you need." },
    ],
    related: ["safe-use"],
    sources: ["policies.ts"],
  },
  {
    slug: "replacement-policy",
    title: "Replacement policy in 30 seconds",
    summary: "What's covered, the 7-day window and what to send us.",
    category: "POLICY",
    difficulty: "EASY",
    needsVerification: false,
    productCategories: [],
    steps: [
      { title: "Covered for 7 days from delivery", text: "Damage in transit, manufacturing defects (won't charge, won't power on, remote not pairing), wrong item or colour, and missing accessories." },
      { title: "Send a photo or short video", text: "Raise a request with a photo or short video showing the issue. We confirm during support hours (10 AM – 8 PM IST)." },
      { title: "Not covered", text: "Misuse (water, drops above 1.5 m, modifications), normal wear after 7 days, and items lost or stolen after delivery." },
    ],
    related: ["refund-timelines", "car-not-moving"],
    sources: ["policies.ts"],
  },
  {
    slug: "refund-timelines",
    title: "Refunds: eligibility and timelines",
    summary: "When you can get a refund and how long it takes.",
    category: "POLICY",
    difficulty: "EASY",
    needsVerification: false,
    productCategories: [],
    steps: [
      { title: "Within 7 days of delivery", text: "Damaged, defective or wrong items get a full refund. Change of mind is accepted only if the product is unopened and unused (refund less ₹100 forward + return shipping)." },
      { title: "Inspection", text: "Returned items are inspected within 1–2 working days of reaching us." },
      { title: "Timelines", text: "UPI / card / net banking: 5–7 working days to the same source after we start the refund. COD: 3–5 working days to your bank account or UPI ID." },
      { title: "Status", text: "Open your request to see the refund status and, once started, its reference number." },
    ],
    related: ["replacement-policy"],
    sources: ["policies.ts"],
  },
  {
    slug: "track-your-order",
    title: "How tracking works",
    summary: "What each date on the tracking page means.",
    category: "ORDERS",
    difficulty: "EASY",
    needsVerification: false,
    productCategories: [],
    steps: [
      { title: "Last courier update", text: "The time the courier last scanned your parcel. We never change this time — if it looks old, the courier hasn't scanned it since." },
      { title: "Last tracking check", text: "When we last asked the courier for news. We check automatically, more often when a parcel is out for delivery or delayed." },
      { title: "Estimated delivery", text: "The courier's estimate when they give one, otherwise our own estimate (labelled as such). If the date passes without delivery we say so and ask the courier for a new date." },
    ],
    related: ["delivery-times"],
    sources: ["support centre"],
  },
  {
    slug: "delivery-times",
    title: "Dispatch and delivery times",
    summary: "When orders leave our warehouse and how long couriers take.",
    category: "ORDERS",
    difficulty: "EASY",
    needsVerification: true,
    productCategories: [],
    steps: [
      { title: "Dispatch", text: "Orders are dispatched within 24 hours from Bangalore. Cash on Delivery orders are dispatched within 24 hours of our confirmation call. We don't dispatch on Sundays or national holidays." },
      { title: "Delivery", text: "Courier delivery times depend on your pincode. See our Shipping Policy for the current estimates." },
    ],
    related: ["track-your-order"],
    sources: ["policies.ts"],
  },
];
