# Couriers: Shiprocket + Delhivery direct

Status: built on branch `feat/delhivery-courier`, **not deployed**. Delhivery booking ships
**disabled** and routing runs in **shadow** mode: it records a recommendation and books exactly as
before (Shiprocket). Nothing changes for live orders until the owner approves each rollout stage.

## 1. Architecture as found (main @ 96c4657, 12 Oct 2026)

| Concern | Where | Notes |
|---|---|---|
| Shiprocket client + auth | `src/lib/shiprocket.ts` | JWT from `/auth/login`, cached 9 days in memory. `ShiprocketApiError` keeps HTTP status so 401/403/429 read as "refused". |
| Shipment creation | `src/lib/fulfillment/create-shipment.ts` → `createShipment()` | Creates the Shiprocket order with `autoAssignAwb: false`: **staff pick the courier by hand** in the Shiprocket dashboard. Idempotent on an all-digit `shiprocket_order_id` + AWB. |
| AWB assignment | Shiprocket dashboard (manual); `getCheapestSurfaceCourierId` exists but is unused while auto-assign is off | AWB flows back via webhook/poll (`ingest.ts` fills `orders.awb_code`). |
| Retry / durability | `src/lib/fulfillment/shipment-queue.ts` (`shipment_jobs`) | One job per order, atomic PENDING→PROCESSING claim, exponential backoff, FAILED + one ops alert on exhaustion, hourly heal (`HEAL_COOLDOWN_MINUTES`) of finished jobs whose order has no shipment. Driven by `/api/cron/reconcile`. |
| Checkout serviceability | `src/lib/serviceability.ts` → `getShiprocketServiceability` | Hard gate at checkout; falls back to a heuristic when Shiprocket is unreachable. Unchanged by this work (Shiprocket's network is a superset of Delhivery's). |
| Shipping rate | none stored | Customer shipping fee is a pricing rule; courier cost was never recorded. |
| Pickup scheduling | `src/app/pack/actions.ts` → `schedulePickup` | Per-order button in /pack; "already scheduled" is a soft success. |
| Label / manifest / invoice | `src/app/pack/actions.ts` → `generateShippingLabel`, `generateManifest` | Short-lived PDF URLs, fetched fresh per click. Branded GST invoice is our own (`/pack/invoice`). |
| Tracking webhook | `src/app/api/webhooks/courier/route.ts` → `src/lib/tracking/webhook.ts` | Shiprocket only; `x-api-key` token; stored in `webhooks_inbound` before processing; dedup key includes courier timestamp + scan count. |
| Tracking poll | `src/lib/tracking/sync.ts` (`/api/cron/sync-shipments`, every 15 min on the VPS) | Per-row `next_sync_at`, 5-min lease, per-row backoff, store-wide circuit breaker on 401/403/429 (the Sep-2026 IP block). |
| Status model | `src/lib/tracking/status.ts`, `derive.ts`, `ingest.ts` | Every courier label → one `TrackingStatus`; raw labels kept on immutable `shipment_tracking_events` (fingerprint dedup); order status moves forward only; a courier cancel never cancels the order. |
| Exceptions / ETA honesty | `src/lib/tracking/assess.ts`, `exceptions.ts` | Expired estimate → "delayed / estimate pending", never a silently advanced date. |
| Customer notices | `src/lib/notifications/notify.ts`, `customer-notice.ts` | Dedup keys; first snapshot of a shipment is a silent baseline (no backfill emails). |
| Inventory release | `src/lib/inventory/release.ts` | Exactly-once on CANCELLED / RTO. |
| Admin controls | `/admin/orders/[id]` (Fulfillment card, `ShipButton`, `TrackingPanel` + resync), `/admin/support/exceptions`, `/admin/support/settings` | Role checks via `src/lib/admin/permissions.ts`; settings in `app_settings` (`src/lib/settings.ts`). |
| Schema | `orders` (`shiprocket_order_id`, `shiprocket_shipment_id`, `awb_code`, `courier_name`, `tracking_url`, manifest/pickup timestamps), `shipment_jobs`, `shipment_tracking`, `shipment_tracking_events`, `delivery_exceptions`, `tracking_sync_runs`, `webhooks_inbound`, `app_settings`, `events` (audit) | Manual migrations in `src/db/migrations/manual/`. |
| Env | `SHIPROCKET_EMAIL/PASSWORD/PICKUP_LOCATION/PICKUP_PINCODE/WEBHOOK_TOKEN` | Read through `envStr` / defensive parses (BOM/CRLF incidents). |

