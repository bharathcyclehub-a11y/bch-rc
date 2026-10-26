import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import HubClientUi from "@/components/hub/HubClientUi";
import CollectionCatalogClient from "@/components/hub/CollectionCatalogClient";
import {
  PRIMARY_CATEGORIES,
  LEGACY_CATEGORY_REDIRECTS,
  getSkusForCategory,
  type PrimaryCategorySlug,
  type StoreCategory,
} from "@/lib/categories";
import { getOverrideMap, applyOverride, type ProductOverride } from "@/lib/product-overrides";
import { getStockMap } from "@/lib/inventory";
import { resolveProductAvailability, schemaAvailabilityUrl } from "@/lib/availability";
import { THEME } from "@/lib/theme";
import { OFFERS } from "@/lib/config";
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

  return {
    "@context": "https://schema.org",
    "@graph": [collectionPage, breadcrumbList, itemList],
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
      </main>
      <Footer />
      <HubClientUi />
    </>
  );
}
