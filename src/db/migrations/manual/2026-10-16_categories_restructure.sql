-- =============================================================================
-- Migration: 2026-10-16_categories_restructure.sql
-- Purpose:   Phase 3 Safe Category Migration — creates `store_categories` table
--            and seeds the 4 approved primary shopping categories for PRC
--            (`mini-rc-cars`, `drift-racing`, `construction-rc`, `hobby-grade`).
-- Safety:    Idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO UPDATE`).
--            Does NOT touch SKU identities, orders, inventory, or transactions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS store_categories (
  id                  TEXT NOT NULL,
  site_id             TEXT NOT NULL REFERENCES sites(id),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  description         TEXT NOT NULL,
  seo_title           TEXT NOT NULL,
  seo_description     TEXT NOT NULL,
  seo_target_heading  TEXT NOT NULL,
  image               TEXT NOT NULL,
  display_order       INTEGER NOT NULL DEFAULT 0,
  published           BOOLEAN NOT NULL DEFAULT TRUE,
  primary_parent      TEXT,
  related_product_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  legacy_keys         TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  landing_content     JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (site_id, id),
  CONSTRAINT store_categories_site_slug_unique UNIQUE (site_id, slug)
);

CREATE INDEX IF NOT EXISTS store_categories_site_order_idx
  ON store_categories (site_id, display_order);

-- Seed the 4 approved primary shopping categories for site 'prc' (if site row exists)
INSERT INTO store_categories (
  id, site_id, name, slug, description,
  seo_title, seo_description, seo_target_heading,
  image, display_order, published, primary_parent,
  related_product_ids, legacy_keys, landing_content
)
SELECT
  v.id,
  'prc',
  v.name,
  v.slug,
  v.description,
  v.seo_title,
  v.seo_description,
  v.seo_target_heading,
  v.image,
  v.display_order,
  TRUE,
  NULL,
  v.related_product_ids,
  v.legacy_keys,
  v.landing_content::jsonb
FROM (
  VALUES
    (
      'cat-mini-rc-cars',
      'Mini RC Cars',
      'mini-rc-cars',
      'Palm-sized 1:64 die-cast pocket RC cars and 1:43 4WD gyro mini drift cars built for smooth indoor floors, desks, and living-room circuits.',
      'Mini RC Cars in India – 1:64 & 1:43 Pocket Drift & Desktop RC | Pocket RC Cars',
      'Shop 1:64 & 1:43 mini RC cars in India from ₹999 online. Die-cast metal desktop drift cars, 4WD gyro racers, Thar SUVs & monster trucks with USB-C charging and 24-hr Bangalore dispatch.',
      'Mini RC Cars in India – 1:64 & 1:43',
      '/landing/cat-crawlers.webp',
      1,
      ARRAY['pocket-bmw','pocket-porsche','pocket-thar','pocket-monster','pocket-f1-classic','skyline-gtr-43','porsche-911-rsr-43','cybertruck-camper','ferrari-drift','mini-atv','mini-bmw-m4','mini-land-rover','mini-porsche','rc-tractor','tiger-monster','toyota-trueno'],
      ARRAY['mini64','s43'],
      '{"priceFloorINR":999,"scales":["1:64","1:43"]}'
    ),
    (
      'cat-drift-racing',
      'Drift & Racing RC',
      'drift-racing',
      'High-speed 1:16 4WD drift machines with water-mist LED exhaust smoke, 1:20 touring and drift racers, and licensed-style Volkswagen Polo rally hatchbacks.',
      'RC Drift Cars & Racing Cars in India – 1:16 4WD Smoke Drift, 1:20 & Rally | Pocket RC Cars',
      'Buy RC drift cars and racing cars in India. Explore 1:16 4WD LED tail-smoke drift cars, 1:20 touring racers, and Volkswagen Polo rally RC models. Spare slick + grip tires included.',
      'RC Drift Cars & Racing Cars in India',
      '/landing/cat-drift.webp',
      2,
      ARRAY['drift-inferno','dares-azure','bmw-m4-dtm','extreme-street-drift','gtr-gt3','mercedes-amg-gt3','lamborghini-vision-gt','toyota-ae86-20','track-rover','vw-polo-95-white','vw-polo-95-blue','polo-wrc-14','skyline-gtr-43','porsche-911-rsr-43','pocket-bmw','pocket-porsche','pocket-f1-classic','mustang-gt500'],
      ARRAY['big16','s20','polo'],
      '{"priceFloorINR":899,"scales":["1:16","1:20","1:14","1:24","1:32","1:43","1:64","1:10"]}'
    ),
    (
      'cat-construction-rc',
      'Construction RC',
      'construction-rc',
      'Radio-controlled excavators, forklifts, mining dump trucks, rotating cement mixers, and articulated low-bed heavy haulers with multi-channel working booms, forks, and beds.',
      'RC Construction Vehicles in India – RC Excavator, Forklift, Dump Truck & Mixer | Pocket RC Cars',
      'Shop radio-controlled construction vehicles in India. 1:64 alloy RC excavators, forklifts, mining dump trucks, 3-car site bundles & 1:18 cement mixers and low-bed haulers.',
      'RC Construction Vehicles in India',
      '/landing/cat-construction.webp',
      3,
      ARRAY['mining-truck','rc-excavator','rc-forklift','construction-3pack','cement-mixer-truck-18','lowbed-trailer-truck-18'],
      ARRAY['construction'],
      '{"priceFloorINR":1099,"scales":["1:64","1:18"]}'
    ),
    (
      'cat-hobby-grade',
      'Hobby Grade RC',
      'hobby-grade',
      'True proportional 4WD rock crawlers, 1:12 scale trail pickups, 1:18 Baja desert trophy trucks, and 1:10 high-speed hobby-grade RC cars engineered for outdoor trails, rocks, grass, and tarmac.',
      'Hobby Grade RC Cars & Off-Road Crawlers in India – 1:10, 1:12 & 1:16 4WD | Pocket RC Cars',
      'Shop genuine hobby-grade RC cars, 4WD rock crawlers & off-road RC trucks in India. Proportional throttle & steering, metal-link suspension, Land Rover Defender, Bronco & Land Cruiser rigs.',
      'Hobby Grade RC Cars & Off-Road Vehicles',
      '/landing/cat-hobby.jpg',
      4,
      ARRAY['mustang-gt500','defender-crawler-16','ford-pickup-crawler-16','bronco-crawler-16','bronco-desert-racer-18','land-cruiser-pickup-12','defender-pickup-12','land-cruiser-flatbed-12'],
      ARRAY['hobby'],
      '{"priceFloorINR":2099,"scales":["1:10","1:12","1:16","1:18"]}'
    )
) AS v(
  id, name, slug, description, seo_title, seo_description,
  seo_target_heading, image, display_order, related_product_ids,
  legacy_keys, landing_content
)
WHERE EXISTS (SELECT 1 FROM sites WHERE id = 'prc')
ON CONFLICT (site_id, id) DO UPDATE SET
  name                = EXCLUDED.name,
  slug                = EXCLUDED.slug,
  description         = EXCLUDED.description,
  seo_title           = EXCLUDED.seo_title,
  seo_description     = EXCLUDED.seo_description,
  seo_target_heading  = EXCLUDED.seo_target_heading,
  image               = EXCLUDED.image,
  display_order       = EXCLUDED.display_order,
  published           = EXCLUDED.published,
  related_product_ids = EXCLUDED.related_product_ids,
  legacy_keys         = EXCLUDED.legacy_keys,
  landing_content     = EXCLUDED.landing_content,
  updated_at          = NOW();

-- =============================================================================
-- ROLLBACK INSTRUCTIONS (if ever needed):
--   DROP INDEX IF EXISTS store_categories_site_order_idx;
--   DROP TABLE IF EXISTS store_categories;
-- =============================================================================
