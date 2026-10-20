import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ArrowRight,
  HelpCircle,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import HubClientUi from "@/components/hub/HubClientUi";
import CollectionCatalogClient from "@/components/hub/CollectionCatalogClient";
import {
  PRIMARY_CATEGORIES,
  LEGACY_CATEGORY_REDIRECTS,
  getCategoryBySlug,
  getSkusForCategory,
  type PrimaryCategorySlug,
  type StoreCategory,
} from "@/lib/categories";
import { getOverrideMap, applyOverride, type ProductOverride } from "@/lib/product-overrides";
import { getStockMap } from "@/lib/inventory";
import { resolveProductAvailability, schemaAvailabilityUrl } from "@/lib/availability";
import { THEME } from "@/lib/theme";
import { OFFERS } from "@/lib/config";
import { formatINR } from "@/lib/utils";
import { type Sku } from "@/lib/products";

function withSsrTimeout<T>(promise: Promise<T>, fallback: T, ms = 2500): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export function generateStaticParams() {
  return PRIMARY_CATEGORIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const direct = PRIMARY_CATEGORIES.find((c) => c.slug === slug);
  if (!direct) {
    const legacyTarget = LEGACY_CATEGORY_REDIRECTS[slug];
    if (legacyTarget) {
      return {
        title: "Redirecting…",
        robots: { index: false, follow: true },
      };
    }
    return {
      title: "Collection Not Found",
      robots: { index: false, follow: false },
    };
  }

  const canonicalUrl = `https://${THEME.domain}${direct.url}`;

  return {
    title: { absolute: direct.seoTitle },
    description: direct.seoDescription,
    alternates: {
      canonical: canonicalUrl,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: direct.seoTitle,
      description: direct.seoDescription,
      url: canonicalUrl,
      siteName: THEME.brandName,
      type: "website",
      locale: "en_IN",
      images: [
        {
          url: direct.image,
          width: 1200,
          height: 1200,
          alt: direct.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: direct.seoTitle,
      description: direct.seoDescription,
      images: [direct.image],
    },
  };
}

function buildCollectionJsonLd(
  cat: StoreCategory,
  skus: Sku[],
  stockMap: Record<string, number> | null,
  overridesMap: Record<string, import("@/lib/product-overrides").ProductOverride> | null,
) {
  const canonicalUrl = `https://${THEME.domain}${cat.url}`;

  const breadcrumbList = {
    "@type": "BreadcrumbList",
    "@id": `${canonicalUrl}#breadcrumb`,
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
        name: cat.name,
        item: canonicalUrl,
      },
    ],
  };

  const itemList = {
    "@type": "ItemList",
    "@id": `${canonicalUrl}#itemlist`,
    name: cat.seoTargetHeading,
    numberOfItems: skus.length,
    itemListElement: skus.map((sku, idx) => {
      const ov = overridesMap?.[sku.id];
      const avail = resolveProductAvailability(sku, stockMap, ov);
      const onlinePrice = Math.max(0, sku.retailINR - OFFERS.prepaidDiscountINR);
      return {
        "@type": "ListItem",
        position: idx + 1,
        url: `https://${THEME.domain}/product/${sku.slug}`,
        item: {
          "@type": "Product",
          name: sku.name,
          url: `https://${THEME.domain}/product/${sku.slug}`,
          image: `https://${THEME.domain}${sku.heroImage}`,
          sku: sku.id,
          brand: { "@type": "Brand", name: THEME.brandName },
          offers: {
            "@type": "Offer",
            priceCurrency: "INR",
            price: onlinePrice.toString(),
            availability: schemaAvailabilityUrl(avail.status),
            url: `https://${THEME.domain}/product/${sku.slug}`,
          },
        },
      };
    }),
  };

  const collectionPage = {
    "@type": "CollectionPage",
    "@id": `${canonicalUrl}#collection`,
    name: cat.seoTargetHeading,
    description: cat.seoDescription,
    url: canonicalUrl,
    isPartOf: {
      "@type": "WebSite",
      name: THEME.brandName,
      url: `https://${THEME.domain}/`,
    },
    breadcrumb: { "@id": `${canonicalUrl}#breadcrumb` },
    mainEntity: { "@id": `${canonicalUrl}#itemlist` },
  };

  const faqPage =
    cat.faqs.length > 0
      ? {
          "@type": "FAQPage",
          "@id": `${canonicalUrl}#faq`,
          mainEntity: cat.faqs.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: f.answer,
            },
          })),
        }
      : null;

  return {
    "@context": "https://schema.org",
    "@graph": faqPage
      ? [collectionPage, breadcrumbList, itemList, faqPage]
      : [collectionPage, breadcrumbList, itemList],
  };
}

