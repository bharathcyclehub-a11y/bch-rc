import { notFound } from "next/navigation";
import { PRODUCTS, getVisibleProducts, type Sku } from "@/lib/products";
import { getOverrideForSku, applyOverride } from "@/lib/product-overrides";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PdpFloatingUi from "@/components/PdpFloatingUi";
import PDPClient from "@/components/PDPClient";
import { THEME } from "@/lib/theme";
import { OFFERS, TRUST } from "@/lib/config";
import {
  getApprovedReviewsForSku,
  getReviewAggregateForSku,
  type ReviewAggregate,
} from "@/lib/reviews";

/** Single hub store: all reviews are keyed under the one site id. */
const REVIEWS_SITE_ID = "prc";

/** Build a Google-readable schema.org @graph blob for a SKU.
 *  Combines Product + BreadcrumbList in one script tag — Google parses both. */
function productJsonLd(sku: Sku, agg: ReviewAggregate) {
  const url = `https://${THEME.domain}/product/${sku.slug}`;
  const images = [sku.heroImage, ...sku.altImages]
    .filter(Boolean)
    .map((p) => `https://${THEME.domain}${p}`);

  const product = {
    "@type": "Product",
    "@id": `${url}#product`,
    name: sku.name,
    description: `${sku.tagline}. ${sku.bullets.join(" ")}`,
    sku: sku.id,
    mpn: sku.id,
    image: images,
    category: "Toys & Games > Remote Control Cars",
    brand: { "@type": "Brand", name: THEME.brandName },
    // Only publish AggregateRating when real approved reviews exist — Google
    // penalizes rating markup that isn't backed by on-page reviews.
    ...(agg.count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: agg.averageRating.toString(),
            reviewCount: agg.count.toString(),
            bestRating: "5",
            worstRating: "1",
          },
        }
      : {}),
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      // Real online price = retailINR - prepaid bonus. Google was surfacing
      // the higher pre-bonus sticker (e.g. ₹1,099 instead of ₹999), so customers
      // arriving from search saw a higher number than they'd actually pay.
      // We also publish the higher sticker as priceSpecification.maxPrice so
      // Google can render both ("₹999 - ₹1,099") on rich results when COD is
      // the chosen method.
      price: Math.max(0, sku.retailINR - OFFERS.prepaidDiscountINR).toString(),
      url,
      priceSpecification: {
        "@type": "PriceSpecification",
        priceCurrency: "INR",
        price: sku.retailINR.toString(),
      },
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      priceValidUntil: "2027-12-31",
      seller: { "@type": "Organization", name: THEME.legal.tradeName },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "IN",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 7,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/FreeReturn",
      },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
        shippingRate: {
          "@type": "MonetaryAmount",
          value: "0",
          currency: "INR",
        },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
          transitTime: { "@type": "QuantitativeValue", minValue: 2, maxValue: 7, unitCode: "DAY" },
        },
      },
    },
  };

  const breadcrumb = {
    "@type": "BreadcrumbList",
    "@id": `${url}#crumbs`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `https://${THEME.domain}/` },
      { "@type": "ListItem", position: 2, name: "Shop", item: `https://${THEME.domain}/#sku` },
      { "@type": "ListItem", position: 3, name: sku.name, item: url },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [product, breadcrumb],
  };
}

export function generateStaticParams() {
  // Only prerender visible SKUs. Hidden SKUs hit notFound() at runtime if anyone
  // navigates directly to their URL.
  return getVisibleProducts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sku = PRODUCTS.find((p) => p.slug === slug);
  if (!sku || sku.hidden || sku.internal) return { title: "Not Found" };
  // Coming-soon SKUs are public hub teasers without a price yet: keep the name,
  // never a placeholder price. (No DB lookup here — metadata stays query-free.)
  if (sku.comingSoon) return { title: sku.name };

  const url = `/product/${sku.slug}`;
  const fullDescription =
    `${sku.tagline}. ${sku.bullets[0]}. ${sku.bullets[1]}. ` +
    `₹${sku.retailINR} · Pan-India COD · ships 24 hrs from Bangalore.`;

  return {
    title: `${sku.name} (${sku.scale}) — ₹${sku.retailINR}`,
    description: fullDescription.slice(0, 158),
    alternates: { canonical: url },
    openGraph: {
      title: `${sku.name} (${sku.scale}) · ₹${sku.retailINR}`,
      description: fullDescription.slice(0, 158),
      url,
      type: "website",
      images: [
        {
          url: sku.heroImage,
          width: 1200,
          height: 630,
          alt: `${sku.name} — ${sku.bodyShape}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${sku.name} (${sku.scale}) · ₹${sku.retailINR}`,
      description: fullDescription.slice(0, 158),
      images: [sku.heroImage],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const base = PRODUCTS.find((p) => p.slug === slug);
  if (!base) notFound();
  // Layer admin overrides (price / visibility / badge) over the code SKU so the
  // PDP shows exactly the price the checkout will charge.
  const sku = applyOverride(base, await getOverrideForSku(base.id));
  // 404 hidden SKUs AND internal SKUs (e.g. qa-1rs). Internal SKUs need to
  // exist in the data for admin tooling (manual orders, inventory) but must
  // not be reachable as PDPs - otherwise a stranger who guesses the slug
  // can place a ₹1 COD order that burns ₹180-240 in two-way RTO logistics.
  if (sku.hidden || sku.internal || sku.comingSoon) notFound();

  // Reviews are keyed under the single hub site. Fetch aggregate +
  // approved list on the server so the PDP ships with real ratings + JSON-LD.
  const siteId = REVIEWS_SITE_ID;
  const [agg, reviewRows] = await Promise.all([
    getReviewAggregateForSku(siteId, sku.id),
    getApprovedReviewsForSku(siteId, sku.id, 30),
  ]);
  // Serialize Date → ISO string across the server/client boundary.
  const reviews = reviewRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
      {/* schema.org Product + BreadcrumbList @graph — Google rich results,
          price in search, OpenGraph product cards on link previews.
          `<` is escaped so any future bullet/tagline containing `</script>`
          can't break out of the script tag. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productJsonLd(sku, agg)).replace(/</g, "\\u003c"),
        }}
      />
      <AnnouncementBar />
      <Header />
      <main className="flex-1 bg-white">
        <PDPClient
          sku={sku}
          siteId={siteId}
          reviews={reviews}
          reviewData={agg}
        />
      </main>
      <Footer />
      <PdpFloatingUi />
    </>
  );
}
