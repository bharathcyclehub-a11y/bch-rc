/**
 * Tracking integration test — the full webhook / poll / exception pipeline
 * against a REAL Postgres (the local PGlite dev database), with Shiprocket and
 * Resend replaced by an in-process fetch stub and every clock fixed.
 *
 *   npm run dev:db  (or any local Postgres)  +  npm run dev:db:setup
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres \
 *     node --import tsx --test scripts/tests/tracking.integration.test.ts
 *
 * Refuses to run against anything but localhost. Each run creates its own
 * fixture orders (random ids), so it can be re-run without a reset.
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("tracking.integration.test refuses to run against a non-local database");
}
process.env.DATABASE_URL = url;
delete process.env.DATABASE_URL_POOLED;
process.env.DATABASE_POOL_MAX = "1";
process.env.SHIPROCKET_EMAIL = "test@example.com";
process.env.SHIPROCKET_PASSWORD = "test";
process.env.SHIPROCKET_WEBHOOK_TOKEN = "hook-token";
process.env.RESEND_API_KEY = "re_test";
delete process.env.WHATSAPP_ENABLED;
delete process.env.OPS_ALERT_EMAIL;

// ---- fetch stub: Shiprocket + Resend ----------------------------------------
type Track = { status: number; body?: unknown };
const stub = {
  login: 200,
  track: new Map<string, Track>(),
  emails: [] as Array<{ to: string; subject: string; key: string | null }>,
  trackCalls: 0,
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/login")) return stub.login === 200 ? json(200, { token: "tok" }) : json(stub.login, { message: "blocked" });
  const m = u.match(/\/courier\/track\/(?:awb|shipment)\/([^/?]+)/);
  if (m) {
    stub.trackCalls++;
    const t = stub.track.get(decodeURIComponent(m[1])) ?? { status: 200, body: { tracking_data: { track_status: 0, error: "no activities" } } };
    return json(t.status, t.body ?? { message: "upstream error" });
  }
  if (u.includes("api.resend.com")) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    const h = new Headers(init?.headers);
    stub.emails.push({ to: b.to?.[0], subject: b.subject, key: h.get("Idempotency-Key") });
    return json(200, { id: randomUUID() });
  }
  throw new Error(`unexpected fetch ${u}`);
}) as typeof fetch;

/** IST wall-clock → Date. */
const ist = (s: string) => new Date(`${s.replace(" ", "T")}+05:30`);

