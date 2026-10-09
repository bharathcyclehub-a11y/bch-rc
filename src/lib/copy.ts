export type HeroVariant =
  | "default"
  | "gift"
  | "couple"
  | "parent"
  | "carride"
  | "enthusiast";

export const HERO_VARIANTS: Record<
  HeroVariant,
  {
    h1: string;
    /** Optional emphasised lead word styled in brand-red. Lets the H1 read
     *  as one line while the keyword ("gift") visually anchors the hook. */
    h1Accent?: string;
    sub: string;
    ctaLabel: string;
    /** Three-line trust strip surfaced directly under the CTA. Ordered
     *  blocker-first: COD pre-pay-fear reliever first, then replacement,
     *  then real human support. Replaces the "Free shipping / 24-hr
     *  dispatch / 7-day replacement" generic bottom strip. */
    underCta: [string, string, string];
  }
> = {
  // Default — built for the IG-gifter the traffic model targets. The reels
  // arrive in gift mode; the page now opens in gift mode too. Five-second
  // test: product noun ("RC drift car"), buyer (gift-giver), feeling
  // ("car-crazy guy"), price (₹999/₹1,099), payment (COD), dispatch
  // (24-hr Bangalore). All present.
  default: {
    h1: "The gift he won't put down.",
    h1Accent: "gift",
    sub: "Real die-cast RC drift car. ₹999 online or ₹1,099 COD. Ships from Bangalore.",
    ctaLabel: "🛒 Order his gift — ₹999, COD",
    underCta: ["Pay on delivery", "7-day replacement", "WhatsApp support"],
  },
  // Explicit gift UTM — same shape since default is now gifting-first.
  // Kept distinct so we can fork copy later without touching default.
  gift: {
    h1: "The gift he won't put down.",
    h1Accent: "gift",
    sub: "Real die-cast RC drift car. ₹999 online or ₹1,099 COD. Gift-ready box.",
    ctaLabel: "🎁 Order his gift — ₹999, COD",
    underCta: ["Pay on delivery", "7-day replacement", "WhatsApp support"],
  },
  // Hinglish IG-DM landing — message-match for the "Unexpected Gift 🎁"
  // reels (Copy Crimes #8 fix). Same gifting frame, buyer's voice.
  couple: {
    h1: "₹999 mein asli RC drift car.",
    sub: "Uska face dekhna jab ye drift karega. COD pan-India. Bangalore se 24 ghante mein.",
    ctaLabel: "🎁 Surprise him — ₹999, COD",
    underCta: ["COD pan-India", "7-day replacement", "WhatsApp support"],
  },
  // Parent UTM — gift for any car-lover 8 to 38. Doesn't infantilise the
  // recipient (was "Your Kid"). Joy frame leads, spec demoted.
  parent: {
    h1: "The gift the car-lover won't put down.",
    h1Accent: "gift",
    sub: "Real die-cast RC drift car. For car-lovers 8 to 38. ₹999 online or ₹1,099 COD.",
    ctaLabel: "🛒 Order his gift — ₹999, COD",
    underCta: ["Pay on delivery", "7-day replacement", "Drop-tested"],
  },
  // Road-trip flavour, same gifting frame.
  carride: {
    h1: "Hand him this. Get the silence.",
    sub: "Real die-cast RC drift car. ₹999 online or ₹1,099 COD.",
    ctaLabel: "🛒 Order his gift — ₹999, COD",
    underCta: ["Pay on delivery", "7-day replacement", "WhatsApp support"],
  },
  // Most-Aware visitor (drift-clip UTM) — already knows what they want.
  // Don't re-pitch price (Psych p03/p07). Speak in the enthusiast register.
  enthusiast: {
    h1: "Your drift car. In your palm. Tonight.",
    sub: "1:64 die-cast. ₹999. COD pan-India.",
    ctaLabel: "Cart it. Drift it tonight. →",
    underCta: ["Drop-tested", "7-day replacement", "WhatsApp support"],
  },
};

export type Announcement = {
  text: string;
  /** Optional CTA href. If present, the announcement renders as a link with an arrow. */
  href?: string;
  /** Optional verb tag rendered as a colored pill before the text */
  tag?: string;
  /** Optional emoji prefix */
  emoji?: string;
};

