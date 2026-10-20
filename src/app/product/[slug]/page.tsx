import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PRODUCTS, type Sku } from "@/lib/products";
import {
  getOverrideForSku,
  applyOverride,
  type ProductOverride,
} from "@/lib/product-overrides";
import { getStockMap } from "@/lib/inventory";
import {
  resolveProductAvailability,
  resolveVariantAvailability,
} from "@/lib/availability";
import {
  PRIMARY_CATEGORIES,
  getAllIndexableSkus,
  getPrimaryCategoryForSku,
  getProductClassification,
} from "@/lib/categories";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PdpFloatingUi from "@/components/PdpFloatingUi";
import PDPClient from "@/components/PDPClient";
import { THEME } from "@/lib/theme";
import { OFFERS } from "@/lib/config";
import {
  getApprovedReviewsForSku,
  getReviewAggregateForSku,
  type ReviewAggregate,
} from "@/lib/reviews";

/** Single hub store: all reviews are keyed under the one site id. */
const REVIEWS_SITE_ID = "prc";

function schemaAvailabilityUrl(status: string): string {
  switch (status) {
    case "IN_STOCK":
    case "LOW_STOCK":
      return "https://schema.org/InStock";
    case "PREORDER":
      return "https://schema.org/PreOrder";
    case "COMING_SOON":
      return "https://schema.org/PreSale";
    case "DISCONTINUED":
      return "https://schema.org/Discontinued";
    case "OUT_OF_STOCK":
    default:
      return "https://schema.org/OutOfStock";
  }
}

function productJsonLd(
  sku: Sku,
  agg: ReviewAggregate,
  availabilityStatus: string,
  liveStock: Record<string, number> | null,
  override?: ProductOverride,
) {
  const url = `https://${THEME.domain}/product/${sku.slug}`;
  const primaryCat = getPrimaryCategoryForSku(sku);
  const cls = getProductClassification(sku);
  const onlinePrice = Math.max(0, sku.retailINR - OFFERS.prepaidDiscountINR);
  const images = [sku.heroImage, ...sku.altImages]
    .filter(Boolean)
    .map((p) => `https://${THEME.domain}${p}`);

  const returnPolicy = {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "IN",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 7,
    returnMethod: "https://schema.org/ReturnByMail",
    returnFees: "https://schema.org/FreeReturn",
  };

  const shippingDetails = {
    "@type": "OfferShippingDetails",
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
    shippingRate: {
      "@type": "MonetaryAmount",
      value: "0",
      currency: "INR",
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: 0,
        maxValue: 1,
        unitCode: "DAY",
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: 2,
        maxValue: 7,
        unitCode: "DAY",
      },
    },
  };

  const hasVariants = Boolean(sku.colors && sku.colors.length > 0);
  const variants = hasVariants
    ? sku.colors!.map((c) => {
        const varAvail = resolveVariantAvailability(
          sku,
          c.slug,
          liveStock,
          override,
        );
        return {
          "@type": "Product",
          "@id": `${url}#variant-${c.slug}`,
          name: `${sku.name} — ${c.name}`,
          sku: `${sku.id}-${c.slug}`,
          color: c.name,
          image: `https://${THEME.domain}${c.image}`,
          brand: { "@type": "Brand", name: THEME.brandName },
          offers: {
            "@type": "Offer",
            url: `${url}?color=${c.slug}`,
            priceCurrency: "INR",
            price: onlinePrice.toString(),
            availability: schemaAvailabilityUrl(varAvail.status),
            itemCondition: "https://schema.org/NewCondition",
            priceValidUntil: "2027-12-31",
            seller: { "@type": "Organization", name: THEME.legal.tradeName },
            hasMerchantReturnPolicy: returnPolicy,
            shippingDetails,
          },
        };
      })
    : undefined;

  const product = {
    "@type": "Product",
    "@id": `${url}#product`,
    name: sku.name,
    description: `${sku.tagline}. ${sku.bullets.join(" ")}`,
    sku: sku.id,
    mpn: sku.id,
    image: images,
    category: primaryCat.name,
    color: sku.colors?.length
      ? sku.colors.map((c) => c.name).join(" / ")
      : cls?.colorNames.join(" / "),
    brand: { "@type": "Brand", name: THEME.brandName },
    ...(hasVariants
      ? {
          inProductGroupWithID: sku.id,
          hasVariant: variants,
        }
      : {}),
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
      price: onlinePrice.toString(),
      url,
      priceSpecification: {
        "@type": "PriceSpecification",
        priceCurrency: "INR",
        price: sku.retailINR.toString(),
      },
      availability: schemaAvailabilityUrl(availabilityStatus),
      itemCondition: "https://schema.org/NewCondition",
      priceValidUntil: "2027-12-31",
      seller: { "@type": "Organization", name: THEME.legal.tradeName },
      hasMerchantReturnPolicy: returnPolicy,
      shippingDetails,
    },
  };

  const breadcrumb = {
    "@type": "BreadcrumbList",
    "@id": `${url}#crumbs`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `https://${THEME.domain}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Collections",
        item: `https://${THEME.domain}/collections`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: primaryCat.name,
        item: `https://${THEME.domain}${primaryCat.url}`,
      },
      { "@type": "ListItem", position: 4, name: sku.name, item: url },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [product, breadcrumb],
  };
}

export function generateStaticParams() {
  return getAllIndexableSkus().map((p) => ({ slug: p.slug }));
}

