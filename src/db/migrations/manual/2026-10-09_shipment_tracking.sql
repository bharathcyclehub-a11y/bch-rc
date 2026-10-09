-- Shipment tracking: per-shipment tracking state, immutable courier events,
-- delivery exceptions, a sync-run log and a small settings table.
--
-- Why: until now the courier webhook and the 3-hourly poll only flipped
-- orders.status. No courier scan, scan time, delivery estimate or sync time was
-- stored, so /track could not say when the courier last moved the parcel or
-- when we last checked, and a stale estimate looked current.
--
-- Additive and idempotent: new tables + one new column on webhooks_inbound.
-- orders stays the canonical order/shipment-creation record; shipment_tracking
-- holds only what the courier tells us about a shipment after creation.
-- Plain DDL with no semicolons inside statements, so it applies with
-- scripts/apply-manual-migration.ts as well as the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS shipment_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(id),
  order_id text NOT NULL REFERENCES orders(id),
  kind text NOT NULL DEFAULT 'FORWARD',
  shiprocket_shipment_id text,
  awb_code text,
  courier_name text,
  status text NOT NULL DEFAULT 'AWAITING_AWB',
  status_label text,
  status_changed_at timestamptz,
  last_event_at timestamptz,
  last_event_activity text,
  last_event_location text,
  edd_at timestamptz,
  edd_source text,
  edd_updated_at timestamptz,
  first_edd_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  terminal_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  baseline_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  sync_locked_until timestamptz,
  last_sync_attempt_at timestamptz,
  last_sync_success_at timestamptz,
  last_sync_error text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_webhook_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_tracking_kind_check CHECK (kind IN ('FORWARD', 'RETURN', 'REPLACEMENT'))
);

CREATE UNIQUE INDEX IF NOT EXISTS shipment_tracking_awb_unique
  ON shipment_tracking (awb_code) WHERE awb_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipment_tracking_forward_unique
  ON shipment_tracking (order_id) WHERE kind = 'FORWARD';
CREATE INDEX IF NOT EXISTS shipment_tracking_due_idx
  ON shipment_tracking (active, next_sync_at);
CREATE INDEX IF NOT EXISTS shipment_tracking_order_idx
  ON shipment_tracking (order_id);

-- Immutable: rows are only ever INSERTed (ON CONFLICT DO NOTHING on the
-- fingerprint). event_at is the courier's own scan time, never our clock.
CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id uuid NOT NULL REFERENCES shipment_tracking(id),
  order_id text NOT NULL REFERENCES orders(id),
  awb_code text,
  source text NOT NULL,
  event_at timestamptz NOT NULL,
  status text NOT NULL,
  carrier_status_code text,
  carrier_status_label text,
  activity text,
  location text,
  fingerprint text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipment_tracking_events_fingerprint_unique
  ON shipment_tracking_events (tracking_id, fingerprint);
CREATE INDEX IF NOT EXISTS shipment_tracking_events_time_idx
  ON shipment_tracking_events (tracking_id, event_at);

-- One OPEN/ACKNOWLEDGED exception per (shipment, type). A resolved exception
-- frees the slot so a recurrence opens a fresh row.
CREATE TABLE IF NOT EXISTS delivery_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(id),
  order_id text NOT NULL REFERENCES orders(id),
  tracking_id uuid REFERENCES shipment_tracking(id),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  severity text NOT NULL DEFAULT 'MEDIUM',
  detail text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  escalated_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text,
  resolution text,
  ticket_id uuid,
  customer_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_exceptions_status_check CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  CONSTRAINT delivery_exceptions_severity_check CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_exceptions_open_unique
  ON delivery_exceptions (order_id, type, (COALESCE(tracking_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS delivery_exceptions_status_idx
  ON delivery_exceptions (status, opened_at);

CREATE TABLE IF NOT EXISTS tracking_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  claimed integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  changed integer NOT NULL DEFAULT 0,
  webhooks_retried integer NOT NULL DEFAULT 0,
  skipped_reason text,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS tracking_sync_runs_started_idx
  ON tracking_sync_runs (started_at);

-- Admin-editable configuration (tracking intervals, thresholds, support
-- policy) plus small operational state such as the courier-API circuit breaker.
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Dead-letter retry for courier webhooks whose processing failed.
ALTER TABLE webhooks_inbound ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Same model as 0004/0017: RLS on + zero policies = default-deny for the
-- anon/authenticated PostgREST roles. Server-side Drizzle is unaffected.
ALTER TABLE shipment_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
