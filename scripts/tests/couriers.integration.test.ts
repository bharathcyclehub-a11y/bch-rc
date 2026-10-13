/**
 * Courier layer integration test — routing modes, Delhivery booking with its
 * lost-response reconciliation, Shiprocket fallback, staff hold/override, and
 * Delhivery tracking (poll, resync, per-provider circuit, scan-push dedup)
 * against a REAL Postgres (the local PGlite dev database). Shiprocket,
 * Delhivery and Resend are replaced by an in-process fetch stub — no courier
 * API is ever called.
 *
 *   npm run dev:db  (or any local Postgres)  +  npm run dev:db:setup
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres \
 *     node --import tsx --test --test-concurrency=1 scripts/tests/couriers.integration.test.ts
 *
 * Refuses to run against anything but localhost. Each run creates its own
 * fixture orders (random fictional ids) and resets the routing settings and
 * circuit breakers it touched when it finishes.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("couriers.integration.test refuses to run against a non-local database");
}
process.env.DATABASE_URL = url;
delete process.env.DATABASE_URL_POOLED;
process.env.DATABASE_POOL_MAX = "1";
process.env.SHIPROCKET_EMAIL = "test@example.com";
process.env.SHIPROCKET_PASSWORD = "test";
process.env.SHIPROCKET_PICKUP_LOCATION = "Test Warehouse";
process.env.SHIPROCKET_PICKUP_PINCODE = "560043";
process.env.SHIPROCKET_WEBHOOK_TOKEN = "hook-token";
process.env.DELHIVERY_API_TOKEN = "dlv-test-token";
process.env.DELHIVERY_PICKUP_LOCATION = "Test Warehouse";
process.env.DELHIVERY_WEBHOOK_TOKEN = "dlv-hook-token";
delete process.env.DELHIVERY_ENV;
process.env.RESEND_API_KEY = "re_test";
delete process.env.WHATSAPP_ENABLED;
delete process.env.OPS_ALERT_EMAIL;

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- fetch stub: Shiprocket + Delhivery + Resend ----------------------------
type Reply = { status: number; body?: unknown };
const stub = {
  srCreates: [] as Array<{ orderId: string; body: any }>,
  srAssignCalls: 0,
  srTrack: new Map<string, Reply>(),
  srTrackCalls: 0,
  /** "down" = network failure on every Delhivery serviceability / rate call. */
  dlvLookup: "ok" as "ok" | "down",
  dlvCreate: "ok" as "ok" | "timeout" | "refuse" | "ambiguous",
  dlvCreates: [] as Array<{ orderId: string; data: any }>,
  /** What Delhivery really holds: order id → waybill. */
  dlvBooked: new Map<string, string>(),
  dlvFinds: [] as string[],
  dlvTrack: new Map<string, Reply>(),
  dlvTrackCalls: [] as string[],
  emails: [] as Array<{ to: string; subject: string }>,
};
let srSeq = 700_000_000 + Math.floor(Math.random() * 1e8);
const waybill = () => `9999${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const PARTIAL =
  "Crashing while saving package due to exception 'Prepaid client manifest charge API failed due to insufficient balance'. Package might have been partially saved.";

const srCouriers = {
  status: 200,
  data: {
    available_courier_companies: [
      { courier_company_id: 10, courier_name: "Delhivery Surface", cod: 1, rate: 95, freight_charge: 80, cod_charges: 0, other_charges: 15, is_surface: true, estimated_delivery_days: "4", charge_weight: 0.5, zone: "z_b", blocked: 0 },
      { courier_company_id: 11, courier_name: "Blue Dart Air", cod: 1, rate: 140, freight_charge: 125, cod_charges: 0, is_surface: false, estimated_delivery_days: "2", charge_weight: 0.5, zone: "z_b", blocked: 0 },
    ],
  },
};
const dlvRate = [
  { status: "Delivered", zone: "B", charge_DL: 33, charge_COD: 40, charge_DPH: 1.22, charge_LM: 2.5, gross_amount: 76.72, total_amount: 90.52, charged_weight: 500, tax_data: { SGST: 6.9, CGST: 6.9, IGST: 0 } },
];
const dlvShipment = (awb: string, orderId: string, status = "Manifested", type = "UD") => ({
  Shipment: { AWB: awb, ReferenceNo: orderId, Status: { Status: status, StatusType: type, StatusDateTime: "2026-10-10T09:00:00" }, Scans: [] },
});

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const reply = (r: Reply) => json(r.status, r.body ?? { message: "upstream error" });

  // Shiprocket
  if (u.startsWith("https://apiv2.shiprocket.in/")) {
    if (u.includes("/auth/login")) return json(200, { token: "sr-test-token" });
    if (u.includes("/courier/serviceability/")) return json(200, srCouriers);
    if (u.includes("/orders/create/adhoc")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      stub.srCreates.push({ orderId: body.order_id, body });
      srSeq += 2;
      return json(200, { order_id: srSeq, shipment_id: srSeq + 1, status: "NEW", status_code: 1, awb_code: null, courier_company_id: null, courier_name: "" });
    }
    if (u.includes("/courier/assign/awb")) {
      stub.srAssignCalls++;
      return json(500, { message: "auto-assign must stay off" });
    }
    const t = u.match(/\/courier\/track\/(?:awb|shipment)\/([^/?]+)/);
    if (t) {
      stub.srTrackCalls++;
      return reply(stub.srTrack.get(decodeURIComponent(t[1])) ?? { status: 200, body: { tracking_data: { track_status: 0, error: "no activities" } } });
    }
  }

  // Delhivery
  if (u.startsWith("https://track.delhivery.com/")) {
    const q = new URL(u).searchParams;
    if (u.includes("/c/api/pin-codes/json/")) {
      if (stub.dlvLookup === "down") throw new TypeError("fetch failed");
      const pin = q.get("filter_codes");
      return json(200, { delivery_codes: [{ postal_code: { pin: Number(pin), pre_paid: "Y", cod: "Y", remarks: "" } }] });
    }
    if (u.includes("/api/kinko/v1/invoice/charges/")) {
      if (stub.dlvLookup === "down") throw new TypeError("fetch failed");
      return json(200, dlvRate);
    }
    if (u.includes("/api/cmu/create.json")) {
      const data = JSON.parse(new URLSearchParams(String(init?.body ?? "")).get("data") ?? "{}");
      const orderId: string = data.shipments?.[0]?.order;
      stub.dlvCreates.push({ orderId, data });
      if (stub.dlvCreate === "refuse") {
        return json(200, { success: false, rmk: "ClientWarehouse matching query does not exist.", packages: [], package_count: 0 });
      }
      if (stub.dlvCreate === "ambiguous") {
        return json(200, { success: false, rmk: PARTIAL, packages: [{ status: "Fail", waybill: "", refnum: orderId, remarks: [PARTIAL] }] });
      }
      const wb = waybill();
      stub.dlvBooked.set(orderId, wb);
      if (stub.dlvCreate === "timeout") {
        // Delhivery created it, but the answer never reached us.
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
      return json(200, { success: true, upload_wbn: `UPL-${wb}`, packages: [{ waybill: wb, refnum: orderId, status: "Success", remarks: [] }] });
    }
    if (u.includes("/api/v1/packages/json/") && q.has("ref_ids")) {
      const orderId = q.get("ref_ids")!;
      stub.dlvFinds.push(orderId);
      const wb = stub.dlvBooked.get(orderId);
      return wb ? json(200, { ShipmentData: [dlvShipment(wb, orderId)] }) : json(200, { Error: "No such waybill or Order Id found" });
    }
    if (u.includes("/api/v1/packages/json/") && q.has("waybill")) {
      const awb = q.get("waybill")!;
      stub.dlvTrackCalls.push(awb);
      return reply(stub.dlvTrack.get(awb) ?? { status: 200, body: { ShipmentData: [dlvShipment(awb, "PRC-UNKNOWN0")] } });
    }
  }

  if (u.includes("api.resend.com")) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    stub.emails.push({ to: b.to?.[0], subject: b.subject });
    return json(200, { id: randomUUID() });
  }
  throw new Error(`unexpected fetch ${u}`);
}) as typeof fetch;

/** IST wall-clock → Date. */
const ist = (s: string) => new Date(`${s.replace(" ", "T")}+05:30`);

let m: any;

async function makeOrder(
  opts: { status?: string; paymentMethod?: string; provider?: "shiprocket" | "delhivery"; awb?: string | null; srOrderId?: string | null; srShipmentId?: string | null } = {},
) {
  const { db } = m.dbmod;
  const { customers, orders } = m.schema;
  const phone = `99${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const [c] = await db.insert(customers).values({ phone, name: "Test Buyer", email: "buyer@example.com" }).returning();
  const id = `PRC-C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  await db.insert(orders).values({
    id,
    siteId: "prc",
    customerId: c.id,
    status: opts.status ?? "PAID",
    items: [{ skuId: "pocket-bmw", variantSlug: null, name: "Pocket BMW", image: null, unitPriceInr: 1099, qty: 1, lineTotalInr: 1099 }],
    shippingAddress: { fullName: "Test Buyer", phone, email: "buyer@example.com", line1: "1 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560038" },
    subtotalInr: 1099,
    totalInr: 1099,
    paymentMethod: opts.paymentMethod ?? "UPI",
    paymentStatus: "CAPTURED",
    courierProvider: opts.provider ?? "shiprocket",
    shiprocketOrderId: opts.srOrderId ?? null,
    shiprocketShipmentId: opts.srShipmentId ?? null,
    awbCode: opts.awb ?? null,
    placedAt: new Date(Date.now() - 3_600_000),
    paidAt: new Date(Date.now() - 3_500_000),
  });
  return id;
}

async function orderRow(id: string) {
  const [o] = await m.dbmod.db.select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, id));
  return o;
}
async function jobRow(id: string) {
  const [j] = await m.dbmod.db.select().from(m.schema.shipmentJobs).where(m.orm.eq(m.schema.shipmentJobs.orderId, id));
  return j;
}
/** Make a backed-off / held job due again (the next cron tick, without the wait). */
async function makeDue(id: string) {
  await m.dbmod.db
    .update(m.schema.shipmentJobs)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(m.orm.eq(m.schema.shipmentJobs.orderId, id));
}
/** Pretend the unanswered Delhivery attempt happened `minutes` ago. */
async function backdateAttempt(id: string, minutes: number) {
  const o = await orderRow(id);
  const r = { ...o.courierRouting, booking: { ...o.courierRouting.booking, at: new Date(Date.now() - minutes * 60_000).toISOString() } };
  await m.dbmod.db.update(m.schema.orders).set({ courierRouting: r }).where(m.orm.eq(m.schema.orders.id, id));
}
async function eventsOf(id: string, type: string) {
  const { events } = m.schema;
  return m.dbmod.db.select().from(events).where(m.orm.and(m.orm.eq(events.orderId, id), m.orm.eq(events.type, type)));
}
async function count(table: any, where: any) {
  const [r] = await m.dbmod.db.select({ n: m.orm.sql`count(*)::int` }).from(table).where(where);
  return r.n as number;
}
const run = (id: string) => m.queue.runShipmentJobOnce(id);
const routing = (over: Record<string, unknown>) => m.settings.setSetting("couriers.routing", over, "test");
const closed = { openUntil: new Date(0).toISOString(), reason: "test reset", openedAt: new Date(0).toISOString() };
async function closeCircuits() {
  await m.settings.setSetting("tracking.circuit", closed, "test");
  await m.settings.setSetting("tracking.circuit.delhivery", closed, "test");
}
const dlvCreatesFor = (id: string) => stub.dlvCreates.filter((c) => c.orderId === id).length;
const srCreatesFor = (id: string) => stub.srCreates.filter((c) => c.orderId === id).length;

before(async () => {
  m = {
    dbmod: await import("../../src/db"),
    schema: await import("../../src/db/schema"),
    orm: await import("drizzle-orm"),
    settings: await import("../../src/lib/settings"),
    queue: await import("../../src/lib/fulfillment/shipment-queue"),
    create: await import("../../src/lib/fulfillment/create-shipment"),
    sync: await import("../../src/lib/tracking/sync"),
    webhook: await import("../../src/lib/tracking/webhook"),
    health: await import("../../src/lib/couriers/health"),
    route: await import("../../src/app/api/webhooks/delhivery/route"),
  };
  await closeCircuits();
  await m.settings.setSetting("tracking.config", { callSpacingMs: 0 }, "test");
  // Every notice on (incl. out-for-delivery) so a wrongly sent one is observable.
  await m.settings.setSetting("notifications.config", { enabled: { OUT_FOR_DELIVERY: true, DELIVERY_ESTIMATE_UPDATED: true }, quietHours: null }, "test");
});

after(async () => {
  await routing({});
  await closeCircuits();
});

describe("courier booking (integration)", () => {
  it("#22 mode off: Shiprocket books as before, no routing evaluation, no Delhivery call", async () => {
    await routing({ mode: "off" });
    const before = stub.dlvCreates.length + stub.dlvFinds.length;
    const id = await makeOrder();
    const r = await run(id);
    assert.equal(r.ran, true);
    assert.equal(r.result.courierProvider, "shiprocket");
    const o = await orderRow(id);
    assert.equal(o.courierProvider, "shiprocket");
    assert.match(o.shiprocketOrderId, /^\d+$/);
    assert.equal(o.courierRouting.decision, undefined);
    assert.equal(stub.dlvCreates.length + stub.dlvFinds.length, before);
  });

  it("#22 shadow: books Shiprocket exactly as before and stores the hypothetical decision", async () => {
    await routing({ mode: "shadow" }); // Delhivery booking stays disabled (default)
    const id = await makeOrder();
    const assignBefore = stub.srAssignCalls;
    const r = await run(id);
    assert.equal(r.ran, true, r.error);
    assert.equal(r.result.courierProvider, "shiprocket");
    assert.equal((await jobRow(id)).status, "DONE");

    assert.equal(srCreatesFor(id), 1);
    const sent = stub.srCreates.find((c) => c.orderId === id)!.body;
    assert.equal(sent.pickup_location, "Test Warehouse");
    assert.equal(sent.payment_method, "Prepaid");
    assert.equal(sent.sub_total, 1099);
    assert.equal(sent.billing_pincode, "560038");
    assert.equal(stub.srAssignCalls, assignBefore, "courier auto-assignment stays off");
    assert.equal(dlvCreatesFor(id), 0, "shadow never books Delhivery");

    const o = await orderRow(id);
    assert.equal(o.courierProvider, "shiprocket");
    assert.match(o.shiprocketOrderId, /^\d+$/);
    assert.match(o.shiprocketShipmentId, /^\d+$/);
    assert.equal(o.awbCode, null);
    assert.equal(o.status, "PAID", "no AWB yet — staff pick the courier on Shiprocket");
    const d = o.courierRouting.decision;
    assert.equal(d.mode, "shadow");
    assert.equal(d.hypothetical, true);
    assert.equal(d.recommended, "delhivery", "Delhivery evaluated as if enabled");
    assert.equal(d.reasonCode, "PREFERRED_ELIGIBLE");
    assert.equal(d.assessments.find((a: any) => a.provider === "delhivery").quote.totalPaise, 9052);
    assert.equal(d.assessments.find((a: any) => a.provider === "shiprocket").quote.totalPaise, 9500);
    assert.equal(o.courierRouting.booking.provider, "shiprocket");
    assert.equal(o.courierQuotedPaise, 9500, "the booked provider's quote");
    const [ev] = await eventsOf(id, "SHIPMENT_PENDING_AWB");
    assert.equal(ev.payload.routing.mode, "shadow");
  });

  it("#22 auto + Delhivery enabled and serviceable → books Delhivery (waybill, PACKED, no Shiprocket ids)", async () => {
    await routing({ mode: "auto", delhiveryEnabled: true });
    stub.dlvCreate = "ok";
    const id = await makeOrder();
    const r = await run(id);
    assert.equal(r.ran, true, r.error);
    assert.equal(r.result.courierProvider, "delhivery");
    assert.equal((await jobRow(id)).status, "DONE");

    const o = await orderRow(id);
    assert.equal(o.courierProvider, "delhivery");
    assert.equal(o.awbCode, stub.dlvBooked.get(id));
    assert.equal(o.status, "PACKED");
    assert.ok(o.packedAt);
    assert.equal(o.shiprocketOrderId, null);
    assert.equal(o.shiprocketShipmentId, null);
    assert.equal(o.courierName, "Delhivery");
    assert.equal(o.trackingUrl, `https://www.delhivery.com/track-v2/package/${o.awbCode}`);
    assert.equal(o.courierQuotedPaise, 9052);
    assert.equal(o.courierRouting.booking.state, "booked");
    assert.equal(o.courierRouting.booking.requestId, `UPL-${o.awbCode}`);
    assert.equal(o.courierRouting.decision.hypothetical, false);
    assert.equal(srCreatesFor(id), 0);

    const data = stub.dlvCreates.find((c) => c.orderId === id)!.data;
    assert.equal(data.pickup_location.name, "Test Warehouse");
    assert.equal(data.shipments[0].pin, "560038");
    assert.equal(data.shipments[0].payment_mode, "Prepaid");
    assert.equal(data.shipments[0].waybill, "");
    const [ev] = await eventsOf(id, "SHIPMENT_CREATED");
    assert.equal(ev.payload.courierProvider, "delhivery");
    assert.equal(ev.payload.via, "routing");
  });

  it("#8 create times out → retryable 'attempting'; within 10 min HELD (attempt refunded, no alert); after 10 min the order-id lookup adopts the waybill — ONE create call", async () => {
    await routing({ mode: "auto", delhiveryEnabled: true });
    stub.dlvCreate = "timeout";
    const id = await makeOrder();

    const r1 = await run(id);
    assert.match(r1.error ?? "", /timeout/i);
    let job = await jobRow(id);
    assert.equal(job.status, "PENDING", "a lost answer is retryable, never FAILED");
    assert.equal(job.attempts, 1);
    let o = await orderRow(id);
    assert.equal(o.courierRouting.booking.provider, "delhivery");
    assert.equal(o.courierRouting.booking.state, "attempting");
    assert.equal(o.awbCode, null);
    assert.equal(dlvCreatesFor(id), 1);

    stub.dlvCreate = "ok";
    await makeDue(id);
    const r2 = await run(id);
    assert.match(r2.error ?? "", /^Held:/);
    job = await jobRow(id);
    assert.equal(job.status, "PENDING");
    assert.equal(job.attempts, 1, "waiting does not spend an attempt");
    assert.match(job.lastError, /^held:/);
    assert.ok(job.nextAttemptAt.getTime() > Date.now() + 5 * 60_000, "re-checked once the 10 minutes are up");
    assert.equal((await eventsOf(id, "OPS_ALERT")).length, 0, "no alert while reconciling");
    assert.equal(dlvCreatesFor(id), 1, "never booked again blind");
    assert.equal(stub.dlvFinds.filter((x) => x === id).length, 0, "no lookup before 10 minutes");

    await backdateAttempt(id, 11);
    await makeDue(id);
    const r3 = await run(id);
    assert.equal(r3.ran, true, r3.error);
    assert.equal(r3.result.courierProvider, "delhivery");
    o = await orderRow(id);
    assert.equal(o.awbCode, stub.dlvBooked.get(id), "the waybill Delhivery created is adopted");
    assert.equal(o.status, "PACKED");
    assert.equal(o.courierProvider, "delhivery");
    assert.equal(dlvCreatesFor(id), 1, "exactly one create call in total");
    assert.equal(stub.dlvFinds.filter((x) => x === id).length, 1);
    assert.equal((await jobRow(id)).status, "DONE");
    const [ev] = await eventsOf(id, "SHIPMENT_CREATED");
    assert.equal(ev.payload.via, "reconciled");
  });

  it("#9 duplicate shipment-creation requests (concurrent and repeated) → one booking", async () => {
    await routing({ mode: "auto", delhiveryEnabled: true });
    stub.dlvCreate = "ok";
    const id = await makeOrder();
    const [a, b] = await Promise.all([run(id), run(id)]);
    assert.equal([a, b].filter((x: any) => x.ran).length, 1, "only one worker claims the job");
    const again = await run(id);
    assert.equal(again.ran, false);
    assert.equal(again.alreadyDone, true);
    const direct = await m.create.createShipmentForOrder(id);
    assert.equal(direct.idempotent, true);
    assert.equal(direct.awbCode, stub.dlvBooked.get(id));
    assert.equal(dlvCreatesFor(id), 1);
    assert.equal((await eventsOf(id, "SHIPMENT_CREATED")).length, 1);
  });

  it("Delhivery refusal ('ClientWarehouse matching query does not exist.') in auto mode → Shiprocket fallback + DELHIVERY_BOOKING_REFUSED", async () => {
    await routing({ mode: "auto", delhiveryEnabled: true });
    stub.dlvCreate = "refuse";
    const id = await makeOrder();
    const r = await run(id);
    assert.equal(r.ran, true, r.error);
    assert.equal(r.result.courierProvider, "shiprocket");
    assert.equal(dlvCreatesFor(id), 1);
    assert.equal(srCreatesFor(id), 1);
    const [refused] = await eventsOf(id, "DELHIVERY_BOOKING_REFUSED");
    assert.match(refused.payload.remark, /ClientWarehouse matching query does not exist/);
    const alerts = await eventsOf(id, "OPS_ALERT");
    assert.ok(alerts.some((a: any) => /booked on Shiprocket instead/.test(a.payload.message)));
    const o = await orderRow(id);
    assert.equal(o.courierProvider, "shiprocket");
    assert.match(o.shiprocketOrderId, /^\d+$/);
    assert.equal((await jobRow(id)).status, "DONE");
    stub.dlvCreate = "ok";
  });

  it("'insufficient balance… partially saved' → NOT booked elsewhere until the lookup says it doesn't exist", async () => {
    await routing({ mode: "auto", delhiveryEnabled: true });
    stub.dlvCreate = "ambiguous";
    const id = await makeOrder();
    const r1 = await run(id);
    assert.match(r1.error ?? "", /outcome unclear/);
    let o = await orderRow(id);
    assert.equal(o.courierRouting.booking.state, "attempting");
    assert.match(o.courierRouting.booking.remark, /insufficient balance/);
    assert.equal(srCreatesFor(id), 0, "never booked elsewhere on an ambiguous failure");
    assert.equal((await jobRow(id)).status, "PENDING");

    await makeDue(id);
    const r2 = await run(id);
    assert.match(r2.error ?? "", /^Held:/);
    assert.equal(srCreatesFor(id), 0);

    stub.dlvCreate = "ok";
    await backdateAttempt(id, 11);
    await makeDue(id);
    const r3 = await run(id);
    assert.equal(r3.ran, true, r3.error);
    assert.equal(r3.result.courierProvider, "shiprocket");
    assert.equal(stub.dlvFinds.filter((x) => x === id).length, 1, "looked up first");
    assert.equal(dlvCreatesFor(id), 1, "Delhivery not retried");
    assert.equal(srCreatesFor(id), 1);
    const [refused] = await eventsOf(id, "DELHIVERY_BOOKING_REFUSED");
    assert.match(refused.payload.remark, /insufficient balance/);
    o = await orderRow(id);
    assert.equal(o.courierProvider, "shiprocket");
  });

  let heldId = "";
  it("#6 manual mode with Delhivery recommended → held for staff, ops alerted once", async () => {
    await routing({ mode: "manual", delhiveryEnabled: true });
    const id = (heldId = await makeOrder());
    const r1 = await run(id);
    assert.match(r1.error ?? "", /^Held: Delhivery \(direct\) recommended/);
    let job = await jobRow(id);
    assert.equal(job.status, "PENDING");
    assert.equal(job.attempts, 0, "held runs don't spend attempts");
    const o = await orderRow(id);
    assert.match(o.courierRouting.held.reason, /Delhivery \(direct\) recommended/);
    assert.ok(o.courierRouting.held.alertedAt);
    assert.equal(o.courierRouting.decision.mode, "manual");
    assert.equal((await eventsOf(id, "OPS_ALERT")).length, 1);
    assert.equal((await eventsOf(id, "SHIPMENT_HELD_FOR_STAFF")).length, 1);
    assert.equal(dlvCreatesFor(id) + srCreatesFor(id), 0, "nothing booked");

    await makeDue(id);
    const r2 = await run(id);
    assert.match(r2.error ?? "", /^Held:/);
    job = await jobRow(id);
    assert.equal(job.attempts, 0);
    assert.equal((await eventsOf(id, "OPS_ALERT")).length, 1, "the second run does not alert again");
    assert.equal((await eventsOf(id, "SHIPMENT_HELD_FOR_STAFF")).length, 1);
  });

  it("#20 staff override → books the chosen provider (Delhivery for the held order; Shiprocket over an auto pick)", async () => {
    assert.ok(heldId, "depends on the manual-mode test");
    const o0 = await orderRow(heldId);
    await m.dbmod.db
      .update(m.schema.orders)
      .set({ courierRouting: { ...o0.courierRouting, override: { provider: "delhivery", by: "staff@example.com", at: new Date().toISOString() } } })
      .where(m.orm.eq(m.schema.orders.id, heldId));
    await makeDue(heldId);
    const r = await run(heldId);
    assert.equal(r.ran, true, r.error);
    assert.equal(r.result.courierProvider, "delhivery");
    const o = await orderRow(heldId);
    assert.equal(o.status, "PACKED");
    assert.equal(o.awbCode, stub.dlvBooked.get(heldId));
    assert.equal(o.courierRouting.held, undefined, "no longer waiting");
    const [ev] = await eventsOf(heldId, "SHIPMENT_CREATED");
    assert.equal(ev.payload.via, "override");

    await routing({ mode: "auto", delhiveryEnabled: true });
    const id = await makeOrder();
    await m.dbmod.db
      .update(m.schema.orders)
      .set({ courierRouting: { override: { provider: "shiprocket", by: "staff@example.com", at: new Date().toISOString() } } })
      .where(m.orm.eq(m.schema.orders.id, id));
    const r2 = await run(id);
    assert.equal(r2.result.courierProvider, "shiprocket");
    assert.equal(dlvCreatesFor(id), 0);
    assert.equal(srCreatesFor(id), 1);
  });

  it("#19 provider outage and recovery: Delhivery unreachable / breaker open → Shiprocket; healthy again → Delhivery", async () => {
    await routing({ mode: "auto", delhiveryEnabled: true });
    stub.dlvCreate = "ok";
    stub.dlvLookup = "down";
    const a = await makeOrder();
    const ra = await run(a);
    assert.equal(ra.result.courierProvider, "shiprocket");
    const oa = await orderRow(a);
    assert.equal(oa.courierRouting.decision.reasonCode, "FALLBACK");
    const dA = oa.courierRouting.decision.assessments.find((x: any) => x.provider === "delhivery");
    assert.equal(dA.serviceable, null);
    assert.ok(dA.error);
    assert.equal(dlvCreatesFor(a), 0, "an unverified Delhivery lane is never booked");

    stub.dlvLookup = "ok";
    await m.settings.setSetting(
      "tracking.circuit.delhivery",
      { openUntil: new Date(Date.now() + 30 * 60_000).toISOString(), reason: "Delhivery → 401", openedAt: new Date().toISOString() },
      "test",
    );
    const b = await makeOrder();
    assert.equal((await run(b)).result.courierProvider, "shiprocket");
    const ob = await orderRow(b);
    assert.match(ob.courierRouting.decision.eligibility.find((e: any) => e.provider === "delhivery").reason, /paused/);

    await closeCircuits();
    const c = await makeOrder();
    assert.equal((await run(c)).result.courierProvider, "delhivery", "recovered");
  });

  it("cheaper-only: Shiprocket's GST basis set → like-for-like comparison; unknown → no cost decision", async () => {
    stub.dlvLookup = "ok";
    stub.dlvCreate = "ok";
    // Shiprocket's cheapest surface rate is ₹95; "excluded" adds 18% → ₹112.10 vs Delhivery ₹90.52 incl. GST.
    await routing({ mode: "auto", delhiveryEnabled: true, requireCheaper: true, shiprocketRatesGst: "excluded" });
    const a = await makeOrder();
    assert.equal((await run(a)).result.courierProvider, "delhivery");
    const da = (await orderRow(a)).courierRouting.decision;
    const sr = da.assessments.find((x: any) => x.provider === "shiprocket").quote;
    assert.equal(sr.totalPaise, 11210);
    assert.equal(sr.taxIncluded, true);
    assert.equal(sr.confidence, "full");
    assert.equal(da.reasonCode, "PREFERRED_CHEAPER");
    assert.equal(da.comparable, true);
    assert.equal(da.savingsPaise, 11210 - 9052);

    await routing({ mode: "auto", delhiveryEnabled: true, requireCheaper: true });
    const b = await makeOrder();
    await run(b);
    const db2 = (await orderRow(b)).courierRouting.decision;
    assert.equal(db2.comparable, false);
    assert.equal(db2.reasonCode, "PREFERRED_COST_UNVERIFIED");
    assert.equal(db2.savingsPaise, null);
  });

  it("Shiprocket's cancel webhook for the old courier-less order never marks the Delhivery parcel cancelled", async () => {
    await routing({ mode: "auto", delhiveryEnabled: true });
    stub.dlvLookup = "ok";
    stub.dlvCreate = "ok";
    const id = await makeOrder();
    assert.equal((await run(id)).result.courierProvider, "delhivery");
    const { db: d } = m.dbmod;
    const { webhooksInbound, shipmentTracking: st, deliveryExceptions } = m.schema;
    const { and: andOp, eq: eqOp } = m.orm;
    const payload = { order_id: id, channel_order_id: id, current_status: "CANCELED", shipment_status: "CANCELED", current_timestamp: "13 10 2026 14:36:00" };
    const [row] = await d
      .insert(webhooksInbound)
      .values({ source: "shiprocket", externalId: `test-${id}`, payload, processed: false })
      .returning({ id: webhooksInbound.id });
    const r = await m.webhook.processStoredWebhook(row.id, `test-${id}`, payload);
    assert.equal(r.matched, false);
    const [w] = await d.select().from(webhooksInbound).where(eqOp(webhooksInbound.id, row.id));
    assert.equal(w.processed, true);
    assert.match(w.error ?? "", /booked on Delhivery/);
    const [t] = await d.select().from(st).where(andOp(eqOp(st.orderId, id), eqOp(st.kind, "FORWARD")));
    assert.notEqual(t.status, "CANCELLED");
    assert.equal(t.courierProvider, "delhivery");
    const open = await d.select().from(deliveryExceptions).where(eqOp(deliveryExceptions.orderId, id));
    assert.equal(open.filter((x: any) => x.type === "SHIPMENT_CANCELLED").length, 0);
  });
});

