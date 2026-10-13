/**
 * Support centre integration test — verification, tickets, claims and refunds
 * against a REAL local Postgres (PGlite), with Resend and Razorpay stubbed.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres \
 *     node --import tsx --test --test-concurrency=1 scripts/tests/support.integration.test.ts
 *
 * Refuses to run against anything but localhost. Creates its own fixtures.
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("support.integration.test refuses to run against a non-local database");
}
process.env.DATABASE_URL = url;
delete process.env.DATABASE_URL_POOLED;
process.env.DATABASE_POOL_MAX = "1";
process.env.RESEND_API_KEY = "re_test";
process.env.SUPPORT_SESSION_SECRET = "integration-secret";
process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_test_x";
process.env.RAZORPAY_KEY_SECRET = "secret";
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.WHATSAPP_ENABLED;
delete process.env.OPS_ALERT_EMAIL;

const emails: Array<{ to: string; subject: string; text: string }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u.includes("api.resend.com")) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    emails.push({ to: b.to?.[0], subject: b.subject, text: b.text });
    return new Response(JSON.stringify({ id: randomUUID() }), { status: 200 });
  }
  throw new Error(`unexpected fetch ${u}`);
}) as typeof fetch;

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: any;

async function makeOrder(opts: { status: string; deliveredDaysAgo?: number; paymentMethod?: string; confirmationFeeInr?: number }) {
  const { db } = m.dbmod;
  const { customers, orders } = m.schema;
  const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const email = `buyer+${randomUUID().slice(0, 6)}@example.com`;
  const [c] = await db.insert(customers).values({ phone, name: "Test Buyer", email }).returning();
  const id = `PRC-S${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const delivered = opts.deliveredDaysAgo != null ? new Date(Date.now() - opts.deliveredDaysAgo * 86_400_000) : null;
  await db.insert(orders).values({
    id,
    siteId: "prc",
    customerId: c.id,
    status: opts.status,
    items: [{ skuId: "pocket-bmw", variantSlug: null, name: "Pocket BMW", image: null, unitPriceInr: 1099, qty: 1, lineTotalInr: 1099 }],
    shippingAddress: { fullName: "Test Buyer", phone, email, line1: "1 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560038" },
    subtotalInr: 1099,
    totalInr: 1099,
    confirmationFeeInr: opts.confirmationFeeInr ?? 0,
    paymentMethod: opts.paymentMethod ?? "UPI",
    paymentStatus: "CAPTURED",
    razorpayPaymentId: `pay_${randomUUID().slice(0, 12)}`,
    placedAt: new Date(Date.now() - 10 * 86_400_000),
    paidAt: new Date(Date.now() - 10 * 86_400_000),
    deliveredAt: delivered,
  });
  return { id, customerId: c.id as string, phone, email };
}

async function setStock(n: number) {
  const { db } = m.dbmod;
  const { inventory } = m.schema;
  await db
    .insert(inventory)
    .values({ siteId: "prc", skuId: "pocket-bmw", variantSlug: "", stock: n })
    .onConflictDoUpdate({ target: [inventory.siteId, inventory.skuId, inventory.variantSlug], set: { stock: n } });
}

before(async () => {
  m = {
    dbmod: await import("../../src/db"),
    schema: await import("../../src/db/schema"),
    orm: await import("drizzle-orm"),
    verify: await import("../../src/lib/support/verify"),
    tickets: await import("../../src/lib/support/tickets"),
    adminQueries: await import("../../src/lib/support/admin-queries"),
    claims: await import("../../src/lib/support/claims"),
    refunds: await import("../../src/lib/support/refunds"),
    settings: await import("../../src/lib/settings"),
  };
  await m.settings.setSetting("notifications.config", { quietHours: null }, "test");
});

describe("guest order verification", () => {
  it("never verifies on order id + wrong contact, and sends a code only to the order's email", async () => {
    const o = await makeOrder({ status: "SHIPPED" });
    const bad = await m.verify.startOrderVerification({ orderId: o.id, contact: "9999999999", ipHash: "ip-a" });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "NOT_MATCHED");

    const start = await m.verify.startOrderVerification({ orderId: o.id.toLowerCase(), contact: o.phone, ipHash: "ip-a" });
    assert.equal(start.ok, true);
    const mail = emails.at(-1)!;
    assert.equal(mail.to, o.email);
    const code = mail.subject.match(/^(\d{6})/)![1];

    const wrong = await m.verify.confirmOrderVerification({ challengeId: start.challengeId, code: code === "000000" ? "111111" : "000000" });
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /4 attempts left/);

    const ok = await m.verify.confirmOrderVerification({ challengeId: start.challengeId, code });
    assert.equal(ok.ok, true);
    assert.equal(ok.customerId, o.customerId);
    const again = await m.verify.confirmOrderVerification({ challengeId: start.challengeId, code });
    assert.equal(again.ok, false, "a code works once");

    const [row] = await m.dbmod.db.select().from(m.schema.supportVerifications).where(m.orm.eq(m.schema.supportVerifications.id, start.challengeId));
    assert.ok(!row.codeHash.includes(code), "the code itself is never stored");
  });

  it("rate-limits code requests per order", async () => {
    const o = await makeOrder({ status: "SHIPPED" });
    for (let i = 0; i < 3; i++) assert.equal((await m.verify.startOrderVerification({ orderId: o.id, contact: o.email, ipHash: `ip-${i}` })).ok, true);
    const fourth = await m.verify.startOrderVerification({ orderId: o.id, contact: o.email, ipHash: "ip-x" });
    assert.equal(fourth.code, "RATE_LIMITED");
  });
});

describe("tickets", () => {
  it("refuses an order ticket without verification", async () => {
    const o = await makeOrder({ status: "DELIVERED", deliveredDaysAgo: 2 });
    await assert.rejects(
      m.tickets.createTicket({ category: "DAMAGED_PRODUCT", description: "cracked shell on arrival", orderId: o.id, contact: {}, verifiedCustomerId: null, actor: "customer" }),
      /verify your order/i,
    );
  });

  it("creates a HIGH damage ticket with a claim awaiting evidence; access is owner/token only; internal notes stay hidden", async () => {
    const o = await makeOrder({ status: "DELIVERED", deliveredDaysAgo: 2 });
    const t = await m.tickets.createTicket({
      category: "DAMAGED_PRODUCT",
      description: "The rear wheel was snapped when I opened the box.",
      orderId: o.id,
      skuId: "pocket-bmw",
      contact: {},
      verifiedCustomerId: o.customerId,
      actor: "customer",
    });
    assert.equal(t.priority, "HIGH");
    assert.ok(t.claimNumber);
    const [claim] = await m.dbmod.db.select().from(m.schema.supportClaims).where(m.orm.eq(m.schema.supportClaims.number, t.claimNumber));
    assert.equal(claim.status, "NEEDS_INFO", "evidence is required for damage");
    assert.equal(claim.eligibility.eligible, true);

    assert.ok(await m.tickets.findTicketForCustomer(t.number, { token: t.accessToken }));
    assert.equal(await m.tickets.findTicketForCustomer(t.number, { token: "nope" }), null);
    assert.equal(await m.tickets.findTicketForCustomer(t.number, { sessionCustomerId: randomUUID() }), null);
    const row = await m.tickets.findTicketForCustomer(t.number, { sessionCustomerId: o.customerId });
    assert.ok(row);

    await m.tickets.staffReply(row, "agent@pocketrc.local", { body: "Customer sounds legit, check stock", internal: true });
    await m.tickets.staffReply(row, "agent@pocketrc.local", { body: "Sorry about that! Please add a photo.", internal: false, setStatus: "AWAITING_CUSTOMER" });
    const view = await m.tickets.customerTicketView((await m.tickets.getTicketById(row.id))!);
    assert.ok(!view.messages.some((x: any) => /legit/.test(x.body)), "internal note hidden");
    assert.ok(view.messages.some((x: any) => /add a photo/.test(x.body)));
    assert.equal(view.awaitingCustomer, true);
    assert.ok(emails.some((e) => e.subject.includes(t.number)), "customer emailed");
  });

  it("escalates a safety report to CRITICAL immediately", async () => {
    const o = await makeOrder({ status: "DELIVERED", deliveredDaysAgo: 1 });
    const t = await m.tickets.createTicket({
      category: "BATTERY_CHARGING",
      description: "While charging the battery started smoking and swelling",
      orderId: o.id,
      contact: {},
      verifiedCustomerId: o.customerId,
      actor: "customer",
    });
    assert.equal(t.priority, "CRITICAL");
    assert.equal(t.status, "ESCALATED");
  });
});

describe("linking an order to a ticket raised without one", () => {
  it("finds the order by phone, links it once, and keeps it hidden from an unverified customer", async () => {
    const o = await makeOrder({ status: "SHIPPED" });
    await makeOrder({ status: "SHIPPED" }); // someone else's order — must not match
    const t = await m.tickets.createTicket({
      category: "GENERAL",
      description: "Ten days and still no update on my order",
      contact: { name: "Guest", email: "Other.Address@Example.com", phone: `+91 ${o.phone.slice(0, 5)} ${o.phone.slice(5)}` },
      verifiedCustomerId: null,
      actor: "customer",
    });
    const { db } = m.dbmod;
    const { supportTickets } = m.schema;
    const { eq } = m.orm;
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));

    const leads = await m.adminQueries.findContactOrders(row);
    assert.deepEqual(leads.map((l: any) => [l.id, l.matches]), [[o.id, ["phone"]]]);

    await m.tickets.linkTicketOrder(row, "staff@example.com", o.id, ["phone"]);
    const [linked] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
    assert.equal(linked.orderId, o.id);
    assert.equal(linked.identityVerified, false);
    assert.equal((await m.tickets.customerTicketView(linked)).orderId, null);
    await assert.rejects(m.tickets.linkTicketOrder(linked, "staff@example.com", o.id, ["phone"]), /already linked/);
  });
});

describe("duplicate tickets", () => {
  it("a second request about the same order and problem joins the open ticket", async () => {
    const o = await makeOrder({ status: "SHIPPED" });
    const ask = (description: string) =>
      m.tickets.createTicket({ category: "DELIVERY_DELAYED", description, orderId: o.id, contact: {}, verifiedCustomerId: o.customerId, actor: "customer" });
    const first = await ask("Still not shipped after a week");
    const second = await ask("Please send it urgently, it is a gift");
    assert.equal(first.existing, false);
    assert.equal(second.existing, true);
    assert.equal(second.number, first.number);
    assert.equal(second.accessToken, null);
    const { db } = m.dbmod;
    const { supportTicketMessages, supportTickets } = m.schema;
    const { eq } = m.orm;
    assert.equal((await db.select().from(supportTicketMessages).where(eq(supportTicketMessages.ticketId, first.id))).length, 2);
    assert.equal((await db.select().from(supportTickets).where(eq(supportTickets.orderId, o.id))).length, 1);
  });

  it("a follow-up of another kind joins and lifts priority; a new claim and a guest ticket stay separate", async () => {
    const o = await makeOrder({ status: "DELIVERED", deliveredDaysAgo: 1 });
    const ask = (category: string, description: string) =>
      m.tickets.createTicket({ category, description, orderId: o.id, contact: {}, verifiedCustomerId: o.customerId, actor: "customer" });
    const general = await ask("GENERAL", "When will my order arrive please");
    assert.equal(general.priority, "LOW");
    const followUp = await ask("DELIVERY_DELAYED", "It is taking far too long now");
    assert.equal(followUp.existing, true);
    assert.equal(followUp.number, general.number);
    assert.equal(followUp.priority, "MEDIUM");
    const { db } = m.dbmod;
    const { supportTicketMessages, supportTickets } = m.schema;
    const { eq } = m.orm;
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, general.id));
    assert.equal(row.priority, "MEDIUM");
    const msgs = await db.select().from(supportTicketMessages).where(eq(supportTicketMessages.ticketId, general.id));
    assert.ok(msgs.some((x: any) => x.body.startsWith("(Delivery delayed)")));

    const claim = await ask("DAMAGED_PRODUCT", "The shell arrived cracked in two places");
    assert.equal(claim.existing, false);

    // A guest ticket with the order's email (no order, unverified) is shown to staff, not auto-joined.
    const guest = await m.tickets.createTicket({ category: "GENERAL", description: "Any update on my parcel please", contact: { name: "Guest", email: o.email }, actor: "customer" });
    assert.equal(guest.existing, false);
    const detail = await m.adminQueries.loadTicketDetail(general.id);
    const twin = detail.siblings.find((x: any) => x.id === guest.id);
    assert.ok(twin, "guest ticket listed as a possible duplicate");
    assert.deepEqual(twin.why, ["same email"]);
    assert.equal(twin.identityVerified, false);
  });

  it("staff merge moves the messages and closes the duplicate", async () => {
    const o = await makeOrder({ status: "SHIPPED" });
    const raise = (description: string) =>
      m.tickets.createTicket({ category: "DELIVERY_DELAYED", description, orderId: o.id, contact: {}, actor: "staff@example.com" });
    const keep = await raise("Customer called: where is my parcel");
    const dup = await raise("Customer emailed: same question again");
    const { db } = m.dbmod;
    const { supportTicketMessages, supportTickets } = m.schema;
    const { eq } = m.orm;
    const row = async (id: string) => (await db.select().from(supportTickets).where(eq(supportTickets.id, id)))[0];
    await m.tickets.mergeDuplicateTicket(await row(dup.id), await row(keep.id), "staff@example.com");
    const kept = await db.select().from(supportTicketMessages).where(eq(supportTicketMessages.ticketId, keep.id));
    assert.deepEqual(kept.map((x: any) => x.body).sort(), ["Customer called: where is my parcel", "Customer emailed: same question again"]);
    const closed = await row(dup.id);
    assert.equal(closed.status, "CLOSED");
    const note = await db.select().from(supportTicketMessages).where(eq(supportTicketMessages.ticketId, dup.id));
    assert.ok(note.some((x: any) => x.authorType === "SYSTEM" && x.body.includes(keep.number)));
    await assert.rejects(m.tickets.mergeDuplicateTicket(closed, await row(keep.id), "staff@example.com"), /can't be merged/);
  });
});

describe("claims", () => {
  it("won't promise a replacement without stock, then commits stock exactly once", async () => {
    const o = await makeOrder({ status: "DELIVERED", deliveredDaysAgo: 2 });
    const t = await m.tickets.createTicket({ category: "PRODUCT_NOT_WORKING", description: "Car does not power on at all", orderId: o.id, skuId: "pocket-bmw", contact: {}, verifiedCustomerId: o.customerId, actor: "customer" });
    const [claim0] = await m.dbmod.db.select().from(m.schema.supportClaims).where(m.orm.eq(m.schema.supportClaims.number, t.claimNumber));
    await setStock(0);
    await assert.rejects(m.claims.decideClaim(claim0, "sup@pocketrc.local", "APPROVE", ""), /Out of stock/);
    await setStock(2);
    const approved = await m.claims.decideClaim(claim0, "sup@pocketrc.local", "APPROVE", "");
    assert.equal(approved.status, "APPROVED");
    const shipped = await m.claims.recordClaimShipment(approved, "wh@pocketrc.local", { awb: `RPL${Date.now()}`, replacementOrderId: null });
    assert.equal(shipped.status, "REPLACEMENT_SHIPPED");
    const [inv] = await m.dbmod.db.select().from(m.schema.inventory).where(m.orm.and(m.orm.eq(m.schema.inventory.skuId, "pocket-bmw"), m.orm.eq(m.schema.inventory.variantSlug, "")));
    assert.equal(inv.stock, 1);
    await assert.rejects(m.claims.recordClaimShipment(shipped, "wh@pocketrc.local", { awb: "X", replacementOrderId: null }), /Approve the claim/);
  });
});

describe("refunds", () => {
  it("prepaid refunds the total; part-prepaid COD only the fee", () => {
    assert.equal(m.refunds.onlineRefundable({ paymentMethod: "UPI", paymentStatus: "CAPTURED", totalInr: 1099, confirmationFeeInr: 0, razorpayPaymentId: "p" }), 1099);
    assert.equal(m.refunds.onlineRefundable({ paymentMethod: "COD", paymentStatus: "CAPTURED", totalInr: 1099, confirmationFeeInr: 99, razorpayPaymentId: "p" }), 99);
  });

  it("dedupes by idempotency key, caps the amount, and only confirms on Razorpay's word", async () => {
    const o = await makeOrder({ status: "DELIVERED", deliveredDaysAgo: 3 });
    const key = `test:${randomUUID()}`;
    const a = await m.refunds.requestRefund({ orderId: o.id, amountInr: 1099, reason: "Defective unit", method: "RAZORPAY", requestedBy: "agent@x", idempotencyKey: key });
    const b = await m.refunds.requestRefund({ orderId: o.id, amountInr: 1099, reason: "Defective unit", method: "RAZORPAY", requestedBy: "agent@x", idempotencyKey: key });
    assert.equal(a.id, b.id, "same key → same case");
    await assert.rejects(
      m.refunds.requestRefund({ orderId: o.id, amountInr: 1, reason: "Second try", method: "RAZORPAY", requestedBy: "agent@x", idempotencyKey: `test:${randomUUID()}` }),
      /Nothing left to refund online/,
    );

    let calls = 0;
    const runTag = randomUUID().slice(0, 8);
    m.refunds.refundGateway.refund = async () => {
      calls++;
      return { id: `rfnd_${runTag}_${calls}`, status: "pending" };
    };
    const processing = await m.refunds.approveRefund(a, "finance@x");
    assert.equal(processing.status, "PROCESSING");
    assert.equal(processing.razorpayRefundId, `rfnd_${runTag}_1`);
    // A second approval — even from a stale copy still saying REQUESTED — is
    // stopped by the atomic REQUESTED → PROCESSING claim.
    await assert.rejects(m.refunds.approveRefund(a, "finance@x"), /already|Someone else/);
    assert.equal(calls, 1, "Razorpay called exactly once");
    let [ord] = await m.dbmod.db.select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, o.id));
    assert.equal(ord.paymentStatus, "CAPTURED", "not refunded until Razorpay confirms");

    const refundEntity = { id: `rfnd_${runTag}_1`, payment_id: ord.razorpayPaymentId, amount: 109900, status: "processed", notes: { refund_case_id: a.id } };
    assert.equal(await m.refunds.applyRazorpayRefundEvent("refund.processed", refundEntity), true);
    assert.equal(await m.refunds.applyRazorpayRefundEvent("refund.processed", refundEntity), true, "duplicate webhook is harmless");
    [ord] = await m.dbmod.db.select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, o.id));
    assert.equal(ord.paymentStatus, "REFUNDED");
    const done = await m.refunds.getRefundCase(a.id);
    assert.equal(done.status, "PROCESSED");
    const confirmations = emails.filter((e) => e.subject.startsWith("Refund of ₹1,099 completed"));
    assert.equal(confirmations.length, 1, "one confirmation email");
  });

  it("an ambiguous Razorpay error holds the refund, reconcile settles it", async () => {
    const o = await makeOrder({ status: "DELIVERED", deliveredDaysAgo: 3 });
    const c = await m.refunds.requestRefund({ orderId: o.id, amountInr: 500, reason: "Partial refund", method: "RAZORPAY", requestedBy: "agent@x", idempotencyKey: `test:${randomUUID()}` });
    m.refunds.refundGateway.refund = async () => {
      throw Object.assign(new Error("socket hang up"), { statusCode: undefined });
    };
    await assert.rejects(m.refunds.approveRefund(c, "finance@x"), /didn't answer clearly/);
    const held = await m.refunds.getRefundCase(c.id);
    assert.equal(held.status, "PROCESSING");
    m.refunds.refundGateway.listRefunds = async () => ({ items: [] });
    assert.match(await m.refunds.reconcileRefund(held, "finance@x"), /no such refund/);
    assert.equal((await m.refunds.getRefundCase(c.id)).status, "FAILED");
  });

  it("a COD bank transfer is only processed with a recorded reference", async () => {
    const o = await makeOrder({ status: "RETURNED", paymentMethod: "COD" });
    const c = await m.refunds.requestRefund({ orderId: o.id, amountInr: 999, reason: "Returned unopened", method: "MANUAL", requestedBy: "agent@x", idempotencyKey: `test:${randomUUID()}` });
    const approved = await m.refunds.approveRefund(c, "finance@x");
    assert.equal(approved.status, "APPROVED");
    await assert.rejects(m.refunds.recordManualRefund(approved, "finance@x", "x"), /UTR/);
    await m.refunds.recordManualRefund(approved, "finance@x", "UTR123456789");
    const done = await m.refunds.getRefundCase(c.id);
    assert.equal(done.status, "PROCESSED");
    assert.equal(done.providerStatus, "manual-transfer-recorded");
  });
});
