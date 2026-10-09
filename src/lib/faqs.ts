/**
 * Home-page FAQ pairs. Lives in a non-client module so both the FAQ
 * component (client) and the JSON-LD emitter (server) can import the same
 * source. Money / RTO objections lead — buyers decide here whether to tap
 * Buy or bounce. Curiosity questions (scale, top speed) come AFTER the
 * wallet objections are killed.
 */

export type QA = { q: string; a: string };

export const HOME_FAQS: QA[] = [
  {
    q: "Is ₹999+ worth it? Why not a ₹400 toy from Amazon?",
    a: "₹400 toys are pull-back / single-channel — not a real RC car, plastic body, dies in a week. PRC is a 2.4 GHz die-cast alloy car with LED, USB-C, drift wheels included. Honest range: 12–15 mins per charge on smooth floors. Ships from our own Yelahanka warehouse, not drop-shipped from anywhere.",
  },
  {
    q: "Do you ship COD? Any extra fee?",
    a: "Yes — COD available pan-India. ₹49 COD fee only on orders under ₹999. Free on everything else.",
  },
  {
    q: "How do I save ₹100? (Online-pay bonus)",
    a: "Pay online via UPI / card / netbanking and you instantly get ₹100 off + dispatch within 24 hrs from Bangalore (COD orders wait for a verification call before they leave the warehouse). Either way, your order ships pan-India.",
  },
  {
    q: "What if it arrives broken or stops working?",
    a: "7-day no-questions-asked replacement on manufacturing defects or DOA. WhatsApp us — we send a fresh one and arrange pickup. No return shipping cost on your side.",
  },
  {
    q: "How fast is shipping?",
    a: "Dispatched in 24 hrs from Bangalore via Shiprocket. Delivery: 2–4 days metros · 4–7 days rest of India. Tracking link on WhatsApp + email.",
  },
  {
    q: "Is the battery replaceable? Do you sell spares?",
    a: "Yes. Spare batteries, drift wheels, USB-C cables and chassis parts are stocked at the Bangalore HQ. WhatsApp us with your order ID to reorder — ships within 48 hrs.",
  },
  {
    q: "How long does the battery last per charge?",
    a: "Honest number: 12–15 mins of continuous drift on a full charge. USB-C charging takes ~30 mins empty-to-full. We don't inflate this to 40 mins like the grey-market listings do.",
  },
  {
    q: "Is it safe for kids? What age?",
    a: "Recommended 8+. Small parts (wheels, antenna) — not suitable for under-3s. Body is die-cast alloy + ABS. The 2.4 GHz remote runs on 2× AAA batteries and uses standard toy-grade electronics.",
  },
  {
    q: "Does it work outdoors or only on tile?",
    a: "Best indoors on tile, marble or hardwood. Works on smooth outdoor surfaces (paved courtyards, terrace tiles). Won't grip grass, sand, or rough concrete. Not waterproof.",
  },
  {
    q: "Is this really 1:64 scale? How small is it?",
    a: "Yes — same scale as Hot Wheels. ~7 cm long, fits in your palm. It's the only fully-functional RC car at this size in India.",
  },
];