Lessons kept intact (do not regress): duplicate webhook events (fingerprints), re-ships / "-C"
clones (`repointTracking`), stale EDDs (assess), and the VPS 403 storm (circuit breaker + heal
cooldown).

## 2. What changes

Extended, not duplicated — no new shipment tables:

- `orders.courier_provider` (+ `courier_routing` jsonb decision record, `courier_quoted_paise`,
  `courier_billed_paise`) and `shipment_tracking.courier_provider`. The Shiprocket columns stay;
  they are empty on Delhivery bookings, whose waybill (`awb_code`) is the whole record.
- `src/lib/couriers/` — the provider seam:
  - `types.ts` — the common adapter interface with explicit capability flags;
  - `shiprocket.ts` — adapter over the unchanged `src/lib/shiprocket.ts`;
  - `delhivery.ts` — the Delhivery direct client + adapter;
  - `routing.ts` — pure routing engine (eligibility, comparable quotes, policy);
  - `settings.ts` — routing settings in `app_settings` (`couriers.routing`);
  - `index.ts` — registry and shared helpers.
- `create-shipment.ts` asks the routing engine, books on the chosen adapter, and keeps every
  retry rule of `shipment-queue.ts`.
- Tracking: the poll worker fetches through the row's provider; Delhivery responses are parsed
  into the same `CarrierSnapshot`, so ingest, dedup, exceptions and notices are shared. One
  circuit breaker per provider.
- `/pack` label / manifest / pickup / cancel and the admin order page call the order's provider.

## 3. Provider capabilities (what each adapter really does)

