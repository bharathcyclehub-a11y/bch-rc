/**
 * Comprehensive Automated Verification Suite & Matrix Generator:
 * Category Restructuring, Store UX, Technical SEO, Structured Data & Merchant Feed
 *
 * Run via: npx tsx scripts/verify-seo-and-categories.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ALL_SKUS } from "../src/lib/products";
import {
  PRIMARY_CATEGORIES,
  COMING_SOON_ANNOUNCEMENT,
  LEGACY_CATEGORY_REDIRECTS,
  getCategoryBySlug,
  getProductClassification,
  getPrimaryCategoryForSku,
  getSkusForCategory,
  getAllIndexableSkus,
} from "../src/lib/categories";
import {
  HUB_CATEGORIES,
  getHubCategory,
  skusForCategory,
} from "../src/lib/hub-categories";
import { BUYING_GUIDES, getBuyingGuideBySlug } from "../src/lib/guides";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log("=== Pocket RC Cars — SEO & 4-Category Verification Suite ===");

// 1. Verify 4 Approved Primary Categories
test("1. Consolidates 8 circular categories into the 4 approved primary categories", () => {
  assert.equal(PRIMARY_CATEGORIES.length, 4);
  assert.equal(HUB_CATEGORIES.length, 4);
  const slugs = PRIMARY_CATEGORIES.map((c) => c.slug);
  assert.deepEqual(slugs, [
    "mini-rc-cars",
    "drift-racing",
    "construction-rc",
    "hobby-grade",
  ]);

  assert.equal(
    PRIMARY_CATEGORIES[0].seoTargetHeading,
    "Mini RC Cars in India – 1:64 & 1:43",
  );
  assert.equal(
    PRIMARY_CATEGORIES[1].seoTargetHeading,
    "RC Drift Cars & Racing Cars in India",
  );
  assert.equal(
    PRIMARY_CATEGORIES[2].seoTargetHeading,
    "RC Construction Vehicles in India",
  );
  assert.equal(
    PRIMARY_CATEGORIES[3].seoTargetHeading,
    "Hobby Grade RC Cars & Off-Road Vehicles",
  );
});

// 2. Verify "Drone — Coming Soon" is kept outside the 4 primary shopping categories
test("2. Keeps 'Drone — Coming Soon' outside the 4 primary shopping categories with no thin category page", () => {
  assert.ok(!PRIMARY_CATEGORIES.some((c) => c.slug.includes("drone")));
  assert.equal(COMING_SOON_ANNOUNCEMENT.slug, "drone");
  assert.equal(COMING_SOON_ANNOUNCEMENT.statusLabel, "Coming Soon");
  assert.equal(LEGACY_CATEGORY_REDIRECTS["drone"], "/collections");
});

// 3. Verify View Store URLs are distinct for all 4 categories
test("3. Every category has its own distinct /collections/[slug] View Store destination", () => {
  const urls = new Set(HUB_CATEGORIES.map((c) => c.url));
  assert.equal(urls.size, 4);
  assert.ok(urls.has("/collections/mini-rc-cars"));
  assert.ok(urls.has("/collections/drift-racing"));
  assert.ok(urls.has("/collections/construction-rc"));
  assert.ok(urls.has("/collections/hobby-grade"));
});

// 4. Verify non-empty inventory across all 4 categories
test("4. Each of the 4 primary categories contains genuine, active RC products", () => {
  for (const cat of PRIMARY_CATEGORIES) {
    const skus = getSkusForCategory(cat.slug);
    assert.ok(
      skus.length >= 5,
      `Expected ${cat.slug} to have at least 5 active SKUs, got ${skus.length}`,
    );
  }
});

// 5. Verify Polo models are classified as Racing & Rally, NOT Drift
test("5. Volkswagen Polo models are classified as Racing & Rally, never falsely labeled as Drift", () => {
  const poloIds = ["vw-polo-95-white", "vw-polo-95-blue", "polo-wrc-14"];
  for (const id of poloIds) {
    const sku = ALL_SKUS.find((s) => s.id === id);
    assert.ok(sku, `Missing Polo SKU ${id}`);
    const cls = getProductClassification(sku);
    assert.ok(cls);
    assert.equal(cls.primaryCategory, "drift-racing");
    assert.equal(cls.drivingStyle, "Racing & Rally");
    assert.notEqual(cls.drivingStyle, "Drift");
  }
});

// 6. Verify 1:64 toy-grade models are never labeled Hobby-Grade
test("6. 1:64 toy-grade products are never labeled Hobby-Grade or placed in hobby-grade", () => {
  const mini64Ids = [
    "pocket-bmw",
    "pocket-porsche",
    "pocket-thar",
    "pocket-monster",
    "pocket-f1-classic",
  ];
  for (const id of mini64Ids) {
    const sku = ALL_SKUS.find((s) => s.id === id)!;
    const cls = getProductClassification(sku)!;
    assert.equal(cls.primaryCategory, "mini-rc-cars");
    assert.equal(cls.grade, "Desktop / Toy-Grade");
    assert.ok(!cls.collections.includes("hobby-grade"));
  }
});

// 7. Verify 1:64 construction vehicles are placed in construction-rc, not mini-rc-cars
test("7. 1:64 construction vehicles are placed in construction-rc by primary use, not mini-rc-cars", () => {
  const constructionIds = [
    "mining-truck",
    "rc-excavator",
    "rc-forklift",
    "construction-3pack",
    "cement-mixer-truck-18",
    "lowbed-trailer-truck-18",
  ];
  for (const id of constructionIds) {
    const sku = ALL_SKUS.find((s) => s.id === id)!;
    const cls = getProductClassification(sku)!;
    assert.equal(cls.primaryCategory, "construction-rc");
    assert.ok(!cls.collections.includes("mini-rc-cars"));
  }
});

// 8. Verify samtop-camera is excluded from all RC categories & indexable SKUs
test("8. Non-RC test item samtop-camera is excluded from categories, sitemap & feeds", () => {
  const samtop = ALL_SKUS.find((s) => s.id === "samtop-camera");
  if (samtop) {
    assert.equal(getProductClassification(samtop), null);
  }
  const indexable = getAllIndexableSkus();
  assert.ok(!indexable.some((s) => s.id === "samtop-camera"));
});

// 9. Verify legacy /hub/shop/[key] backward-compatible resolution & redirect map
test("9. Legacy 8-category keys resolve cleanly to the 4 approved categories", () => {
  assert.equal(getCategoryBySlug("mini64")?.slug, "mini-rc-cars");
  assert.equal(getCategoryBySlug("s43")?.slug, "mini-rc-cars");
  assert.equal(getCategoryBySlug("big16")?.slug, "drift-racing");
  assert.equal(getCategoryBySlug("s20")?.slug, "drift-racing");
  assert.equal(getCategoryBySlug("polo")?.slug, "drift-racing");
  assert.equal(getCategoryBySlug("construction")?.slug, "construction-rc");
  assert.equal(getCategoryBySlug("hobby")?.slug, "hobby-grade");

  assert.equal(getHubCategory("mini64")?.key, "mini-rc-cars");
  assert.equal(getHubCategory("big16")?.key, "drift-racing");
  assert.ok(skusForCategory("mini64").length > 0);
});

// 10. Verify Buying Guides are linked to primary categories and real products
test("10. Buying guides have valid primary categories, recommended products, and FAQs", () => {
  assert.equal(BUYING_GUIDES.length, 4);
  for (const g of BUYING_GUIDES) {
    assert.ok(getBuyingGuideBySlug(g.slug));
    const cat = getCategoryBySlug(g.primaryCategorySlug);
    assert.ok(cat);
    assert.ok(g.recommendedProductSlugs.length >= 3);
    assert.ok(g.faqs.length >= 1);
  }
});

// 11. Generate docs/seo-growth/PRODUCT_SEO_MATRIX.csv
test("11. Generates complete docs/seo-growth/PRODUCT_SEO_MATRIX.csv for all RC SKUs", () => {
  const outDir = path.join(process.cwd(), "docs", "seo-growth");
  fs.mkdirSync(outDir, { recursive: true });

  const headers = [
    "sku_id",
    "slug",
    "name",
    "scale",
    "primary_category",
    "primary_collection_url",
    "all_collections",
    "vehicle_type",
    "driving_style",
    "drivetrain",
    "grade",
    "brand_style",
    "colors",
    "variant_count",
    "online_price_inr",
    "cod_retail_inr",
    "mrp_inr",
    "code_hidden",
    "seo_title",
    "seo_description",
    "primary_image_alt",
  ];

  function csvCell(val: string | number | boolean): string {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const rows: string[] = [headers.join(",")];
  for (const sku of ALL_SKUS) {
    if (sku.id === "samtop-camera") continue;
    const cls = getProductClassification(sku);
    if (!cls) continue;
    const primaryCat = getPrimaryCategoryForSku(sku);
    const onlinePrice = Math.max(0, sku.retailINR - 100);

    rows.push(
      [
        sku.id,
        sku.slug,
        sku.name,
        sku.scale,
        cls.primaryCategory,
        primaryCat.url,
        cls.collections.join("|"),
        cls.vehicleType,
        cls.drivingStyle,
        cls.drivetrain,
        cls.grade,
        cls.brand,
        cls.colorNames.join("|"),
        sku.colors?.length ?? 1,
        onlinePrice,
        sku.retailINR,
        sku.mrpINR,
        Boolean(sku.hidden),
        cls.seoTitle,
        cls.seoDescription,
        cls.primaryImageAlt,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const csvPath = path.join(outDir, "PRODUCT_SEO_MATRIX.csv");
  fs.writeFileSync(csvPath, rows.join("\n") + "\n", "utf8");
  assert.ok(fs.existsSync(csvPath));
  assert.equal(rows.length, 43); // 1 header + 42 RC SKUs
});

// 12. Verify original circular image assets and scale/subtype shortcuts
test("12. Original /landing/cat-* circular images exist and all scale/subtype shortcuts match active SKUs", () => {
  const expectedImages: Record<string, string> = {
    "mini-rc-cars": "/landing/cat-crawlers.webp",
    "drift-racing": "/landing/cat-drift.webp",
    "construction-rc": "/landing/cat-construction.webp",
    "hobby-grade": "/landing/cat-hobby.jpg",
  };

  for (const cat of PRIMARY_CATEGORIES) {
    assert.equal(cat.image, expectedImages[cat.slug]);
    const fileOnDisk = path.join(process.cwd(), "public", cat.image);
    assert.ok(fs.existsSync(fileOnDisk), `Missing image asset: ${fileOnDisk}`);
    for (const heroImg of cat.heroImages) {
      const heroOnDisk = path.join(process.cwd(), "public", heroImg);
      assert.ok(fs.existsSync(heroOnDisk), `Missing category heroImage: ${heroOnDisk}`);
    }
    assert.ok(cat.shortcuts.length >= 2, `Expected shortcuts for ${cat.slug}`);

    const catSkus = getSkusForCategory(cat.slug);
    for (const sc of cat.shortcuts) {
      const u = new URL(sc.href, "https://pocketrccars.com");
      assert.equal(u.pathname, cat.url);
      const scaleParam = u.searchParams.get("scale");
      const typeParam = u.searchParams.get("type");
      assert.ok(scaleParam || typeParam, `Shortcut ${sc.href} must specify scale or type`);
      if (scaleParam) {
        const matches = catSkus.filter((s) => s.scale === scaleParam);
        assert.ok(
          matches.length > 0,
          `Shortcut ${sc.href} matched 0 active SKUs in ${cat.slug}`,
        );
      }
      if (typeParam) {
        const matches = catSkus.filter(
          (s) => getProductClassification(s)?.vehicleType === typeParam,
        );
        assert.ok(
          matches.length > 0,
          `Shortcut ${sc.href} matched 0 active SKUs in ${cat.slug}`,
        );
      }
    }
  }

  for (const g of BUYING_GUIDES) {
    const gImgOnDisk = path.join(process.cwd(), "public", g.heroImage);
    assert.ok(fs.existsSync(gImgOnDisk), `Missing guide heroImage: ${gImgOnDisk}`);
  }
});

console.log(`\nALL ${passed} SEO & CATEGORY CHECKS PASSED.`);