// P12 — joy / operational reassurance wins position #1 in the marquee.
// Money cue (the ₹100 bonus) moves into position #3. The reviewer's point:
// whatever cue occupies the privileged opening moment becomes the focal
// criterion. Leading with "Pay online → ₹100 bonus" framed the page as
// "is it worth it?" before desire could build. Now the marquee opens on
// "Dispatched within 24 hrs" (operational reassurance), then the COD
// pan-India reliever, then the bonus.
export const ANNOUNCEMENTS: Announcement[] = [
  {
    text: "Dispatched within 24 hrs from Bangalore",
  },
  {
    emoji: "📦",
    text: "Pan-India COD · 7-day replacement · real WhatsApp support",
  },
  {
    text: "Pay online → ₹100 bonus + 24-hr dispatch",
  },
];

export const USPS = [
  { iconKey: "usbc", title: "USB-C charging", sub: "30-min full charge" },
  { iconKey: "drop", title: "Drop-tested 1.5m", sub: "Replaceable shell ₹99" },
  { iconKey: "shield", title: "7-day replacement", sub: "Age 8+ recommended" },
  { iconKey: "india", title: "Assembled in India", sub: "GST-paid" },
] as const;

export const FAQS: { q: string; a: string; defaultOpen?: boolean }[] = [
  {
    q: "Is COD available?",
    a: "Yes, pan-India. ₹49 fee under ₹999. Pay online → save ₹100.",
    defaultOpen: true,
  },
  {
    q: "How long does the battery last?",
    a: "12-15 min of real drift per charge. USB-C, ~30 min for a full charge. We don't inflate this number.",
  },
  {
    q: "What age is this for?",
    a: "Recommended 8+ (small parts — keep away from children under 3). Adults love them too.",
  },
  {
    q: "What if it breaks?",
    a: "7-day free replacement. WhatsApp a photo, fresh one ships in 24 hrs. Spare shell ₹99, battery ₹199.",
  },
  {
    q: "Where do you ship?",
    a: "Pan-India via Shiprocket. Metros 2–3 days, towns 4–7. Live WhatsApp tracking.",
  },
  {
    q: "Can I gift-wrap it?",
    a: "Premium gift box on every order. Free handwritten note at checkout. SMS goes to you, not the recipient.",
  },
  {
    q: "Does it work on carpet / tiles?",
    a: "Tile/marble/wood drifts best. Carpet = grip, not slide — still fun.",
  },
  {
    q: "What's in the box?",
    a: "Car (assembled), 2.4 GHz remote, USB-C cable + battery, spare drift wheels, gift box, guide.",
  },
  {
    q: "Do you sell spare parts?",
    a: "Shell ₹99 · battery ₹199 · drift wheels ₹99 · remote ₹299. Bangalore → 3 days.",
  },
  {
    q: "Bulk / wholesale orders for my shop?",
    a: "Visit /wholesale (GSTIN required). MOQ 12 pcs. Trade pricing 35–52% off MRP.",
  },
];

export const REVIEWS_SEED = [
  {
    rating: 5,
    text: "Bought the Storm for my husband's birthday. He literally screamed. Now he drifts it every day in the living room. The LED lights are insane.",
    name: "Priya M.",
    city: "Bangalore",
    sku: "1:43 Storm",
    date: "23 March 2026",
  },
  {
    rating: 5,
    text: "My 8-year-old's screen time has dropped by half. He's outside in the parking lot drifting this every evening. Worth every rupee.",
    name: "Rohan K.",
    city: "Pune",
    sku: "1:64 Storm Mini",
    date: "17 April 2026",
  },
  {
    rating: 5,
    text: "I'm 32, I bought it for myself. Showed it at the office, three colleagues ordered. The gyro on the 1:24 is no joke.",
    name: "Karthik R.",
    city: "Bangalore",
    sku: "1:24 Storm Pro",
    date: "2 May 2026",
  },
  {
    rating: 5,
    text: "Gift box was actually premium. Delivered in 3 days to Indore. Husband still hasn't put it down.",
    name: "Anu S.",
    city: "Indore",
    sku: "1:43 Storm",
    date: "11 April 2026",
  },
];
