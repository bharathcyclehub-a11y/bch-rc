-- Inventory UX & Restock Subscriptions (2026-10-16)
-- Extends product_overrides with availability status and merchandising fields,
-- and creates restock_subscriptions for opt-in back-in-stock alerts.
-- Safe to run more than once (idempotent).

-- 1. Extend product_overrides with availability & merchandising columns
ALTER TABLE public.product_overrides
  ADD COLUMN IF NOT EXISTS discontinued        boolean,
  ADD COLUMN IF NOT EXISTS preorder            boolean,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer,
  ADD COLUMN IF NOT EXISTS featured            boolean,
  ADD COLUMN IF NOT EXISTS alternatives        text[];

-- 2. Create restock_subscriptions table
CREATE TABLE IF NOT EXISTS public.restock_subscriptions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           text        NOT NULL REFERENCES public.sites(id),
  sku_id            text        NOT NULL,
  variant_slug      text        NOT NULL DEFAULT '',
  channel           text        NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  contact           text        NOT NULL,
  consent           boolean     NOT NULL DEFAULT true,
  status            text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'NOTIFIED', 'UNSUBSCRIBED')),
  unsubscribe_token text        NOT NULL,
  notified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restock_sub_unique UNIQUE (site_id, sku_id, variant_slug, channel, contact)
);

CREATE INDEX IF NOT EXISTS restock_sub_sku_status_idx
  ON public.restock_subscriptions (site_id, sku_id, variant_slug, status);

CREATE INDEX IF NOT EXISTS restock_sub_token_idx
  ON public.restock_subscriptions (unsubscribe_token);

-- Enable RLS with no anon/authenticated policies (direct Postgres connection only)
ALTER TABLE public.restock_subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (run manually if reverting this release):
--
-- DROP INDEX IF EXISTS public.restock_sub_token_idx;
-- DROP INDEX IF EXISTS public.restock_sub_sku_status_idx;
-- DROP TABLE IF EXISTS public.restock_subscriptions;
--
-- ALTER TABLE public.product_overrides
--   DROP COLUMN IF EXISTS alternatives,
--   DROP COLUMN IF EXISTS featured,
--   DROP COLUMN IF EXISTS low_stock_threshold,
--   DROP COLUMN IF EXISTS preorder,
--   DROP COLUMN IF EXISTS discontinued;
-- ============================================================================
