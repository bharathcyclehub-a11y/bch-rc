-- Courier provider: which booking platform carried a shipment.
--
-- Why: orders were only ever booked through Shiprocket, so the shipment ids
-- live in Shiprocket-named columns (shiprocket_order_id, shiprocket_shipment_id).
-- Delhivery is now booked DIRECTLY as well (src/lib/couriers/delhivery.ts). A
-- Delhivery shipment has no Shiprocket ids at all — its waybill (awb_code) is
-- the whole record — so every place that tracks, labels, cancels or schedules
-- a pickup has to know which API to call.
--
-- Additive and idempotent. Every existing row is a Shiprocket shipment, which
-- is exactly what the default says. Apply BEFORE deploying the code that reads
-- the column (the app selects whole order rows). Plain DDL with no semicolons
-- inside statements, so it applies with scripts/apply-manual-migration.ts as
-- well as the Supabase SQL editor.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS courier_provider text NOT NULL DEFAULT 'shiprocket'
    CONSTRAINT orders_courier_provider_check CHECK (courier_provider IN ('shiprocket', 'delhivery'));

-- The routing engine's decision record (quotes, reason, staff override,
-- booking-attempt state), the booked provider's quote, and the billed amount
-- from the provider's invoice. All nullable — historical orders keep NULL.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS courier_routing jsonb,
  ADD COLUMN IF NOT EXISTS courier_quoted_paise integer,
  ADD COLUMN IF NOT EXISTS courier_billed_paise integer;

ALTER TABLE shipment_tracking
  ADD COLUMN IF NOT EXISTS courier_provider text NOT NULL DEFAULT 'shiprocket'
    CONSTRAINT shipment_tracking_courier_provider_check CHECK (courier_provider IN ('shiprocket', 'delhivery'));
