/**
 * Google Merchant Center Product Feed — `/api/merchant/feed`
 *
 * Serves an official Google Merchant Center RSS 2.0 XML feed (`xmlns:g="http://base.google.com/ns/1.0"`)
 * by default, or JSON when requested with `?format=json`.
 *
 * Key compliance guarantees:
 *   1. Excludes hidden, internal, coming-soon, and non-RC test SKUs (`samtop-camera`).
 *   2. Expands multi-colour SKUs into distinct variant items linked by `g:item_group_id`.
 *   3. Synchronizes `g:availability` (`in_stock`, `out_of_stock`, `preorder`) with live
 *      PostgreSQL `inventory` and `product_overrides` tables via `resolveVariantAvailability`.
 *   4. Never invents GTINs: sets `<g:identifier_exists>no</g:identifier_exists>` when
 *      manufacturer GTIN is absent.
 *   5. Aligns `g:price` (COD retail INR) and `g:sale_price` (Prepaid online INR) with
 *      PDP pricing and JSON-LD structured data.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  getAllIndexableSkus,
  getPrimaryCategoryForSku,
  getProductClassification,
} from "@/lib/categories";
import { getOverrideMap, applyOverride, type ProductOverride } from "@/lib/product-overrides";
import { getStockMap } from "@/lib/inventory";
import {
  resolveProductAvailability,
  resolveVariantAvailability,
  type AvailabilityStatus,
} from "@/lib/availability";
import { THEME } from "@/lib/theme";
import { OFFERS } from "@/lib/config";

export const dynamic = "force-dynamic";

function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 2500): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toMerchantAvailability(status: AvailabilityStatus): string {
  switch (status) {
    case "IN_STOCK":
    case "LOW_STOCK":
      return "in_stock";
    case "PREORDER":
      return "preorder";
    case "COMING_SOON":
    case "DISCONTINUED":
    case "OUT_OF_STOCK":
    default:
      return "out_of_stock";
  }
}

export interface MerchantFeedItem {
  id: string;
  itemGroupId?: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  availability: string;
  price: string;
  salePrice: string;
  brand: string;
  condition: "new";
  color: string;
  scale: string;
  productType: string;
  googleProductCategory: string;
  identifierExists: "no";
  mpn: string;
  shippingCountry: "IN";
  shippingPrice: string;
}

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format")?.toLowerCase();

  const overridesMap = await withTimeout<Record<string, ProductOverride>>(
    getOverrideMap().then((m) => Object.fromEntries(m.entries())),
    {},
  );
  const baseSkus = getAllIndexableSkus(overridesMap).map((s) =>
    applyOverride(s, overridesMap[s.id]),
  );

  const skuIds = baseSkus.flatMap((s) => [
    s.id,
    ...(s.bundleComponentSkuIds ?? []),
  ]);
  const stockMap = await withTimeout(getStockMap(skuIds), null);

  const baseUrl = `https://${THEME.domain}`;
  const items: MerchantFeedItem[] = [];

  for (const sku of baseSkus) {
    const ov = overridesMap[sku.id];
    if (sku.hidden || sku.internal || sku.comingSoon || ov?.discontinued) {
      continue;
    }

    const primaryCat = getPrimaryCategoryForSku(sku);
    const cls = getProductClassification(sku);
    const onlinePrice = Math.max(0, sku.retailINR - OFFERS.prepaidDiscountINR);
    const basePriceStr = `${sku.retailINR}.00 INR`;
    const salePriceStr = `${onlinePrice}.00 INR`;
    const productType = `Home > Collections > ${primaryCat.name}`;
    const googleCategory =
      "Toys & Games > Toys > Remote Control Toys > Remote Control Cars & Trucks";
    const description = `${sku.tagline}. ${sku.bullets.join(" ")} Scale: ${sku.scale}. Dispatches in 24 hours from Bangalore warehouse.`;

    if (sku.colors && sku.colors.length > 0) {
      for (const c of sku.colors) {
        const varAvail = resolveVariantAvailability(sku, c.slug, stockMap, ov);
        const addImgs = (c.altImages ?? sku.altImages ?? [])
          .filter(Boolean)
          .slice(0, 5)
          .map((img) => `${baseUrl}${img}`);

        items.push({
          id: `${sku.id}-${c.slug}`,
          itemGroupId: sku.id,
          title: `${sku.name} (${sku.scale} RC) — ${c.name}`,
          description,
          link: `${baseUrl}/product/${sku.slug}?color=${encodeURIComponent(c.slug)}`,
          imageLink: `${baseUrl}${c.image || sku.heroImage}`,
          additionalImageLinks: addImgs,
          availability: toMerchantAvailability(varAvail.status),
          price: basePriceStr,
          salePrice: salePriceStr,
          brand: THEME.brandName,
          condition: "new",
          color: c.name,
          scale: sku.scale,
          productType,
          googleProductCategory: googleCategory,
          identifierExists: "no",
          mpn: `${sku.id}-${c.slug}`,
          shippingCountry: "IN",
          shippingPrice: "0.00 INR",
        });
      }
    } else {
      const prodAvail = resolveProductAvailability(sku, stockMap, ov);
      const addImgs = (sku.altImages ?? [])
        .filter(Boolean)
        .slice(0, 5)
        .map((img) => `${baseUrl}${img}`);

      items.push({
        id: sku.id,
        title: `${sku.name} (${sku.scale} RC)`,
        description,
        link: `${baseUrl}/product/${sku.slug}`,
        imageLink: `${baseUrl}${sku.heroImage}`,
        additionalImageLinks: addImgs,
        availability: toMerchantAvailability(prodAvail.status),
        price: basePriceStr,
        salePrice: salePriceStr,
        brand: THEME.brandName,
        condition: "new",
        color: cls?.colorNames[0] ?? "Standard",
        scale: sku.scale,
        productType,
        googleProductCategory: googleCategory,
        identifierExists: "no",
        mpn: sku.id,
        shippingCountry: "IN",
        shippingPrice: "0.00 INR",
      });
    }
  }

  if (format === "json") {
    return NextResponse.json(
      {
        channel: {
          title: `${THEME.brandName} — Official India Product Feed`,
          link: baseUrl,
          totalItems: items.length,
          generatedAt: new Date().toISOString(),
        },
        items,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=900, s-maxage=1800",
        },
      },
    );
  }

  const xmlItems = items
    .map((item) => {
      const additionalXml = item.additionalImageLinks
        .map(
          (u) =>
            `      <g:additional_image_link>${escapeXml(u)}</g:additional_image_link>`,
        )
        .join("\n");

      return [
        "    <item>",
        `      <g:id>${escapeXml(item.id)}</g:id>`,
        item.itemGroupId
          ? `      <g:item_group_id>${escapeXml(item.itemGroupId)}</g:item_group_id>`
          : null,
        `      <g:title>${escapeXml(item.title)}</g:title>`,
        `      <g:description>${escapeXml(item.description)}</g:description>`,
        `      <g:link>${escapeXml(item.link)}</g:link>`,
        `      <g:image_link>${escapeXml(item.imageLink)}</g:image_link>`,
        additionalXml || null,
        `      <g:availability>${escapeXml(item.availability)}</g:availability>`,
        `      <g:price>${escapeXml(item.price)}</g:price>`,
        `      <g:sale_price>${escapeXml(item.salePrice)}</g:sale_price>`,
        `      <g:brand>${escapeXml(item.brand)}</g:brand>`,
        `      <g:condition>${item.condition}</g:condition>`,
        `      <g:color>${escapeXml(item.color)}</g:color>`,
        `      <g:size>${escapeXml(item.scale)}</g:size>`,
        `      <g:product_type>${escapeXml(item.productType)}</g:product_type>`,
        `      <g:google_product_category>${escapeXml(item.googleProductCategory)}</g:google_product_category>`,
        `      <g:identifier_exists>${item.identifierExists}</g:identifier_exists>`,
        `      <g:mpn>${escapeXml(item.mpn)}</g:mpn>`,
        "      <g:shipping>",
        `        <g:country>${item.shippingCountry}</g:country>`,
        "        <g:service>Standard Bangalore Warehouse Dispatch</g:service>",
        `        <g:price>${escapeXml(item.shippingPrice)}</g:price>`,
        "      </g:shipping>",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    `    <title>${escapeXml(THEME.brandName)} — Official Google Merchant Center Product Feed</title>`,
    `    <link>${baseUrl}</link>`,
    "    <description>Official product and colour-variant feed for Pocket RC Cars India (pocketrccars.com)</description>",
    xmlItems,
    "  </channel>",
    "</rss>",
  ].join("\n");

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=1800",
    },
  });
}
