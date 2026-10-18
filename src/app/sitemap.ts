import type { MetadataRoute } from "next";
import { PRIMARY_CATEGORIES, getAllIndexableSkus } from "@/lib/categories";
import { getOverrideMap } from "@/lib/product-overrides";
import { BUYING_GUIDES } from "@/lib/guides";
import { POLICIES } from "@/lib/policies";

const BASE = "https://pocketrccars.com";
const CATALOG_LAST_MODIFIED = new Date("2026-10-16T00:00:00.000Z");

function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 2000): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const overridesMap = await withTimeout(getOverrideMap(), new Map());
  const indexableSkus = getAllIndexableSkus(overridesMap);

  const staticUrls: MetadataRoute.Sitemap = [
    {
      url: `${BASE}/`,
      lastModified: CATALOG_LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE}/collections`,
      lastModified: CATALOG_LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE}/guides`,
      lastModified: CATALOG_LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${BASE}/track`,
      lastModified: CATALOG_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];

  const categoryUrls: MetadataRoute.Sitemap = PRIMARY_CATEGORIES.filter(
    (c) => c.published,
  ).map((cat) => ({
    url: `${BASE}${cat.url}`,
    lastModified: CATALOG_LAST_MODIFIED,
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  const productUrls: MetadataRoute.Sitemap = indexableSkus.map((p) => ({
    url: `${BASE}/product/${p.slug}`,
    lastModified: CATALOG_LAST_MODIFIED,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const guideUrls: MetadataRoute.Sitemap = BUYING_GUIDES.map((g) => ({
    url: `${BASE}/guides/${g.slug}`,
    lastModified: new Date(`${g.updatedDate}T00:00:00.000Z`),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const policyUrls: MetadataRoute.Sitemap = POLICIES.map((p) => ({
    url: `${BASE}/policies/${p.slug}`,
    lastModified: CATALOG_LAST_MODIFIED,
    changeFrequency: "yearly",
    priority: 0.3,
  }));

  return [
    ...staticUrls,
    ...categoryUrls,
    ...productUrls,
    ...guideUrls,
    ...policyUrls,
  ];
}