| Operation | Shiprocket | Delhivery direct | Source |
|---|---|---|---|
| Serviceability | `GET /courier/serviceability/` | `GET /c/api/pin-codes/json/` (empty list = not served, "Embargo" = paused) | live-verified 12 Oct |
| Rate quote | serviceability `rate` = freight + COD (+ other); **GST not stated** (Shiprocket's price pages say rates exclude GST) → `partial` | `GET /api/kinko/v1/invoice/charges/.json` — every charge line + GST → `full` | live-verified 12 Oct |
| Booking | create order, **no courier** (staff pick it in the dashboard; AWB later) | `POST /api/cmu/create.json` — waybill in the same response | Delhivery developer portal |
| Lookup by our order id | not used | `GET /api/v1/packages/json/?ref_ids=` (reconciles a lost booking response) | live-verified |
| Label | `POST /courier/generate/label` (PDF URL) | `GET /api/p/packing_slip?wbns=&pdf=true&pdf_size=4R` (PDF URL, one waybill per call, slow tail) | portal; unknown-waybill shape live-verified |
| Manifest | `POST /manifests/generate` | **none** — a booking is already "Manifested"; /pack says so instead of printing | portal |
| Pickup | `POST /courier/generate/pickup` per shipment | `POST /fm/request/new/` per location + day; one open request per location; "Already Exist" and "auto pickup" are soft successes | portal |
| Tracking poll | `/courier/track/awb` or `/shipment` | `/api/v1/packages/json/?waybill=` (750 req / 5 min / IP; over-limit = 403 → circuit breaker) | live-verified |
| Webhook | `/api/webhooks/courier` (x-api-key) | `/api/webhooks/delhivery` built, **not active**: Delhivery enables scan push on request (§5) | portal |
| Cancel | `POST /orders/cancel` (Shiprocket order id) | `POST /api/p/edit {waybill, cancellation:"true"}` until out for delivery. A forward cancel before pickup still reads "Manifested" — we close our tracking row ourselves | portal |

Delhivery status → our status (`delhiveryLabel` in `src/lib/tracking/carrier.ts`): UD Manifested /
Not Picked → awaiting pickup; UD In Transit → in transit; UD Pending + EOD-* (not EOD-38) → failed
delivery attempt; UD Pending otherwise → in transit; **UD Dispatched → out for delivery**; DL
Delivered → delivered; RT * → RTO in transit; DL RTO → returned to origin; LT Lost → exception.
Delhivery's raw codes and wording stay on every event.

## 4. Routing modes and settings (`/admin/settings` → Courier routing)

| Mode | What books | Delhivery API use |
|---|---|---|
| `off` | Shiprocket, exactly as before | none |
| `shadow` (**default**) | Shiprocket, exactly as before; the engine's verdict is stored on the order (`courier_routing.decision`, `hypothetical: true`) | read-only serviceability + price per order |
| `manual` | Shiprocket when the engine picks it; otherwise the order **waits for staff** (one ops alert per order, re-checked hourly, never marked failed) | read-only + bookings staff approve |
| `auto` | the engine's pick; nothing eligible → waits for staff | bookings |

`delhiveryEnabled` (default **off**) must be on for any Delhivery booking, staff overrides
included. Other settings: preferred provider (default Delhivery), fallback (other provider / staff
review), cheaper-only, max accepted rate, minimum rate confidence (default `full` — a Shiprocket
quote with GST unstated never wins a cost comparison), prepaid/COD per provider, Delhivery modes
(Surface), Shiprocket surface preference, staff-review threshold by order value, parcel (300 g,
25×18×4 cm polybag → 360 g volumetric), Delhivery pickup location name, warehouse pincode.

Never a second live shipment: a booked AWB never changes provider; staff can move only a
Shiprocket order **without an AWB**, and its Shiprocket order is cancelled first (stop if that
fails). A Delhivery booking whose response was lost is looked up by order id after 10 minutes
before anything else is booked; "partially saved" refusals are treated the same way.

## 5. Delhivery setup guide

1. **API token** — Delhivery One → Settings → API Setup → copy the token (production). A staging
   token comes from the Delhivery POC and is used with `DELHIVERY_ENV=staging`.
2. **Pickup location** — Delhivery One → Settings → Pickup Locations (or the API
   `/api/backend/clientwarehouse/create/`). Register **`Allalasandra`** with the same address and
   pincode (560065) as the Shiprocket pickup location of that name. The name is matched exactly
   and **cannot be edited later**; a new location stays inactive until Delhivery activates it
   (≈24 h). Ask the POC for daily auto-pickup on it if wanted.
3. **Wallet** — keep ≥ ₹500. At ₹0 Delhivery refuses bookings ("insufficient balance… might have
   been partially saved"); the app reconciles, then falls back to Shiprocket.
4. **Environment** (server only — never `NEXT_PUBLIC_*`):

   | Variable | Needed | Notes |
   |---|---|---|
   | `DELHIVERY_API_TOKEN` | yes | without it Delhivery is "not configured" and never called |
   | `DELHIVERY_PICKUP_LOCATION` | yes, unless set in admin settings | exact registered name |
   | `DELHIVERY_ENV` | no | `staging` → staging-express.delhivery.com |
   | `DELHIVERY_WEBHOOK_TOKEN` | only for scan push | random 32+ characters |
   | `DELHIVERY_CLIENT_NAME` | no | reference only; the API identifies us by token |

   On the VPS every deploy rewrites `/var/www/bch-rc/shared/.env` from the GitHub secret
   `PRODUCTION_ENV`, so add the variables **to that secret first**, then deploy.
5. **Scan push (optional)** — fill Delhivery's Scan Push requirement doc (developer portal) with
   endpoint `https://pocketrccars.com/api/webhooks/delhivery` and header
   `x-api-key: <DELHIVERY_WEBHOOK_TOKEN>`, email it to lastmile-integration@delhivery.com with the
   POC in copy (4–6 working days). Polling stays on as reconciliation.

## 6. Shiprocket courier preference (account settings — owner action)

Shiprocket has **no "surface only" switch**. Every Shiprocket order is created without a courier
and staff pick one by hand, so account rules only matter for auto-assignment and for which options
staff see. The documented levers:

- Settings → Courier Management → **Courier Priority**: Recommended / Fastest / **Cheapest** /
  Best rated / Custom order.
- Settings → Courier → **Courier Rules** → Add New Rule: by payment mode, weight, zone, value,
  pincode…; couriers can be marked *restricted*. Rules can't be edited later, only toggled.
- Settings → Courier → **Courier Selection**: deactivate couriers (e.g. Blue Dart Air,
  Xpressbees Air).

Caution: on some lanes air is the only option (Chennai 600001 COD offered only Blue Dart Air on
12 Oct). Deactivating air couriers can leave such pincodes with **no** Shiprocket courier — check
those lanes first. Where Delhivery direct serves them, routing sends them there anyway.

## 7. Migration and rollback

- `src/db/migrations/manual/2026-10-12_courier_provider.sql`: additive and idempotent — adds
  `orders.courier_provider` (default `'shiprocket'`), `orders.courier_routing`,
  `orders.courier_quoted_paise`, `orders.courier_billed_paise` and
  `shipment_tracking.courier_provider`. No data is rewritten; every existing row reads
  `shiprocket`. **Apply before deploying** (the app selects whole order rows). Apply with
  `scripts/apply-manual-migration.ts` (pooled URL) or the Supabase SQL editor.
- Rollback, fastest first:
  1. `/admin/settings` → mode `off` (or Delhivery booking off): new orders book on Shiprocket at
     once; Delhivery parcels already booked keep tracking, labels and cancel.
  2. Redeploy the previous release: old code ignores the new columns. Delhivery parcels then stop
     being tracked by the app — finish them in the Delhivery dashboard.
  3. Dropping the columns is not needed and would lose the routing history.

## 8. Rollout (each stage needs the owner's go-ahead)

| Stage | Setting | Exit check |
|---|---|---|
| A Discovery | — | done: code audit, API research, live read-only checks |
| B Build + tests | code only | tests, typecheck, lint, build green |
| C Shadow | `shadow`, Delhivery off | a week of decisions on real orders, compared with what Shiprocket charged |
| D Staff-controlled | Delhivery on + staff "Book with Delhivery" per order (or `manual`) | one low-value prepaid Bangalore parcel end to end: booking, label, pickup, scans, customer email, tracking page, wallet debit vs quote |
| E Limited auto | `auto`, e.g. prepaid only or a value cap | a week without duplicate bookings, pickup misses or sync failures |
| F Broader | `auto` with COD | invoices reconciled against quotes |

### Release checklist

1. Owner approves the stage.
2. Delhivery pickup location registered and **active**; wallets funded on both platforms.
3. `DELHIVERY_API_TOKEN` and `DELHIVERY_PICKUP_LOCATION` added to the `PRODUCTION_ENV` secret.
4. Migration applied to production and verified (the five new columns exist).
5. Deploy via GitHub "Deploy to VPS" (run by bharathcyclehub-a11y); confirm the live revision.
6. `/admin/settings` → Courier routing shows "Delhivery token configured" and mode `shadow`.
7. After a day: shadow decisions on new orders; the shipping-cost report renders.
8. Stage D test parcel, then reconcile:
   `npx tsx --env-file=.env.prod scripts/verify-rzp-db-shiprocket.ts 7`.

## 9. Database cost (Supabase free plan)

- The migration is metadata-only (constant defaults, nullable columns): no table rewrite, no
  backfill; historical rows store nothing new.
- About 1 KB of routing record per booked order (≈40 KB/month at today's volume).
- Egress: list pages (`/pack`, `/cod`) read orders through `orderListColumns`
  (`src/db/order-columns.ts`), which leaves the routing record out; only the order detail page
  reads it, and the shipping report aggregates in SQL (four grouped queries, small results).
- The routing engine runs after the payment response (`after()`), never in a customer request.

## 10. Tests (12 Oct 2026, local PGlite, every courier call mocked)

- `npm test` — 110 pass (31 new in `scripts/tests/couriers.test.ts`).
- `npm run test:integration` — 34 pass (14 new in `scripts/tests/couriers.integration.test.ts`).
- `npx tsc --noEmit -p .` clean; eslint clean on every changed file; `next build` passes.

Scenario coverage: routing 1–6 and 15–18 (cheaper/dearer, not serviceable, both, only one,
neither, COD/prepaid comparability, rate cap, invalid parcel, volumetric weight); 7 auth failure;
8 booking timeout → held → adopted by order-id lookup, one create call in total; 9 concurrent
duplicate requests → one booking; 10 pickup "already exists" vs unknown location; 11 duplicate
scan push stored once; 12–14 Delhivery status mapping (distinct scans, failed attempt, lost, RTO,
"Dispatched" = out for delivery); 19 outage → Shiprocket, recovery → Delhivery; 20 staff override;
21 resync through the Delhivery adapter, a Delhivery 401 pauses only Delhivery; 22 modes off /
shadow (Shiprocket request unchanged) / auto; 23–24 first snapshot silent, one notice per real
event; 25 label link / unknown waybill. Also: refusal → Shiprocket fallback + alert;
"insufficient balance… partially saved" → nothing booked elsewhere until the lookup says not
found.

## 11. Routing examples (live read-only quotes, 12 Oct 2026)

`scripts/courier-shadow-report.ts` — origin 560065, the 300 g / 25×18×4 cm polybag (360 g
chargeable), value ₹1,499. Delhivery = its invoice-charges API (GST included); Shiprocket = its
cheapest surface option (air where no surface exists), GST not stated.

| Lane | Delhivery (zone) | Shiprocket cheapest | Verdict (default) | Gap as quoted / if Shiprocket excludes 18% GST |
|---|---|---|---|---|
| 600001 COD | ₹90.52 (B) | Blue Dart Air ₹170.64 (only option) | Delhivery | ₹80.12 / ₹110.84 |
| 600040 Prepaid | ₹43.32 (B) | India Post ₹44.84 | Delhivery | ₹1.52 / ₹9.59 |
| 560091 COD | ₹86.85 (A) | Amazon Surface ₹105.72 | Delhivery | ₹18.87 / ₹37.90 |
| 560072 Prepaid | ₹39.65 (A) | Amazon Surface ₹55.72 | Delhivery | ₹16.07 / ₹26.10 |
| 570017 COD | ₹87.58 (B) | Xpressbees Surface ₹105.72 | Delhivery | ₹18.14 / ₹37.17 |
| 641035 COD | ₹87.58 (B) | Amazon Surface ₹124.72 | Delhivery | ₹37.14 / ₹59.59 |
| 803215 COD | ₹110.82 (D2) | Xpressbees Surface ₹117.72 | Delhivery | ₹6.90 / ₹28.09 |
| 600062 COD | ₹90.52 (B) | Xpressbees Surface ₹113.72 | Delhivery | ₹23.20 / ₹43.67 |

Delhivery breakdown: freight ₹30 (A) / ₹33 (B) / ₹52 (D2) + COD ₹40 flat + ₹1.22–3.72 other
+ 12% GST; fuel and ODA ₹0. Shiprocket's `rate` = freight + COD (COD ₹48–57).

**These are quotes, not savings.** The engine reports no like-for-like saving because the
Shiprocket figures don't state GST (confidence "partial"). Two lanes are within a few rupees.
Delhivery quoted at 360 g while Shiprocket charged its 500 g minimum; if Delhivery bills a 500 g
minimum the gap narrows. The ₹950/month estimate stays a hypothesis until Stage C/D data and real
invoices (recorded per order as "billed") confirm it.

## 12. Open items / blockers

- **Pickup location**: register `Allalasandra` in Delhivery (owner action, or approve the API
  call) and wait for activation. Until `DELHIVERY_PICKUP_LOCATION` (or the setting) is set,
  shadow decisions note "pickup location not configured yet".
- **Shiprocket GST basis**: compare one Shiprocket `rate` with the actual wallet debit; once GST
  is confirmed included or excluded, Shiprocket quotes can become comparable.
- **Delhivery booking, label, pickup, cancel** follow Delhivery's portal docs; their first live
  run is the Stage D test parcel.
- **Scan push**: request it from Delhivery (§5) — optional, polling covers tracking.
- **Billed costs** are entered per order by staff from invoices; an invoice/CSV import is a
  possible follow-up.
- Production migration, env, deploy and every rollout stage need the owner's approval.

## 13. Files

New: `src/lib/couriers/{types,index,settings,routing,routing-state,health,delhivery,shiprocket}.ts`,
`src/app/api/webhooks/delhivery/route.ts`, `src/app/admin/(authed)/orders/[id]/{CourierPanel,
CourierActions,courier-actions}`, `src/app/admin/(authed)/settings/{CourierSettingsForm,
courier-actions}`, `src/app/admin/(authed)/analytics/shipping/{page,queries}`,
`src/db/order-columns.ts`, `src/db/migrations/manual/2026-10-12_courier_provider.sql`,
`scripts/courier-shadow-report.ts`, `scripts/tests/couriers{,.integration}.test.ts`.

Changed: `src/db/schema.ts`, `src/lib/fulfillment/{create-shipment,shipment-queue}.ts`,
`src/lib/tracking/{carrier,sync,ingest,webhook}.ts`, `src/lib/shiprocket.ts` (read-only courier
options call added), `src/lib/reconcile.ts`, `src/lib/admin/permissions.ts`, `src/app/pack/*`,
`src/app/cod/page.tsx`, the admin order page, settings page, exceptions page and nav, the ship
route, `scripts/verify-rzp-db-shiprocket.ts`, `package.json` (test scripts).
