import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import HubClientUi from "@/components/hub/HubClientUi";
import CollectionCatalogClient from "@/components/hub/CollectionCatalogClient";
import {
  PRIMARY_CATEGORIES,
  getAllIndexableSkus,
} from "@/lib/categories";
import { getOverrideMap, applyOverride, type ProductOverride } from "@/lib/product-overrides";
import { getStockMap } from "@/lib/inventory";
import { resolveProductAvailability, schemaAvailabilityUrl } from "@/lib/availability";
import { THEME } from "@/lib/theme";
import { OFFERS } from "@/lib/config";

function withSsrTimeout<T>(promise: Promise<T>, fallback: T, ms = 2500): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const CANONICAL_URL = `https://${THEME.domain}/collections`;

export const metadata: Metadata = {
  title: {
    absolute:
      "Shop All RC Cars in India – Mini 1:64, 1:16 Drift, Construction & Hobby Grade | Pocket RC Cars",
  },
  description:
    "Browse all 4 Pocket RC Cars collections in India: Mini RC Cars (1:64 & 1:43), Drift & Racing RC (1:16, 1:20 & Polo), Construction RC, and Hobby Grade 4WD Crawlers. Ships in 24 hrs from Bangalore.",
  alternates: {
    canonical: CANONICAL_URL,
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title:
      "Shop All RC Cars in India – Mini, Drift, Construction & Hobby Grade | Pocket RC Cars",
    description:
      "Explore Mini RC Cars (1:64 & 1:43), 1:16 & 1:20 Drift & Racing RC, RC Construction Vehicles, and 4WD Hobby Grade RC Crawlers in India.",
    url: CANONICAL_URL,
    siteName: THEME.brandName,
    type: "website",
    locale: "en_IN",
    images: [
      {
        url: "/landing/cat-crawlers.webp",
        width: 1200,
        height: 1200,
        alt: "Pocket RC Cars Store Overview — 4 RC Collections in India",
      },
    ],
  },
};

export default async function CollectionsIndexPage() {
  const overridesMap = await withSsrTimeout<Record<string, ProductOverride>>(
    getOverrideMap().then((m) => Object.fromEntries(m.entries())),
    {},
  );
  const allSkus = getAllIndexableSkus(overridesMap).map((s) =>
    applyOverride(s, overridesMap[s.id]),
  );

  const skuIds = allSkus.flatMap((s) => [
    s.id,
    ...(s.bundleComponentSkuIds ?? []),
  ]);
  const stockMap = await withSsrTimeout(getStockMap(skuIds), null);

  const visibleSkus =
    stockMap !== null
      ? allSkus.filter(
          (s) => resolveProductAvailability(s, stockMap, overridesMap[s.id]).purchasable,
        )
      : allSkus;

  const sortedSkus = [...visibleSkus].sort((a, b) => {
    const avA = resolveProductAvailability(a, stockMap, overridesMap[a.id]);
    const avB = resolveProductAvailability(b, stockMap, overridesMap[b.id]);
    if (avA.sortRank !== avB.sortRank) return avA.sortRank - avB.sortRank;
    return 0;
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${CANONICAL_URL}#collection`,
        name: "All RC Car Collections in India — Pocket RC Cars",
        description:
          "Browse all four Pocket RC Cars categories: Mini RC Cars (1:64 & 1:43), Drift & Racing RC, Construction RC, and Hobby Grade RC.",
        url: CANONICAL_URL,
        breadcrumb: { "@id": `${CANONICAL_URL}#breadcrumb` },
        hasPart: PRIMARY_CATEGORIES.map((c) => ({
          "@type": "CollectionPage",
          name: c.seoTargetHeading,
          url: `https://${THEME.domain}${c.url}`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${CANONICAL_URL}#breadcrumb`,
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
            item: CANONICAL_URL,
          },
        ],
      },
      {
        "@type": "ItemList",
        "@id": `${CANONICAL_URL}#itemlist`,
        name: "Pocket RC Cars Catalog",
        numberOfItems: sortedSkus.length,
        itemListElement: sortedSkus.map((sku, idx) => {
          const avail = resolveProductAvailability(sku, stockMap, overridesMap[sku.id]);
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
      },
    ],
  };

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
        {/* All-Products Filterable Catalog Grid (same compact layout as category pages) */}
        <CollectionCatalogClient
          skus={sortedSkus}
          title="All RC Cars"
          breadcrumbLabel="Collections"
          activeCategorySlug="all"
          initialStockMap={stockMap}
          initialOverridesMap={overridesMap}
        />

        {/* Browse by Category & Scale Shortcuts (below product grid for SEO & discovery) */}
        <section className="border-t border-brand-line bg-white py-8 sm:py-10">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <h2 className="text-center font-display text-lg font-extrabold uppercase tracking-wide text-brand-ink sm:text-xl">
              Browse RC Collections by Category
            </h2>
            <div className="mt-4 grid grid-cols-4 gap-2 sm:gap-6">
              {PRIMARY_CATEGORIES.map((cat) => (
                <div
                  key={cat.slug}
                  className="flex flex-col items-center text-center"
                >
                  <Link
                    href={cat.url}
                    className="group flex flex-col items-center text-center"
                  >
                    <span className="relative block aspect-square w-16 overflow-hidden rounded-full bg-white ring-1 ring-brand-line transition-colors duration-200 group-hover:ring-brand-red sm:w-20">
                      <Image
                        src={cat.image}
                        alt={cat.imageAlt}
                        width={256}
                        height={256}
                        sizes="(min-width: 640px) 80px, 64px"
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span className="mt-2 max-w-[6.5rem] text-[11px] font-semibold leading-tight text-brand-ink transition-colors group-hover:text-brand-red sm:max-w-none sm:text-xs">
                      {cat.name}
                    </span>
                  </Link>

                  <Link
                    href={cat.url}
                    className="mt-0.5 inline-block text-[10px] font-medium text-brand-red hover:underline sm:text-[11px]"
                  >
                    View Store
                  </Link>

                  {cat.shortcuts.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
                      {cat.shortcuts.map((s) => (
                        <Link
                          key={s.href}
                          href={s.href}
                          className="rounded-full border border-brand-line bg-brand-cream px-1.5 py-0.5 font-mono text-[9px] font-medium leading-none text-brand-ink-soft transition-colors hover:border-brand-red hover:text-brand-red sm:px-2 sm:text-[10px]"
                        >
                          {s.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <HubClientUi />
    </>
  );
}
