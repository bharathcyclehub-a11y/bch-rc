/**
 * Storefront legal/policy content. Each entry is the body of a policy page.
 * Markdown-lite: paragraphs separated by blank lines, headings as `## Heading`,
 * bullet lists as `- item`. Rendered by /policies/[slug]/page.tsx.
 *
 * Updated dates reflect the active version — bump when you edit.
 */

import { THEME } from "@/lib/theme";

export type Policy = {
  slug: string;
  title: string;
  /** Short blurb shown under the H1 */
  intro: string;
  /** Last updated, format YYYY-MM-DD */
  updated: string;
  /** Markdown-lite body */
  body: string;
};

const COMPANY = THEME.legal.legalName;
const TRADE = THEME.legal.tradeName;
const GSTIN = THEME.legal.gstin;
const ADDRESS = THEME.legal.registeredAddress;
const EMAIL = THEME.email;
const WA = THEME.phoneDisplay;
const BRAND = THEME.brandName;
const DOMAIN = THEME.domain;

export const POLICIES: Policy[] = [
  {
    slug: "shipping",
    title: "Shipping Policy",
    intro: `How we get your ${BRAND} drift car from our Bangalore warehouse to your door — fast, tracked, and pan-India.`,
    updated: "2026-10-09",
    body: `
## Where we ship

We ship pan-India — every PIN code Shiprocket delivers to, which is over 27,000 cities, towns and villages.

## Dispatch time

Orders dispatch within **24 hours** from our Yelahanka, Bangalore warehouse. Cash on Delivery orders dispatch within 24 hours of our confirmation call. We do not dispatch on Sundays or national holidays — your order moves first thing the next working morning.

## Delivery timelines

- **Tier-1 metros** (Bangalore, Mumbai, Delhi-NCR, Hyderabad, Chennai, Pune, Kolkata, Ahmedabad): **2–3 working days** from dispatch.
- **Tier-2 / Tier-3 cities**: **4–7 working days** from dispatch.
- **Northeast, Andaman & Nicobar, Lakshadweep, Ladakh**: **7–10 working days**.

Final delivery is by Shiprocket's courier partner (Delhivery, Blue Dart, Ekart, Xpressbees, or DTDC — assigned based on PIN code coverage).

## Shipping charges

- **Free shipping** on every order ₹1,099 and above.
- Below ₹1,099: a flat ₹85 shipping fee applies.

## Cash on Delivery (COD)

- COD available pan-India.
- A flat ₹49 COD handling fee applies on orders below ₹999. No COD fee on orders ₹999 and above.
- Pay online (UPI / card / net banking) and ₹100 is taken off automatically — no code needed.

## Tracking your order

You'll receive a tracking link via WhatsApp and SMS within 24 hours of dispatch. You can also enter your order ID on our [Track Order](/track) page.

## Wrong / undeliverable address

If the address is wrong or the courier can't deliver after 3 attempts, the package returns to our warehouse. We'll reach out via WhatsApp to confirm a correct address — if we don't hear back within 7 days, the order is treated as cancelled and refunded (less ₹100 forward + return shipping).

## Questions

WhatsApp us at **${WA}** or email **${EMAIL}** — we reply within 4 hours, 10 AM to 8 PM IST.
`.trim(),
  },
  {
    slug: "replacement",
    title: "Replacement Policy",
    intro: `7-day free replacement on any manufacturing defect, damage in transit, or "this isn't what I ordered" mix-up — no questions asked.`,
    updated: "2026-10-09",
    body: `
## The simple version

If your ${BRAND} arrives damaged, defective, or different from what you ordered — WhatsApp us a photo within **7 days of delivery** and we'll dispatch a free replacement within 24 hours. No return courier hassle, no questions.

## What's covered

- **Damage in transit** — cracked shell, broken wheels, snapped antenna
- **Manufacturing defect** — won't charge, won't power on, drift wheels missing, remote not pairing
- **Wrong item / wrong colour** sent
- **Missing accessory** from the box (drift wheel set, USB-C cable, manual)

## What's NOT covered

- Damage caused by misuse — driving into water, dropping from above 1.5m, modifications, jamming objects into the gears
- Normal wear and tear after the 7-day window — shell scuffs, wheel rubber wearing down, battery capacity dropping after months of use
- Lost or stolen items after delivery confirmation

For wear-and-tear after the 7-day window, we sell spare parts (body shell ₹99, battery ₹199, drift wheels ₹99 set, remote ₹299) — WhatsApp us and we'll ship from Bangalore in 3 working days.

## How to claim a replacement

1. Within **7 days of delivery**, WhatsApp **${WA}** with:
   - Your order ID
   - A photo or short video showing the issue
2. We confirm within 4 hours during business hours (10 AM – 8 PM IST).
3. Replacement dispatches within 24 hours — you keep the defective unit, no return courier needed.
4. New tracking sent via WhatsApp.

## Replacement vs. refund

We replace by default — most customers prefer a working car over money back. If you'd rather refund, see our [Refund Policy](/policies/refund). Refunds are issued under the same 7-day window.

## Questions

WhatsApp **${WA}** · email **${EMAIL}**.
`.trim(),
  },
  {
    slug: "refund",
    title: "Refund Policy",
    intro: `When and how you get your money back — refunds within 7 days of delivery, no restocking fee on defective units.`,
    updated: "2026-06-02",
    body: `
## Eligibility

You can request a refund within **7 days of delivery** if:

- The product arrived **damaged, defective, or wrong** (full refund, no questions).
- You **changed your mind** and the product is **unopened and unused** in the original gift box (refund less ₹100 forward + return shipping).
- Your order was **lost in transit** and the courier marked it as undeliverable after 3 attempts (full refund).

Refunds are NOT available for:

- Used / opened products with normal wear (we still offer replacement under the [Replacement Policy](/policies/replacement) for genuine defects)
- Damage caused by misuse or modification
- Requests made after the 7-day window

## How to request a refund

1. WhatsApp **${WA}** with your order ID and reason within 7 days of delivery.
2. For "changed my mind" returns: we send a Shiprocket return pickup to your address (no cost if defective; ₹100 deducted if return-only).
3. Once the unit arrives at our warehouse and passes inspection (1–2 working days), the refund is initiated.

## Refund timeline

- **UPI / card / net banking** payments: refunded to the same source in **5–7 working days** after we initiate.
- **COD** orders: refunded to your bank account or UPI ID (we'll collect details via WhatsApp) in **3–5 working days**.
- COD orders cannot be refunded to a different person's account — must match the buyer's name on the order.

## Partial refunds

If a bundle order (Buy 2 / Buy 3) is partially defective, we refund only the affected unit at its **un-bundled** retail price, not the discounted bundle slice. Example: a 2-car bundle where one Porsche is defective — refund is ₹1,399 (Porsche retail), keeping the second car at full retail value.

## Order cancellation before dispatch

If your order hasn't dispatched yet (typically within 4 hours of placing), WhatsApp us to cancel — full refund initiated the same day. After dispatch, the order falls under the standard refund / replacement policy above.

## Questions

WhatsApp **${WA}** · email **${EMAIL}**.
`.trim(),
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    intro: `What data we collect, why, and how we protect it. Plain English, no dark patterns.`,
    updated: "2026-06-02",
    body: `
## Who we are

${DOMAIN} ("${BRAND}", "we", "us") is operated by **${COMPANY}** (sole proprietor of **${TRADE}**), GSTIN **${GSTIN}**, registered at:

${ADDRESS}

## What we collect

- **Order data**: name, delivery address, phone number, email, items, payment method, order ID.
- **Account data**: if you sign up — email + password hash.
- **Payment data**: handled directly by Razorpay. We never see or store your card / UPI credentials. We only receive a payment confirmation token.
- **Browsing data**: anonymous analytics (page views, session duration, device type) via Vercel Analytics and Plausible. No third-party advertising cookies.
- **Communication**: WhatsApp messages, emails, and reviews you send us.

## Why we collect it

- To fulfill your order (dispatch + Shiprocket label + courier + delivery)
- To send order confirmations and tracking via WhatsApp / SMS / email
- To handle replacements, refunds, and customer support
- To send (optional) product launch notifications via WhatsApp — you can opt out anytime by replying STOP
- To comply with Indian tax law (GST invoicing — we retain order records for 7 years as required)
- To improve the storefront (aggregate, anonymous analytics)

## Who we share it with

- **Shiprocket** — to print your shipping label and hand over to the courier
- **Razorpay** — to process payment
- **The courier partner** (Delhivery / Blue Dart / Ekart / Xpressbees / DTDC) — receives only the data they need to deliver
- **Government authorities** — only if legally compelled (court order, tax investigation)

We do **not** sell your data, share it with advertisers, or use it for retargeting on Facebook / Google / etc.

## Your rights

You can request, at any time, via WhatsApp **${WA}** or email **${EMAIL}**:

- A copy of all data we hold about you
- Correction of any incorrect data
- Deletion of your account and order history (subject to the 7-year tax-record retention requirement for completed orders)
- Opt-out of marketing notifications

## Cookies

We use only essential cookies (cart, session) plus first-party analytics. No third-party advertising cookies are set.

## Updates to this policy

We'll post any changes here with a new "Updated" date. Material changes are also notified via WhatsApp to subscribed customers.

## Contact

**${COMPANY}** · ${EMAIL} · WhatsApp ${WA}
`.trim(),
  },
  {
    slug: "terms",
    title: "Terms of Service",
    intro: `The agreement between you and ${BRAND}. Short, fair, no fine-print traps.`,
    updated: "2026-06-02",
    body: `
## Who you're buying from

When you place an order on ${DOMAIN}, you're buying from **${COMPANY}** (sole proprietor of **${TRADE}**), GSTIN **${GSTIN}**, registered at ${ADDRESS}.

## Eligibility

You must be **18 or older** (or have parental consent) to place an order. Some products are recommended for kids age 6+, but the purchase contract is with the adult who pays.

## Product information

We do our best to show accurate photos, specs, and prices. Colours may vary slightly between screen and the actual car due to lighting and rendering. Battery life, top speed, and range are typical and depend on surface and load — minor variations don't qualify as defects.

## Pricing

All prices are in **Indian Rupees (₹)** and **inclusive of GST**. We reserve the right to change prices; the price shown at checkout is the price you pay.

## Order acceptance

An order is confirmed only after payment is captured (for prepaid) or address is verified via WhatsApp (for COD). We reserve the right to cancel any order if:

- The product is unavailable (rare — we'll refund immediately)
- The price was an obvious error (e.g., ₹12 instead of ₹1,200)
- The order looks fraudulent (multiple COD attempts to the same address with no response)

## Shipping, replacement, refund

Governed by our separate [Shipping Policy](/policies/shipping), [Replacement Policy](/policies/replacement), and [Refund Policy](/policies/refund).

## Acceptable use

Don't:

- Use ${BRAND} cars in racing competitions where they may injure others or property
- Submerge them in water or modify them in ways that violate Indian electronic-product safety norms
- Re-sell our products at inflated prices on Amazon / Flipkart / OLX without a wholesale agreement (see /wholesale)

We don't take responsibility for damage caused by misuse.

## Intellectual property

All photos, copy, logos, illustrations, and code on ${DOMAIN} are owned by ${COMPANY} or licensed for our use. Don't copy, scrape, or reuse them without written permission.

## Limitation of liability

Our liability for any claim is capped at the amount you paid for the affected order. We're not liable for indirect or consequential damages (lost screen time, sibling conflict, scratched marble floors).

## Disputes

Any dispute is governed by the laws of India and exclusive jurisdiction of courts in **Bengaluru, Karnataka**. We strongly prefer resolving issues directly via WhatsApp — most issues are settled within an hour.

## Updates

We may update these terms; the version live on this page is the binding version. We'll notify subscribed customers of material changes.

## Contact

**${COMPANY}** · ${EMAIL} · WhatsApp ${WA}
`.trim(),
  },
];

export function getPolicy(slug: string): Policy | undefined {
  return POLICIES.find((p) => p.slug === slug);
}