// ---- Delhivery tracking --------------------------------------------------------
const dScan = (at: string, type: string, scan: string, code: string, instructions: string, location: string) => ({
  ScanDetail: { ScanDateTime: at, ScanType: type, Scan: scan, StatusCode: code, Instructions: instructions, ScannedLocation: location, StatusDateTime: at },
});
function dTrack(awb: string, orderId: string, cur: { type: string; status: string; code?: string; at: string; instructions?: string }, scans: unknown[]) {
  return {
    ShipmentData: [
      {
        Shipment: {
          AWB: awb,
          ReferenceNo: orderId,
          Status: { Status: cur.status, StatusType: cur.type, StatusCode: cur.code, StatusDateTime: cur.at, Instructions: cur.instructions ?? "", StatusLocation: "Chennai_DC (Tamil Nadu)" },
          Scans: scans,
          ExpectedDeliveryDate: "2026-10-11T23:59:59",
        },
      },
    ],
  };
}
const journey = [
  dScan("2026-10-08T11:00:00", "UD", "Manifested", "X-UCI", "Manifest uploaded", "Bengaluru (Karnataka)"),
  dScan("2026-10-08T18:10:00", "UD", "In Transit", "X-PPOM", "Shipment picked up", "Bengaluru_Hub (Karnataka)"),
  dScan("2026-10-09T14:00:00", "UD", "In Transit", "X-DLL2F", "Shipment Received at Facility", "Chennai_Hub (Tamil Nadu)"),
];
const ofd = dScan("2026-10-10T09:30:00", "UD", "Dispatched", "X-DDD3FD", "Out for delivery", "Chennai_DC (Tamil Nadu)");
const attempt = dScan("2026-10-10T17:00:00", "UD", "Pending", "EOD-11", "Consignee unavailable", "Chennai_DC (Tamil Nadu)");