export default async function CollectionSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const directCat = PRIMARY_CATEGORIES.find((c) => c.slug === slug);
  if (!directCat) {
    const legacyTarget = LEGACY_CATEGORY_REDIRECTS[slug];
    if (legacyTarget) {
      permanentRedirect(legacyTarget);
    }
    notFound();
  }

  const overridesMap = await withSsrTimeout<Record<string, ProductOverride>>(
    getOverrideMap().then((m) => Object.fromEntries(m.entries())),
    {},
  );
  const rawSkus = getSkusForCategory(directCat.slug as PrimaryCategorySlug, {
    includeHidden: false,
    overridesMap,
  }).map((s) => applyOverride(s, overridesMap[s.id]));

  const skuIds = rawSkus.flatMap((s) => [
    s.id,
    ...(s.bundleComponentSkuIds ?? []),
  ]);
  const stockMap = await withSsrTimeout(getStockMap(skuIds), null);

  const visibleSkus =
    stockMap !== null
      ? rawSkus.filter(
          (s) => resolveProductAvailability(s, stockMap, overridesMap[s.id]).purchasable,
        )
      : rawSkus;

  // Order available products first in server-rendered HTML
  const sortedSkus = [...visibleSkus].sort((a, b) => {
    const avA = resolveProductAvailability(a, stockMap, overridesMap[a.id]);
    const avB = resolveProductAvailability(b, stockMap, overridesMap[b.id]);
    if (avA.sortRank !== avB.sortRank) return avA.sortRank - avB.sortRank;
    return 0;
  });

  const relatedCategories = directCat.relatedCategorySlugs
    .map((relSlug) => getCategoryBySlug(relSlug))
    .filter((c): c is StoreCategory => Boolean(c));

  const jsonLd = buildCollectionJsonLd(
    directCat,
    sortedSkus,
    stockMap,
    overridesMap,
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <AnnouncementBar />
      <Header />
      <main className="min-h-screen bg-brand-cream text-brand-ink">
        {/* Compact Heading, Single-Row Filters & Immediate Product Grid */}
        <CollectionCatalogClient
          skus={sortedSkus}
          title={directCat.name}
          breadcrumbLabel={directCat.name}
          activeCategorySlug={directCat.slug}
          initialStockMap={stockMap}
          initialOverridesMap={overridesMap}
        />

        {/* Detailed Buyer Guide & Category Overview */}
        <section className="border-t border-brand-line bg-white py-10 sm:py-16">
          <div className="mx-auto max-w-5xl space-y-10 px-4 sm:px-6">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-widest text-brand-red">
                Collector & Buyer Guide
              </span>
              <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-3xl">
                {directCat.seoTargetHeading}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-brand-ink-soft sm:text-base">
                {directCat.description}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-brand-ink-soft sm:text-base">
                {directCat.longIntro}
              </p>

              <div className="mt-6 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-2xl border border-brand-line bg-brand-cream p-4">
                  <div className="flex items-center gap-2 font-bold text-brand-ink">
                    <Truck size={15} className="text-brand-red" />
                    24-Hour Bangalore Dispatch
                  </div>
                  <p className="mt-1 leading-relaxed text-brand-ink-soft">
                    Every in-stock RC model is tested and dispatched from our
                    Bangalore warehouse within 24 hours with live AWB tracking.
                  </p>
                </div>
                <div className="rounded-2xl border border-brand-line bg-brand-cream p-4">
                  <div className="flex items-center gap-2 font-bold text-brand-ink">
                    <ShieldCheck size={15} className="text-brand-red" />
                    7-Day Free Replacement
                  </div>
                  <p className="mt-1 leading-relaxed text-brand-ink-soft">
                    Covered by our 7-day transit and manufacturing replacement
                    guarantee across all Indian pincodes.
                  </p>
                </div>
                <div className="rounded-2xl border border-brand-line bg-brand-cream p-4">
                  <div className="flex items-center gap-2 font-bold text-brand-ink">
                    <Sparkles size={15} className="text-brand-red" />
                    Save ₹100 Online + Bundle Tiers
                  </div>
                  <p className="mt-1 leading-relaxed text-brand-ink-soft">
                    Pay via UPI or Card to save ₹100 instantly, or mix any 2+
                    cars to unlock 5% to 20% automatic bundle discounts.
                  </p>
                </div>
              </div>
            </div>

            {/* Category FAQs */}
            {directCat.faqs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-brand-red">
                  <HelpCircle size={14} />
                  Frequently Asked Questions
                </div>
                <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-3xl">
                  {directCat.name} — Common Questions
                </h2>
                <div className="mt-5 space-y-3">
                  {directCat.faqs.map((faq, idx) => (
                    <details
                      key={faq.question}
                      open={idx === 0}
                      className="group rounded-2xl border border-brand-line bg-brand-cream px-5 py-4"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold text-brand-ink sm:text-base">
                        <span>{faq.question}</span>
                        <span className="font-mono text-xs text-brand-red transition-transform group-open:rotate-90">
                          →
                        </span>
                      </summary>
                      <p className="mt-2.5 text-xs leading-relaxed text-brand-ink-soft sm:text-sm">
                        {faq.answer}
                      </p>
                    </details>
                  ))}
                </div>
              </div>
            )}

            {/* Related Collections & Buying Guides Cross-Links */}
            <div className="border-t border-brand-line pt-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-brand-ink sm:text-2xl">
                  Explore Related RC Collections
                </h2>
                <Link
                  href="/guides"
                  className="inline-flex items-center gap-1 text-xs font-bold text-brand-red hover:underline"
                >
                  Read RC Buying Guides
                  <ArrowRight size={13} />
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {relatedCategories.map((rel) => (
                  <Link
                    key={rel.slug}
                    href={rel.url}
                    className="group flex items-center gap-3.5 rounded-2xl border border-brand-line bg-brand-cream p-3.5 transition hover:border-brand-red hover:bg-white"
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-brand-line group-hover:ring-brand-red">
                      <Image
                        src={rel.image}
                        alt={rel.imageAlt}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] font-bold uppercase text-brand-red">
                        {rel.shortLabel}
                      </div>
                      <div className="truncate font-display text-sm font-extrabold uppercase text-brand-ink group-hover:text-brand-red sm:text-base">
                        {rel.name}
                      </div>
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-ink-soft">
                        From {formatINR(rel.priceFloorINR)} · View Store
                        <ArrowRight size={11} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <HubClientUi />
    </>
  );
}
