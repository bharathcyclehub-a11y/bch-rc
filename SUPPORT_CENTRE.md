# PRC Support Centre — operations guide

Customer self-service at `/support`, the staff desk at `/admin/support`, and the
courier-tracking engine underneath both. This file covers how it works, how to
deploy it, and how to run it day to day.

## 1. Tracking engine (`src/lib/tracking/`)

**What changed.** The courier webhook and the 3-hourly poll used to flip
`orders.status` only. No scan, scan time, delivery estimate or check time was
stored, so `/track` could not say when the courier last moved a parcel and a
passed estimate looked current. Now every courier scan is stored once, as an
immutable event, and the page shows four separate facts:

| Fact | Source | Never… |
|---|---|---|
| Last courier update | newest scan's own courier timestamp | rewritten or invented |
| Last tracking check | last successful poll or webhook | moved by a failed poll |
| Estimated delivery | courier EDD, else PRC estimate (labelled) | moved forward by us |
| Delay / exception | rules in `assess.ts` | shown without a reason |

**Tables** (`migrations/manual/2026-10-09_shipment_tracking.sql`):
`shipment_tracking` (one row per shipment — FORWARD, RETURN, REPLACEMENT),
`shipment_tracking_events` (immutable, deduplicated by fingerprint),
`delivery_exceptions`, `tracking_sync_runs`, `app_settings`.
`orders` stays the record of shipment *creation*.

**Status model** (`status.ts` has the full mapping table): AWAITING_AWB →
AWAITING_PICKUP → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED, with
DELIVERY_ATTEMPTED, DELAYED, EXCEPTION, RTO_IN_TRANSIT, RTO_DELIVERED and
CANCELLED. Shipment state is rebuilt from all events of the *current* AWB,
newest courier time first, so duplicate, late and out-of-order events can't
regress it. Order status only ever moves forward (`canTrackingMoveOrder`).

**Two behaviour changes worth knowing**
- A courier **cancellation no longer cancels the order** or releases stock. It
  opens a `SHIPMENT_CANCELLED` exception (re-ship or cancel deliberately).
  Reason: in Oct 2026 an order was re-shipped as a Shiprocket "-C" clone, the old code
  cancelled the order and dropped the clone's events, and the parcel kept
  travelling while the order said CANCELLED.
- Shiprocket clone ids (`PRC-XXXX-C`) match their base order, and the order's
  tracking follows the re-ship AWB. Events from the superseded AWB are kept as
  history only.

**Worker** (`sync.ts`), triggered every 15 min by `/api/cron/sync-shipments`:
1. creates tracking rows for in-flight orders without one,
2. retries failed webhooks (dead-letter, max 5 attempts),
3. polls only DUE shipments: 120 min awaiting pickup, 60 min moving, 30 min for
   out-for-delivery, attempts, delays and open exceptions, 180 min for RTO,
   and one final check 24 h after a final status,
4. backs off failed polls exponentially (15 min doubling, capped at 6 h, with
   jitter),
5. pauses ALL courier calls for 30 min on a 401/403/429 (circuit breaker,
   with an ops alert),
6. re-evaluates exceptions for every active shipment, even when the courier
   API is down,
7. sends one throttled store-wide alert if shipments go 12 h without a
   successful update.

Every value above is editable in **/admin/support/settings → Tracking**. Leases
(`FOR UPDATE SKIP LOCKED`) stop overlapping runs from polling the same AWB.

**Exceptions:** EDD_EXPIRED, NO_MOVEMENT (36 h), PICKUP_DELAYED (36 h),
DELIVERY_ATTEMPT_FAILED, CARRIER_DELAY, CARRIER_EXCEPTION (lost/damaged),
RTO, SYNC_FAILING (6 h), MISSING_AWB (12 h), SHIPMENT_CANCELLED,
ORDER_MISMATCH (order closed but parcel moving), CUSTOMER_REPORTED and
CARRIER_CORRECTION.
- Automatic types resolve themselves when the condition clears; the others
  need a person.
- Escalation (ops alert) happens once per exception.
- Manage them at **/admin/support/exceptions**, or per order from the
  tracking panel on the order page ("Resync now").

## 2. Customer verification (`src/lib/support/verify.ts`, `session.ts`)

An order ID plus a phone number is not enough to see an order. The customer
also enters a 6-digit code sent to the email on the order (every paid order in
the last 90 days has one).
- Codes last 10 minutes and allow 5 attempts.
- At most 3 codes per order and 8 per IP every 15 minutes.
- Only an HMAC of the code is stored, and it is never logged.

Success sets a signed httpOnly cookie for 4 hours, scoped to the customer.
Tracking by order ID alone still works, but shows delivery status only, with
no personal data.

## 3. Tickets, claims, refunds (`src/lib/support/`)

- **Priority** comes from fixed rules (`rules.ts → computePriority`), shown to
  staff as `priority_reason`:
  - CRITICAL: a possible safety hazard, or "not received" while the courier says delivered
  - HIGH: damaged, wrong or missing item; payment issue; delay past the estimate
  - MEDIUM: product faults, returns, refunds
  - LOW: spares and general enquiries