async function trackingFor(orderId: string) {
  const { shipmentTracking } = m.schema;
  const [row] = await m.dbmod.db
    .select()
    .from(shipmentTracking)
    .where(m.orm.and(m.orm.eq(shipmentTracking.orderId, orderId), m.orm.eq(shipmentTracking.kind, "FORWARD")));
  return row;
}
async function outboxFor(orderId: string) {
  const { notificationsOutbox } = m.schema;
  return m.dbmod.db.select().from(notificationsOutbox).where(m.orm.eq(notificationsOutbox.orderId, orderId));
}
/** Store + process a Delhivery scan push at a FIXED time (as the route would). */
async function hookDelhivery(body: any, now: Date) {
  const externalId = m.webhook.delhiveryWebhookExternalId(body);
  const [row] = await m.dbmod.db
    .insert(m.schema.webhooksInbound)
    .values({ source: "delhivery", externalId, payload: body, processed: false })
    .onConflictDoNothing()
    .returning();
  if (!row) return { duplicate: true };
  return m.webhook.processStoredDelhiveryWebhook(row.id, externalId, body, now);
}

// Clocks here start on 10 Oct 2026, after every fixed clock in
// tracking.integration.test.ts (whose stub has no Delhivery routes), so the
// two suites never claim each other's due rows on a shared database.
describe("Delhivery tracking (integration)", () => {
  let dlvId = "";
  let dlvAwb = "";

  it("#21 a Delhivery shipment syncs (admin resync) through the Delhivery adapter", async () => {
    dlvAwb = waybill();
    dlvId = await makeOrder({ status: "PACKED", provider: "delhivery", awb: dlvAwb });
    stub.dlvTrack.set(dlvAwb, { status: 200, body: dTrack(dlvAwb, dlvId, { type: "UD", status: "In Transit", at: "2026-10-09T14:00:00" }, journey) });
    const now = ist("2026-10-10 10:00:00");
    const row0 = await m.sync.ensureForwardTracking(dlvId, now);
    assert.equal(row0.courierProvider, "delhivery");
    const srCalls = stub.srTrackCalls;
    const r = await m.sync.syncTrackingNow(row0.id, now);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(stub.dlvTrackCalls.includes(dlvAwb), "polled on Delhivery by waybill");
    assert.equal(stub.srTrackCalls, srCalls, "never asked Shiprocket");
    const row = await trackingFor(dlvId);
    assert.equal(row.status, "IN_TRANSIT");
    assert.equal(row.courierName, "Delhivery");
    assert.equal(row.lastSyncSuccessAt.toISOString(), now.toISOString());
    assert.equal(row.pickedUpAt.toISOString(), ist("2026-10-08 18:10:00").toISOString());
    const { shipmentTrackingEvents } = m.schema;
    assert.equal(await count(shipmentTrackingEvents, m.orm.eq(shipmentTrackingEvents.trackingId, row.id)), 3);
    const o = await orderRow(dlvId);
    assert.equal(o.status, "SHIPPED");
  });

  it("#11 a duplicate Delhivery scan push is stored once (and a retry adds no event)", async () => {
    const body = {
      Shipment: {
        AWB: dlvAwb,
        ReferenceNo: dlvId,
        NSLCode: "X-DDD3FD",
        Status: { Status: "Dispatched", StatusType: "UD", StatusDateTime: "2026-10-10T10:30:00.000", StatusLocation: "Chennai_DC (Tamil Nadu)", Instructions: "Out for delivery" },
      },
    };
    const now = ist("2026-10-10 10:31:00");
    const first = await hookDelhivery(body, now);
    assert.equal(first.matched, true);
    assert.equal((await hookDelhivery(body, now)).duplicate, true);
    assert.equal((await hookDelhivery(body, now)).duplicate, true);
    // The route answers a repeat as a duplicate too, before any processing.
    const res = await m.route.POST(
      new Request("http://local/api/webhooks/delhivery", { method: "POST", headers: { "x-api-key": "dlv-hook-token", "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
    assert.deepEqual(await res.json(), { ok: true, duplicate: true });
    const bad = await m.route.POST(new Request("http://local/api/webhooks/delhivery", { method: "POST", headers: { "x-api-key": "wrong" }, body: JSON.stringify(body) }));
    assert.equal(bad.status, 401);

    const { webhooksInbound, shipmentTrackingEvents } = m.schema;
    const externalId = m.webhook.delhiveryWebhookExternalId(body);
    assert.equal(await count(webhooksInbound, m.orm.and(m.orm.eq(webhooksInbound.source, "delhivery"), m.orm.eq(webhooksInbound.externalId, externalId))), 1);
    const row = await trackingFor(dlvId);
    assert.equal(row.status, "OUT_FOR_DELIVERY");
    const events = await count(shipmentTrackingEvents, m.orm.eq(shipmentTrackingEvents.trackingId, row.id));
    assert.equal(events, 4);
    const [stored] = await m.dbmod.db.select().from(webhooksInbound).where(m.orm.eq(webhooksInbound.externalId, externalId));
    await m.webhook.processStoredDelhiveryWebhook(stored.id, externalId, body, ist("2026-10-10 10:40:00"));
    assert.equal(await count(shipmentTrackingEvents, m.orm.eq(shipmentTrackingEvents.trackingId, row.id)), events, "fingerprint dedup");

    // A push for a waybill we booked on Shiprocket is not ours to apply.
    const srAwb = waybill();
    const srId = await makeOrder({ status: "PACKED", awb: srAwb, srOrderId: String(++srSeq), srShipmentId: String(++srSeq) });
    await m.sync.ensureForwardTracking(srId, now);
    const foreign = await hookDelhivery({ Shipment: { ...body.Shipment, AWB: srAwb, ReferenceNo: srId } }, now);
    assert.equal(foreign.matched, false);
  });

  it("#23/#24 the first snapshot of a Delhivery shipment is a silent baseline; the next real change notifies once", async () => {
    const awb = waybill();
    const id = await makeOrder({ status: "PACKED", provider: "delhivery", awb });
    stub.dlvTrack.set(awb, { status: 200, body: dTrack(awb, id, { type: "UD", status: "Dispatched", at: "2026-10-10T09:30:00" }, [...journey, ofd]) });
    const t1 = ist("2026-10-10 11:00:00");
    const row0 = await m.sync.ensureForwardTracking(id, t1);
    assert.equal((await m.sync.syncTrackingNow(row0.id, t1)).ok, true);
    let row = await trackingFor(id);
    assert.equal(row.status, "OUT_FOR_DELIVERY");
    assert.ok(row.baselineAt, "baseline established");
    assert.equal((await outboxFor(id)).length, 0, "#23 no customer notice from the first snapshot (even out-for-delivery)");
    assert.equal((await orderRow(id)).status, "SHIPPED", "the order still moves forward");

    stub.dlvTrack.set(awb, {
      status: 200,
      body: dTrack(awb, id, { type: "UD", status: "Pending", code: "EOD-11", at: "2026-10-10T17:00:00", instructions: "Consignee unavailable" }, [...journey, ofd, attempt]),
    });
    const t2 = ist("2026-10-10 18:00:00");
    assert.equal((await m.sync.syncTrackingNow(row0.id, t2)).ok, true);
    row = await trackingFor(id);
    assert.equal(row.status, "DELIVERY_ATTEMPTED");
    assert.equal(row.deliveryAttempts, 1);
    assert.match(row.statusLabel, /Consignee unavailable/);
    const { notificationsOutbox } = m.schema;
    const key = m.orm.eq(notificationsOutbox.dedupKey, `notice:${id}:ATTEMPT:1:email`);
    assert.equal(await count(notificationsOutbox, key), 1, "#24 one failed-attempt notice");
    assert.equal(await m.sync.syncTrackingNow(row0.id, ist("2026-10-10 18:30:00")).then((r: any) => r.ok), true);
    assert.equal(await count(notificationsOutbox, key), 1, "a repeat poll sends nothing new");
    assert.equal((await outboxFor(id)).length, 1);
  });

  it("#21 a Delhivery 401 opens ONLY the Delhivery circuit — Shiprocket rows keep syncing; resync works again once it closes", async () => {
    const dAwb = waybill();
    const sAwb = waybill();
    const dId = await makeOrder({ status: "PACKED", provider: "delhivery", awb: dAwb });
    const sId = await makeOrder({ status: "PACKED", awb: sAwb, srOrderId: String(++srSeq), srShipmentId: String(++srSeq) });
    const t = ist("2026-10-10 20:00:00");
    const dRow = await m.sync.ensureForwardTracking(dId, t);
    const sRow = await m.sync.ensureForwardTracking(sId, t);
    assert.equal(sRow.courierProvider, "shiprocket");
    stub.dlvTrack.set(dAwb, { status: 401, body: { detail: "Authentication credentials were not provided." } });

    const s1 = await m.sync.runTrackingSync({ trigger: "CRON", now: t, limit: 1000 });
    assert.match(s1.skippedReason ?? "", /delhivery refused/);
    assert.ok(await m.health.circuitState(t, "delhivery"), "Delhivery paused");
    assert.equal(await m.health.circuitState(t, "shiprocket"), null, "Shiprocket not paused");
    const d = await trackingFor(dId);
    assert.equal(d.consecutiveFailures, 1);
    assert.match(d.lastSyncError, /401/);
    assert.ok(!d.lastSyncError.includes("dlv-test-token"));
    const s = await trackingFor(sId);
    assert.equal(s.lastSyncSuccessAt?.toISOString(), t.toISOString(), "Shiprocket row synced in the same run");

    // Next run: no Delhivery calls at all, Shiprocket still polled.
    const t2 = new Date(t.getTime() + 10 * 60_000);
    await m.dbmod.db.update(m.schema.shipmentTracking).set({ nextSyncAt: t2 }).where(m.orm.inArray(m.schema.shipmentTracking.id, [dRow.id, sRow.id]));
    const dlvCalls = stub.dlvTrackCalls.length;
    const srCalls = stub.srTrackCalls;
    const s2 = await m.sync.runTrackingSync({ trigger: "CRON", now: t2, limit: 1000 });
    assert.match(s2.skippedReason ?? "", /delhivery circuit open/);
    assert.equal(stub.dlvTrackCalls.length, dlvCalls, "no Delhivery call while its circuit is open");
    assert.ok(stub.srTrackCalls > srCalls, "Shiprocket polled");
    assert.equal((await trackingFor(sId)).lastSyncSuccessAt.toISOString(), t2.toISOString());
    const paused = await m.sync.syncTrackingNow(dRow.id, t2);
    assert.equal(paused.ok, false);
    assert.equal(paused.refused, true);
    assert.equal(stub.dlvTrackCalls.length, dlvCalls);

    await closeCircuits();
    stub.dlvTrack.set(dAwb, { status: 200, body: dTrack(dAwb, dId, { type: "UD", status: "In Transit", at: "2026-10-10T19:00:00" }, journey) });
    const back = await m.sync.syncTrackingNow(dRow.id, new Date(t2.getTime() + 60_000));
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.equal((await trackingFor(dId)).consecutiveFailures, 0);
  });
});
