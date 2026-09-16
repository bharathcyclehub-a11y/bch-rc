-- Durable Clarity aggregate history. Apply explicitly with the existing
-- scripts/apply-manual-migration.ts runner; this is not in Drizzle's journal.
-- No raw recordings, customer identity, URLs or authentication tokens are stored.
CREATE TABLE IF NOT EXISTS clarity_analytics_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  project_id text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL,
  CHECK (window_end > window_start),
  UNIQUE (site_id, project_id, window_end)
);

CREATE INDEX IF NOT EXISTS clarity_analytics_snapshots_site_window_idx
  ON clarity_analytics_snapshots (site_id, project_id, window_end DESC);

-- Durable throttling survives cold starts and blocks simultaneous collectors.
CREATE TABLE IF NOT EXISTS clarity_analytics_sync_state (
  site_id text NOT NULL REFERENCES sites(id),
  project_id text NOT NULL,
  last_attempt_at timestamptz NOT NULL,
  PRIMARY KEY (site_id, project_id)
);

ALTER TABLE public.clarity_analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clarity_analytics_sync_state ENABLE ROW LEVEL SECURITY;
-- Intentionally no anon/authenticated policies. The server's Postgres role and
-- the admin-authenticated application are the only readers/writers.