const scan = (date: string, label: string, activity: string, location: string) => ({
  date,
  status: label.slice(0, 4),
  activity,
  location,
  "sr-status-label": label,
});
const trackBody = (awb: string, current: string, scans: unknown[], etd: string | null) => ({
  tracking_data: {
    track_status: 1,
    shipment_status: 18,
    shipment_track: [{ awb_code: awb, courier_company_name: "Delhivery Surface", current_status: current, edd: null }],
    shipment_track_activities: [...scans].reverse(),
    etd,
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: any;

async function makeOrder(opts: { status: string; awb: string; srOrderId?: string }) {
  const { db } = m.dbmod;
  const { customers, orders } = m.schema;
  const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const [c] = await db.insert(customers).values({ phone, name: "Test Buyer", email: "buyer@example.com" }).returning();
  const id = `PRC-T${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  await db.insert(orders).values({
    id,
    siteId: "prc",
    customerId: c.id,
    status: opts.status,
    items: [{ skuId: "pocket-bmw", variantSlug: null, name: "Pocket BMW", image: null, unitPriceInr: 1099, qty: 1, lineTotalInr: 1099 }],
    shippingAddress: { fullName: "Test Buyer", phone, email: "buyer@example.com", line1: "1 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560038" },
    subtotalInr: 1099,
    totalInr: 1099,
    paymentMethod: "UPI",
    paymentStatus: "CAPTURED",
    shiprocketOrderId: opts.srOrderId ?? String(Math.floor(Math.random() * 1e9)),
    shiprocketShipmentId: String(Math.floor(Math.random() * 1e9)),
    awbCode: opts.awb,
    courierName: "Delhivery Surface",
    placedAt: ist("2026-10-05 21:41:00"),
    paidAt: ist("2026-10-05 21:41:30"),
    packedAt: ist("2026-10-06 10:00:00"),
  });
  return id;
}

/** Store + process a webhook at a FIXED time (the route itself uses the real clock). */
async function hookAt(body: any, now: Date) {
  const externalId = m.webhook.webhookExternalId(body);
  const [row] = await m.dbmod.db
    .insert(m.schema.webhooksInbound)
    .values({ source: "shiprocket", externalId, payload: body, processed: false })
    .onConflictDoNothing()
    .returning();
  if (!row) return { duplicate: true };
  return m.webhook.processStoredWebhook(row.id, externalId, body, now);
}

async function postWebhook(body: unknown) {
  const res = await m.route.POST(
    new Request("http://local/api/webhooks/courier", {
      method: "POST",
      headers: { "x-api-key": "hook-token", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return res.json();
}

before(async () => {
  m = {
    dbmod: await import("../../src/db"),
    schema: await import("../../src/db/schema"),
    sync: await import("../../src/lib/tracking/sync"),
    view: await import("../../src/lib/tracking/view"),
    settings: await import("../../src/lib/settings"),
    route: await import("../../src/app/api/webhooks/courier/route"),
    webhook: await import("../../src/lib/tracking/webhook"),
    orm: await import("drizzle-orm"),
  };
  await m.settings.setSetting("tracking.circuit", { openUntil: new Date(0).toISOString(), reason: "test reset", openedAt: new Date(0).toISOString() }, "test");
  await m.settings.setSetting("tracking.config", { callSpacingMs: 0 }, "test");
  // Turn every notice on so dedup is observable.
  await m.settings.setSetting("notifications.config", { enabled: { OUT_FOR_DELIVERY: true, DELIVERY_ESTIMATE_UPDATED: true }, quietHours: null }, "test");
});

async function trackingFor(orderId: string) {
  const { db } = m.dbmod;
  const { shipmentTracking } = m.schema;
  const { eq, and } = m.orm;
  const [row] = await db.select().from(shipmentTracking).where(and(eq(shipmentTracking.orderId, orderId), eq(shipmentTracking.kind, "FORWARD")));
  return row;
}
async function count(table: any, where: any) {
  const { db } = m.dbmod;
  const { sql } = m.orm;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  return r.n as number;
}
async function openExceptions(orderId: string) {
  const { db } = m.dbmod;
  const { deliveryExceptions } = m.schema;
  const { eq, and, ne } = m.orm;
  const rows = await db.select().from(deliveryExceptions).where(and(eq(deliveryExceptions.orderId, orderId), ne(deliveryExceptions.status, "RESOLVED")));
  return rows.map((r: any) => r.type).sort();
}

describe("tracking pipeline (integration)", () => {
  const awb = `AWB${Date.now()}`;
  let orderId = "";
  const pickup = [
    scan("2026-10-06 11:02:00", "MANIFEST GENERATED", "Manifested - Manifest uploaded", "Bengaluru (Karnataka)"),
    scan("2026-10-06 17:12:00", "PICKED UP", "Shipment picked up", "Bengaluru (Karnataka)"),
  ];
  const hub = scan("2026-10-07 20:30:00", "IN TRANSIT", "Arrived at hub", "Bengaluru_Hub (Karnataka)");

  it("first poll: picked up, order SHIPPED with the courier's own time, EDD stored", async () => {
    orderId = await makeOrder({ status: "PACKED", awb });
    stub.track.set(awb, { status: 200, body: trackBody(awb, "PICKED UP", pickup, "2026-10-08 18:00:00") });
    const row0 = await m.sync.ensureForwardTracking(orderId, ist("2026-10-06 18:00:00"));
    const r = await m.sync.syncTrackingNow(row0.id, ist("2026-10-06 18:00:00"));
    assert.equal(r.ok, true);
    const row = await trackingFor(orderId);
    assert.equal(row.status, "PICKED_UP");
    assert.equal(row.lastEventAt.toISOString(), ist("2026-10-06 17:12:00").toISOString());
    assert.equal(row.eddAt.toISOString(), ist("2026-10-08 18:00:00").toISOString());
    const { db } = m.dbmod;
    const { orders } = m.schema;
    const [o] = await db.select().from(orders).where(m.orm.eq(orders.id, orderId));
    assert.equal(o.status, "SHIPPED");
    assert.equal(o.shippedAt.toISOString(), ist("2026-10-06 17:12:00").toISOString());
  });

  it("Scenario D: the same webhook three times → one inbound row, one new event", async () => {
    const body = { awb, current_status: "IN TRANSIT", current_status_id: 18, current_timestamp: "07 10 2026 20:30:00", etd: "2026-10-08 18:00:00", scans: [...pickup, hub], courier_name: "Delhivery Surface", order_id: "123", channel_order_id: orderId };
    const first = await postWebhook(body);
    const second = await postWebhook(body);
    const third = await postWebhook(body);
    assert.equal(first.matched, true);
    assert.equal(second.duplicate, true);
    assert.equal(third.duplicate, true);
    const row = await trackingFor(orderId);
    const { shipmentTrackingEvents } = m.schema;
    assert.equal(await count(shipmentTrackingEvents, m.orm.eq(shipmentTrackingEvents.trackingId, row.id)), 3);
    assert.equal(row.status, "IN_TRANSIT");
  });

  it("Scenario A+B: on 9 Oct with no new scan, the 7 Oct event stands, the check time moves, the expired estimate opens exceptions and notifies once", async () => {
    stub.track.set(awb, { status: 200, body: trackBody(awb, "IN TRANSIT", [...pickup, hub], "2026-10-08 18:00:00") });
    const before = stub.emails.length;
    const r1 = await m.sync.runTrackingSync({ trigger: "CRON", now: ist("2026-10-09 11:20:00"), limit: 500 });
    assert.equal(r1.failed, 0, JSON.stringify(r1));
    const row = await trackingFor(orderId);
    assert.equal(row.lastEventAt.toISOString(), ist("2026-10-07 20:30:00").toISOString(), "no fabricated event");
    assert.equal(row.lastSyncSuccessAt.toISOString(), ist("2026-10-09 11:20:00").toISOString());
    assert.deepEqual(await openExceptions(orderId), ["EDD_EXPIRED", "NO_MOVEMENT"]);

    const v = await m.view.getPublicTrackingView(orderId, ist("2026-10-09 11:20:00"));
    assert.equal(v.facts.estimate.state, "EXPIRED");
    assert.equal(v.facts.estimate.date, null);
    assert.equal(v.delay.headline, "Delivery delayed — updated estimate pending.");
    assert.equal(v.facts.lastCourierUpdateAt, ist("2026-10-07 20:30:00").toISOString());

    // One outbox row per logical event (the inline send is fire-and-forget,
    // so the outbox — not the stub's inbox — is the deterministic check).
    void before;
    const { notificationsOutbox } = m.schema;
    const key = m.orm.eq(notificationsOutbox.dedupKey, `notice:${orderId}:DELAYED:2026-10-08:email`);
    assert.equal(await count(notificationsOutbox, key), 1, "one delay notice queued");
    // A second run the same day must not queue another.
    await m.sync.runTrackingSync({ trigger: "CRON", now: ist("2026-10-09 12:40:00"), limit: 500 });
    assert.equal(await count(notificationsOutbox, key), 1);
    const [n] = await m.dbmod.db.select().from(notificationsOutbox).where(key);
    assert.match(n.payload.subject, /running late/);
  });

  it("Scenario C: the courier gives 11 Oct → stored with an audit row, delay cleared", async () => {
    const moved = scan("2026-10-09 15:00:00", "IN TRANSIT", "Departed hub", "Bengaluru_Hub (Karnataka)");
    stub.track.set(awb, { status: 200, body: trackBody(awb, "IN TRANSIT", [...pickup, hub, moved], "2026-10-11 18:00:00") });
    const row0 = await trackingFor(orderId);
    const r = await m.sync.syncTrackingNow(row0.id, ist("2026-10-09 16:00:00"));
    assert.equal(r.ok, true);
    const row = await trackingFor(orderId);
    assert.equal(row.eddAt.toISOString(), ist("2026-10-11 18:00:00").toISOString());
    assert.equal(row.firstEddAt.toISOString(), ist("2026-10-08 18:00:00").toISOString(), "previous estimate kept for audit");
    const { events } = m.schema;
    assert.ok((await count(events, m.orm.and(m.orm.eq(events.orderId, orderId), m.orm.eq(events.type, "TRACKING_EDD_CHANGED")))) >= 2);
    assert.deepEqual(await openExceptions(orderId), []);
    const v = await m.view.getPublicTrackingView(orderId, ist("2026-10-09 16:00:00"));
    assert.equal(v.facts.estimate.state, "COURIER");
    assert.equal(v.delay, null);
  });

  it("Scenario E: courier API down → failure recorded, last check unchanged, backoff scheduled", async () => {
    stub.track.set(awb, { status: 503 });
    const row0 = await trackingFor(orderId);
    const r = await m.sync.syncTrackingNow(row0.id, ist("2026-10-09 17:00:00"));
    assert.equal(r.ok, false);
    const row = await trackingFor(orderId);
    assert.equal(row.lastSyncSuccessAt.toISOString(), ist("2026-10-09 16:00:00").toISOString(), "never marked as freshly checked");
    assert.equal(row.consecutiveFailures, 1);
    assert.match(row.lastSyncError, /503/);
    assert.ok(row.nextSyncAt > ist("2026-10-09 17:05:00"), "backed off");
    // Hours later, with no webhook either, the page discloses that tracking
    // is stale; the last verified status is kept.
    await m.dbmod.db.update(m.schema.shipmentTracking).set({ lastWebhookAt: null }).where(m.orm.eq(m.schema.shipmentTracking.id, row.id));
    const v = await m.view.getPublicTrackingView(orderId, ist("2026-10-10 02:00:00"));
    assert.equal(v.sync.healthy, false);
    assert.equal(v.facts.currentStatus, "In transit");
  });

  it("a courier refusal (403 at login) opens the circuit and stops further calls", async () => {
    m.dbmod; // keep reference
    const { invalidateShiprocketToken } = await import("../../src/lib/shiprocket");
    invalidateShiprocketToken();
    stub.login = 403;
    const row0 = await trackingFor(orderId);
    await m.dbmod.db.update(m.schema.shipmentTracking).set({ nextSyncAt: ist("2026-10-09 18:00:00"), syncLockedUntil: null }).where(m.orm.eq(m.schema.shipmentTracking.id, row0.id));
    const s1 = await m.sync.runTrackingSync({ trigger: "CRON", now: ist("2026-10-09 18:00:00"), limit: 5 });
    assert.match(s1.skippedReason ?? "", /refused/);
    const calls = stub.trackCalls;
    const s2 = await m.sync.runTrackingSync({ trigger: "CRON", now: ist("2026-10-09 18:15:00") });
    assert.match(s2.skippedReason ?? "", /circuit open/);
    assert.equal(stub.trackCalls, calls, "no courier calls while the circuit is open");
    stub.login = 200;
    await m.settings.setSetting("tracking.circuit", { openUntil: new Date(0).toISOString(), reason: "test reset", openedAt: new Date(0).toISOString() }, "test");
  });

  it("delivered, then a late older webhook: stays delivered, DELIVERED email once", async () => {
    const delivered = { awb, current_status: "DELIVERED", current_status_id: 7, current_timestamp: "10 10 2026 13:05:00", delivered_date: "2026-10-10 13:05:00", scans: [scan("2026-10-10 13:05:00", "DELIVERED", "Delivered to consignee", "Bengaluru (Karnataka)")], channel_order_id: orderId };
    await hookAt(delivered, ist("2026-10-10 13:10:00"));
    const late = { awb, current_status: "IN TRANSIT", current_status_id: 18, current_timestamp: "08 10 2026 09:00:00", scans: [scan("2026-10-08 09:00:00", "IN TRANSIT", "In transit", "Hosur (Tamil Nadu)")], channel_order_id: orderId };
    await hookAt(late, ist("2026-10-10 13:20:00"));
    const row = await trackingFor(orderId);
    assert.equal(row.status, "DELIVERED");
    assert.equal(row.deliveredAt.toISOString(), ist("2026-10-10 13:05:00").toISOString());
    const [o] = await m.dbmod.db.select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, orderId));
    assert.equal(o.status, "DELIVERED");
    const { notificationsOutbox } = m.schema;
    assert.equal(await count(notificationsOutbox, m.orm.eq(notificationsOutbox.dedupKey, `${orderId}:DELIVERED:email`)), 1);
  });

  it("re-ship via Shiprocket clone: the cancelled order's new AWB is followed and flagged, the old AWB's late cancel can't override it", async () => {
    const oldAwb = `OLD${Date.now()}`;
    const newAwb = `NEW${Date.now()}`;
    const id = await makeOrder({ status: "CANCELLED", awb: oldAwb });
    await hookAt({ awb: newAwb, current_status: "PICKED UP", current_timestamp: "08 10 2026 13:36:00", order_id: `${id}-C`, scans: [scan("2026-10-08 13:36:00", "PICKED UP", "Shipment picked up", "Bengaluru (Karnataka)")] }, ist("2026-10-08 13:40:00"));
    await hookAt({ awb: oldAwb, current_status: "CANCELED", current_timestamp: "09 10 2026 11:52:00", order_id: id, scans: [] }, ist("2026-10-09 11:55:00"));
    const row = await trackingFor(id);
    assert.equal(row.awbCode, newAwb);
    assert.equal(row.status, "PICKED_UP");
    assert.ok((await openExceptions(id)).includes("ORDER_MISMATCH"));
    const [o] = await m.dbmod.db.select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, id));
    assert.equal(o.status, "CANCELLED", "tracking never reopens or rewrites a cancelled order by itself");
  });
});
