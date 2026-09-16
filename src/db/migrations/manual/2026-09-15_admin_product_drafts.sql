-- Admin product drafts: extends the (until now unused) products /
-- product_variants tables so the admin can CREATE products in the database.
--
-- Draft products are ADMIN-ONLY. Nothing on the storefront, cart or checkout
-- reads these tables — the live catalogue is still src/lib/products.ts plus
-- product_overrides. Publishing DB products to the storefront is a separate,
-- later change. The admin degrades gracefully until this is applied
-- ("Add product" shows a setup notice).
--
-- Additive and idempotent. Apply via the Supabase SQL editor, like
-- 2026-07-09_product_overrides.sql. RLS is already enabled on both tables
-- (0004_enable_rls.sql).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS status              text    NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS category            text,
  ADD COLUMN IF NOT EXISTS scale               text,
  ADD COLUMN IF NOT EXISTS description         text,
  ADD COLUMN IF NOT EXISTS tags                text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS track_inventory     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS created_by          text,
  ADD COLUMN IF NOT EXISTS updated_by          text;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_status_check
    CHECK (status IN ('draft', 'active', 'coming', 'hidden', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS sku           text,
  ADD COLUMN IF NOT EXISTS opening_stock integer NOT NULL DEFAULT 0 CHECK (opening_stock >= 0),
  ADD COLUMN IF NOT EXISTS status        text    NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS products_site_status_idx ON products (site_id, status);
