-- PRC Support Centre: customer verification, tickets, return/replacement
-- claims, refund cases, help articles and support staff roles.
--
-- Additive and idempotent. Orders, payments, products and inventory stay the
-- canonical records: tickets/claims/refunds reference them, never copy them.
-- Apply AFTER 2026-10-09_shipment_tracking.sql. Plain DDL with no semicolons
-- inside statements (scripts/apply-manual-migration.ts splits on them).

-- Staff roles for the support workflows (src/lib/admin/permissions.ts).
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'SUPPORT_SUPERVISOR';
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'WAREHOUSE';
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'FINANCE';

-- One-time email codes proving a guest owns an order. Only an HMAC of the
-- code is stored, never the code itself.
CREATE TABLE IF NOT EXISTS support_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL REFERENCES orders(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  channel text NOT NULL DEFAULT 'EMAIL',
  destination_masked text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_verifications_order_idx ON support_verifications (order_id, created_at);
CREATE INDEX IF NOT EXISTS support_verifications_ip_idx ON support_verifications (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  site_id text NOT NULL REFERENCES sites(id),
  customer_id uuid REFERENCES customers(id),
  order_id text REFERENCES orders(id),
  sku_id text,
  category text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'NEW',
  priority text NOT NULL DEFAULT 'MEDIUM',
  priority_reason text,
  channel text NOT NULL DEFAULT 'WEB',
  contact_name text,
  contact_email text,
  contact_phone text,
  identity_verified boolean NOT NULL DEFAULT false,
  access_token_hash text,
  safety_flag boolean NOT NULL DEFAULT false,
  assigned_to text,
  escalated_at timestamptz,
  escalation_reason text,
  awaiting text NOT NULL DEFAULT 'STAFF',
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  reopen_count integer NOT NULL DEFAULT 0,
  last_customer_message_at timestamptz,
  last_staff_message_at timestamptz,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_status_check CHECK (status IN ('NEW', 'AWAITING_CUSTOMER', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLUTION_PROPOSED', 'RESOLVED', 'CLOSED', 'REOPENED')),
  CONSTRAINT support_tickets_priority_check CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_number_unique ON support_tickets (number);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status, priority, created_at);
CREATE INDEX IF NOT EXISTS support_tickets_order_idx ON support_tickets (order_id);
CREATE INDEX IF NOT EXISTS support_tickets_customer_idx ON support_tickets (customer_id);
CREATE INDEX IF NOT EXISTS support_tickets_assigned_idx ON support_tickets (assigned_to, status);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id),
  author_type text NOT NULL,
  author_name text,
  author_email text,
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_messages_author_check CHECK (author_type IN ('CUSTOMER', 'STAFF', 'SYSTEM', 'ASSISTANT'))
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx ON support_ticket_messages (ticket_id, created_at);

-- Evidence files live in the PRIVATE Supabase Storage bucket "support-evidence"
-- and are only ever served through short-lived signed URLs.
CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id),
  message_id uuid REFERENCES support_ticket_messages(id),
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  original_name text,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_attachments_ticket_idx ON support_ticket_attachments (ticket_id);

-- Append-only audit trail of every ticket / claim / refund action.
CREATE TABLE IF NOT EXISTS support_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id),
  type text NOT NULL,
  actor text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_events_ticket_idx ON support_ticket_events (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS support_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  ticket_id uuid NOT NULL REFERENCES support_tickets(id),
  order_id text NOT NULL REFERENCES orders(id),
  customer_id uuid REFERENCES customers(id),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'SUBMITTED',
  reason text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  stock jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_by text,
  decision_at timestamptz,
  decision_note text,
  replacement_order_id text REFERENCES orders(id),
  shipment_awb text,
  stock_committed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_claims_type_check CHECK (type IN ('REPLACEMENT', 'RETURN')),
  CONSTRAINT support_claims_status_check CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'RETURN_IN_TRANSIT', 'RECEIVED', 'REPLACEMENT_SHIPPED', 'COMPLETED', 'CANCELLED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS support_claims_number_unique ON support_claims (number);
CREATE INDEX IF NOT EXISTS support_claims_status_idx ON support_claims (status, created_at);
CREATE INDEX IF NOT EXISTS support_claims_order_idx ON support_claims (order_id);

-- A refund is only PROCESSED when Razorpay confirms it (verified webhook or
-- API read-back), or — for COD bank/UPI payouts — when finance records the
-- transfer reference (method MANUAL). idempotency_key blocks double refunds.
CREATE TABLE IF NOT EXISTS refund_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL REFERENCES orders(id),
  ticket_id uuid REFERENCES support_tickets(id),
  claim_id uuid REFERENCES support_claims(id),
  amount_inr integer NOT NULL,
  reason text NOT NULL,
  method text NOT NULL DEFAULT 'RAZORPAY',
  status text NOT NULL DEFAULT 'REQUESTED',
  idempotency_key text NOT NULL,
  requested_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  razorpay_payment_id text,
  razorpay_refund_id text,
  provider_status text,
  provider_confirmed_at timestamptz,
  manual_reference text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_cases_amount_check CHECK (amount_inr > 0),
  CONSTRAINT refund_cases_method_check CHECK (method IN ('RAZORPAY', 'MANUAL')),
  CONSTRAINT refund_cases_status_check CHECK (status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REJECTED', 'CANCELLED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS refund_cases_idempotency_unique ON refund_cases (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS refund_cases_razorpay_refund_unique ON refund_cases (razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refund_cases_order_idx ON refund_cases (order_id);
CREATE INDEX IF NOT EXISTS refund_cases_status_idx ON refund_cases (status, created_at);

CREATE TABLE IF NOT EXISTS help_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  category text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  video_url text,
  sku_ids text[] NOT NULL DEFAULT '{}',
  related_slugs text[] NOT NULL DEFAULT '{}',
  difficulty text NOT NULL DEFAULT 'EASY',
  status text NOT NULL DEFAULT 'DRAFT',
  needs_verification boolean NOT NULL DEFAULT true,
  verified_by text,
  last_reviewed_at timestamptz,
  helpful_yes integer NOT NULL DEFAULT 0,
  helpful_no integer NOT NULL DEFAULT 0,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT help_articles_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT help_articles_difficulty_check CHECK (difficulty IN ('EASY', 'MEDIUM', 'ADVANCED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS help_articles_slug_unique ON help_articles (slug);
CREATE INDEX IF NOT EXISTS help_articles_status_idx ON help_articles (status, category);

ALTER TABLE support_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;