- **SLA** is counted in support hours (10:00–20:00 IST). First reply: CRITICAL
  1 h, HIGH 2 h, MEDIUM 4 h (the published promise), LOW 8 h. Editable in settings.
- **Claims:** eligibility comes from the published 7-day policy, and evidence is
  required for damage, defects and wrong or missing items.
  - A replacement can't be approved while out of stock, unless a supervisor
    overrides it with a note.
  - Recording the replacement AWB decrements stock exactly once and starts
    tracking that parcel.
- **Refunds:**
  - Support agents can only REQUEST a refund. OWNER/FINANCE approve it.
  - Razorpay refunds count as done only on `refund.processed` (verified
    webhook) or an API read-back.
  - COD bank/UPI payouts are done only when finance records the UTR.
  - Double refunds are blocked by an idempotency key, a row lock and an atomic
    claim.
  - An ambiguous Razorpay error is held as PROCESSING until someone runs
    "Check with Razorpay".
  - The order page's "Refund" button uses the same path and is now
    OWNER/FINANCE only. It refunds what Razorpay actually captured, which for
    part-prepaid COD is the confirmation fee, not the order total.
- **Roles:** Owner, Manager, Support agent, Support supervisor, Warehouse,
  Finance (`src/lib/admin/permissions.ts`). Every server action re-checks the
  role on the server. The Owner assigns roles in /admin/support/settings.

## 4. Help articles and the assistant

- **Starter articles:** "Load starter articles" in /admin/support/articles adds 10
  articles, using only facts already published on the site.
  - Product numbers (charge time, run time, range) come from the catalogue specs.
  - Articles flagged "needs verification" show customers a "being verified" note.
    Review each one and switch the flag off when it's confirmed.
- **Assistant:** `/support/chat` is an automated menu, not AI (owner decision). It
  tracks orders, finds guides and hands off to a person. With a verified session
  it creates the ticket itself, with the transcript. `assistant.ts` has the
  provider seam for adding AI, WhatsApp or voice later.

## 5. Customer notices (`src/lib/notifications/customer-notice.ts`)

Notices go through the existing outbox, so they get retries, dedup keys and
the provider idempotency key.
- **On by default:** delivery attempt failed, estimate missed, courier exception,
  ticket received / replied / resolved, claim decision, replacement shipped,
  refund started / confirmed.
- **Off by default:** out-for-delivery and courier date changes. This keeps the
  existing "two emails per order" decision; switch them on in settings.
- **Quiet hours:** 21:00–09:00 IST defer non-urgent notices to the morning.
- **Channel:** email only until WhatsApp is set up. Business-initiated WhatsApp
  messages need Meta-approved templates.

## 6. Deploy checklist

1. **Migrations**, in this order (additive and idempotent):
   ```
   npx tsx --env-file=.env.prod scripts/apply-manual-migration.ts src/db/migrations/manual/2026-10-09_shipment_tracking.sql
   npx tsx --env-file=.env.prod scripts/apply-manual-migration.ts src/db/migrations/manual/2026-10-09_support_centre.sql
   ```
2. **Env vars.**
   - `CRON_SECRET` is required. The cron route now refuses to run without it.
   - `SUPPORT_SESSION_SECRET` is optional; without it a key is derived from
     `CRON_SECRET`.
   - `RESEND_API_KEY` sends codes and notices.
   - `SUPABASE_SERVICE_ROLE_KEY` stores evidence in the private bucket
     `support-evidence`, which is created automatically.
   - `OPS_ALERT_EMAIL` is recommended, for escalations.
3. **Cron.** Redeploy with `VPS_INSTALL_CRONS=true`. The managed crontab block
   now runs sync-shipments every 15 min, and `cron.sh` allows 300 s per run.
4. **First sync without customer messages** (it builds a silent baseline):
   `curl -H "Authorization: Bearer $CRON_SECRET" "http://127.0.0.1:3000/api/cron/sync-shipments?backfill=1"`
5. **Webhooks.**
   - Shiprocket stays at `/api/webhooks/courier`, with the `x-api-key` token.
   - In Razorpay, make sure `refund.processed` and `refund.failed` are
     subscribed (`refund.created` alone no longer marks orders refunded).
6. **Staff setup.** Assign staff roles, load and review the starter articles,
   and check the settings page's "Needs an owner decision" list.

**Rollback:** redeploy the previous release. The new tables are additive, and
the old code ignores them.

## 7. Tests

```
npm test                                   # rules: tracking + support (fixed clocks)
npm run dev:db && npm run dev:db:setup     # local PGlite
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres npm run test:integration
```

The integration suites replay brief scenarios A–E against a real database:
- old scan, expired estimate, new courier ETA, duplicate webhook, courier API down
- re-ship / clone, circuit breaker
- verification, ticket access, safety escalation
- stock-checked claims, refund idempotency and confirmation

Shiprocket, Resend and Razorpay are stubbed. No live orders, refunds or
messages are created.