function withSsrTimeout<T>(promise: Promise<T>, fallback: T, ms = 2500): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const base = PRODUCTS.find((p) => p.slug === slug);
  if (!base || base.id === "samtop-camera") {
    return { title: "Not Found", robots: { index: false, follow: false } };
  }

  const override = await withSsrTimeout(
    getOverrideForSku(base.id),
    undefined,
    1500,
  );
  const sku = applyOverride(base, override);
  if (sku.hidden) {
    return { title: "Not Found", robots: { index: false, follow: false } };
  }
  if (sku.internal) {
    return {
      title: `${sku.name} | Pocket RC Cars`,
      robots: { index: false, follow: false },
    };
  }
  if (sku.comingSoon) {
    return {
      title: `${sku.name} — Coming Soon`,
      robots: { index: false, follow: true },
    };
  }

  const cls = getProductClassification(sku);
  const canonicalUrl = `https://${THEME.domain}/product/${sku.slug}`;
  const seoTitle =
    cls?.seoTitle ?? `${sku.name} (${sku.scale}) — ₹${sku.retailINR} | Pocket RC Cars`;
  const seoDescription =
    cls?.seoDescription ??
    `${sku.tagline}. ${sku.bullets[0] ?? ""} ₹${sku.retailINR} · Pan-India COD · ships 24 hrs from Bangalore.`.slice(
      0,
      158,
    );
  const primaryAlt = cls?.primaryImageAlt ?? `${sku.name} — ${sku.bodyShape}`;

  return {
    title: { absolute: seoTitle },
    description: seoDescription,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: seoTitle,
      description: seoDescription,
      url: canonicalUrl,
      siteName: THEME.brandName,
      locale: "en_IN",
      type: "website",
      images: [
        {
          url: sku.heroImage,
          width: 1200,
          height: 630,
          alt: primaryAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: seoTitle,
      description: seoDescription,
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
  if (!base || base.id === "samtop-camera") notFound();

  const siteId = REVIEWS_SITE_ID;
  const emptyAgg: ReviewAggregate = {
    count: 0,
    averageRating: 0,
    histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  const [override, agg, reviewRows, liveStock] = await Promise.all([
    withSsrTimeout(getOverrideForSku(base.id), undefined),
    withSsrTimeout(getReviewAggregateForSku(siteId, base.id), emptyAgg),
    withSsrTimeout(getApprovedReviewsForSku(siteId, base.id, 30), []),
    withSsrTimeout(
      getStockMap([base.id, ...(base.bundleComponentSkuIds ?? [])]),
      null,
    ),
  ]);

  const sku = applyOverride(base, override);
  if (sku.hidden) notFound();

  const avail = resolveProductAvailability(sku, liveStock, override);
  if (!sku.internal && liveStock !== null && !avail.purchasable) notFound();
  const primaryCat = getPrimaryCategoryForSku(sku);

  const reviews = reviewRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            productJsonLd(sku, agg, avail.status, liveStock, override),
          ).replace(/</g, "\\u003c"),
        }}
      />
      <AnnouncementBar />
      <Header />
      <main className="flex-1 bg-white">
        {/* Visible SEO Breadcrumb Bar linking back to Primary Collection */}
        <nav
          aria-label="Breadcrumb"
          className="border-b border-brand-line bg-brand-cream/60"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1.5 px-4 py-2.5 text-xs text-brand-ink-soft">
            <Link href="/" className="transition hover:text-brand-red">
              Home
            </Link>
            <ChevronRight size={12} className="text-brand-ink-soft/50" />
            <Link href="/collections" className="transition hover:text-brand-red">
              Collections
            </Link>
            <ChevronRight size={12} className="text-brand-ink-soft/50" />
            <Link
              href={primaryCat.url}
              className="font-semibold text-brand-ink transition hover:text-brand-red"
            >
              {primaryCat.name}
            </Link>
            <ChevronRight size={12} className="text-brand-ink-soft/50" />
            <span
              className="truncate font-semibold text-brand-red"
              aria-current="page"
            >
              {sku.name}
            </span>
          </div>
        </nav>

        <PDPClient
          sku={sku}
          siteId={siteId}
          reviews={reviews}
          reviewData={agg}
          initialStockMap={liveStock}
        />

        {/* Internal Cross-Links to Primary Collection, Sister Collections & Buying Guides */}
        <section className="border-t border-brand-line bg-brand-cream/50 py-8 sm:py-10">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-brand-ink sm:text-xl">
                Explore More in{" "}
                <Link
                  href={primaryCat.url}
                  className="text-brand-red hover:underline"
                >
                  {primaryCat.name}
                </Link>{" "}
                & Related Stores
              </h2>
              <Link
                href="/guides"
                className="text-xs font-bold text-brand-red hover:underline"
              >
                RC Buying Guides →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PRIMARY_CATEGORIES.map((cat) => (
                <Link
                  key={cat.slug}
                  href={cat.url}
                  className="rounded-xl border border-brand-line bg-white p-3 transition hover:border-brand-red"
                >
                  <div className="font-mono text-[10px] font-bold uppercase text-brand-red">
                    {cat.shortLabel}
                  </div>
                  <div className="mt-0.5 font-display text-sm font-extrabold uppercase text-brand-ink">
                    {cat.name}
                  </div>
                  <div className="mt-0.5 text-[11px] text-brand-ink-soft line-clamp-1">
                    {cat.seoTargetHeading}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <PdpFloatingUi />
    </>
  );
}
