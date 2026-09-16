/** Offline regression checks. Uses synthetic events and an in-memory query stub; no database/network access. */
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { classifySource, shouldTrackPath } from "../src/lib/analytics";
import { cleanFunnelMetadata, cleanTrackingPath, isTrackingUuid } from "../src/lib/funnel-events";
import { parseAnalyticsRange } from "../src/lib/analytics-range";

async function main() {
  let checks = 0;
  const check = (label: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${label}`); };

  check("social campaign names, short links, and self-referrers", () => {
    for (const source of ["instagram", "ig", "facebook", " tiktok "]) assert.equal(classifySource({ utmSource: source }), "social");
    for (const referrerHost of ["t.co", "wa.me", "youtu.be", "l.instagram.com"]) assert.equal(classifySource({ referrerHost }), "social");
    assert.equal(classifySource({ referrerHost: "pocketrccars.com", selfHost: "www.pocketrccars.com:443" }), "direct");
    assert.equal(classifySource({ utmSource: "instagram", utmMedium: "paid_social" }), "paid");
  });
  check("operator pages and token-bearing query strings are excluded", () => {
    for (const path of ["/admin/analytics", "/cod", "/pack/orders", "/api/track", "/maintenance"]) assert.equal(shouldTrackPath(path), false);
    assert.equal(shouldTrackPath("/checkout"), true);
    assert.equal(cleanTrackingPath("/checkout?email=a@example.com#private"), "/checkout");
    assert.equal(cleanTrackingPath("https://other.example/path"), null);
  });
  check("metadata rejects PII keys, objects, invalid numbers, and contact details in provider errors", () => {
    assert.deepEqual(cleanFunnelMetadata({ email: "a@example.com", name: "Customer", address: { line1: "Private" }, totalInr: Infinity, pincode: "600001", reason: "a@example.com 9876543210", itemCount: 2 }), { pincode: "600001", reason: "[redacted] [redacted]", itemCount: 2 });
    assert.deepEqual(cleanFunnelMetadata(["not an object"]), {});
  });

  const storage = new Map<string, string>();
  const sent: Array<{ endpoint: string; body: { events?: Array<{ eventId: string; path: string }>; eventId?: string; consent?: string } }> = [];
  const pixels: unknown[][] = [];
  const ga: unknown[][] = [];
  const fakeWindow = Object.assign(new EventTarget(), {
    location: { pathname: "/", href: "https://www.pocketrccars.com/" },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null },
    gtag: (...args: unknown[]) => ga.push(args),
    fbq: (...args: unknown[]) => pixels.push(args),
  });
  const fakeDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: () => false }, configurable: true });
  globalThis.fetch = async (input, init) => {
    sent.push({ endpoint: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 204 });
  };
  const { trackFunnel } = await import("../src/lib/funnel-client");
  check("61 events are split without the old 30-event truncation", () => {
    for (let i = 0; i < 60; i++) trackFunnel("product_view", { skuId: String(i) });
    trackFunnel("add_to_cart", {}, { immediate: true });
    assert.deepEqual(sent.map((r) => r.body.events?.length), [30, 30, 1]);
    const events = sent.flatMap((r) => r.body.events ?? []);
    assert.equal(events.length, 61);
    assert.ok(events.every((e) => isTrackingUuid(e.eventId)));
    assert.equal(new Set(events.map((e) => e.eventId)).size, 61);
  });
  check("rejected sendBeacon falls back to fetch and operator views never send", () => {
    sent.length = 0;
    trackFunnel("page_view", {}, { path: "/admin/analytics", immediate: true });
    assert.equal(sent.length, 0);
    trackFunnel("view_cart");
    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sent.length, 1);
    trackFunnel("page_view", {}, { immediate: true }); // clear debounce timer
  });
  const { consentGranted, trackPurchase } = await import("../src/lib/analytics-client");
  check("purchase Pixel/CAPI share a stable order ID across visits; consent is required for Meta", () => {
    storage.set("prc_consent", "accepted");
    sent.length = pixels.length = 0;
    const order = { orderId: "synthetic-order", totalInr: 500, itemCount: 1, paymentMethod: "COD" as const };
    trackPurchase(order); trackPurchase(order);
    assert.deepEqual(sent.map((r) => r.body.eventId), ["purchase:synthetic-order", "purchase:synthetic-order"]);
    assert.ok(sent.every((r) => r.body.consent === "accepted"));
    assert.deepEqual(pixels.map((args) => args[3]), [{ eventID: "purchase:synthetic-order" }, { eventID: "purchase:synthetic-order" }]);
    storage.set("prc_consent", "declined");
    trackPurchase(order);
    assert.equal(sent.length, 2);
    assert.equal(ga.length, 3);
    assert.equal(consentGranted(), false);
  });
  check("blocked localStorage cannot break checkout analytics", () => {
    fakeWindow.localStorage.getItem = () => { throw new Error("Storage blocked"); };
    assert.equal(consentGranted(), false);
  });

  // Import only after marking build phase; postgres-js stays lazy. Every query
  // is intercepted before execution, even if the invoking shell has credentials.
  process.env.NEXT_PHASE = "phase-production-build";
  const { db } = await import("../src/db");
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  db.execute = (async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
    const statement = dialect.sqlToQuery(query);
    captured.push(statement);
    if (statement.sql.includes("FROM analytics_sessions")) return [{ c: 12 }];
    if (statement.sql.includes("FROM orders")) return [{ order: 4, paid: 3 }];
    if (statement.sql.includes("AS product")) return [{ product: 0, cart: 0, checkout: 0 }];
    return [{ c: 0, total: 0, blocked: 0 }];
  }) as typeof db.execute;
  const { getFunnelReport } = await import("../src/lib/funnel-queries");
  const range = parseAnalyticsRange({ year: "2024" });
  const report = await getFunnelReport(["synthetic-site"], 366, range);
  check("historical leap-year funnel uses both boundaries for every query", () => {
    assert.equal(report.windowDays, 366);
    assert.equal(captured.length, 7);
    for (const query of captured) {
      assert.ok(query.params.includes(range.start.toISOString()));
      assert.ok(query.params.includes(range.end.toISOString()));
      assert.match(query.sql, /< \$/);
    }
  });
  check("missing browser events never erase ledger buyers or invent a leak", () => {
    assert.equal(report.stages.find((s) => s.key === "order")?.visitors, 4);
    assert.equal(report.stages.find((s) => s.key === "paid")?.adjustedVisitors, 3);
    assert.equal(report.biggestLeak, null);
    assert.ok(report.anomalies.some((note) => note.includes("unmeasured")));
  });

  const { NextRequest } = await import("next/server");
  const eventIds = new Set<string>();
  let pageviewIncrements = 0;
  let transactions = 0;
  const fakeTx = {
    insert: () => ({ values: (values: Array<{ id: string; type: string }>) => ({ onConflictDoNothing: () => ({ returning: async () => values.filter((row) => {
      if (eventIds.has(row.id)) return false;
      eventIds.add(row.id); return true;
    }) }) }) }),
    update: () => ({ set: (values: { pageviewCount: Parameters<typeof dialect.sqlToQuery>[0] }) => ({ where: async () => {
      pageviewIncrements += Number(dialect.sqlToQuery(values.pageviewCount).params[0]);
    } }) }),
  };
  db.transaction = (async (fn: (tx: typeof fakeTx) => Promise<unknown>) => { transactions++; return fn(fakeTx); }) as unknown as typeof db.transaction;
  const visitor = "77777777-7777-4777-8777-777777777777";
  const session = "88888888-8888-4888-8888-888888888888";
  const headers = { "user-agent": "Mozilla/5.0 Chrome/130", cookie: `prc_vid=${visitor}; prc_sid=${session}` };
  const req = new NextRequest("https://www.pocketrccars.com/api/track/event", { method: "POST", headers });
  const { recordFunnelEvents, recordServerFunnelEvent } = await import("../src/lib/funnel-server");
  const event = { eventId: "99999999-9999-4999-8999-999999999999", type: "page_view", path: "/" };
  await recordFunnelEvents(req, [event]);
  await recordFunnelEvents(req, [event]);
  await recordServerFunnelEvent(req, "order_submitted", {}, { orderId: "synthetic-order" });
  await recordServerFunnelEvent(req, "order_submitted", {}, { orderId: "synthetic-order" });
  check("duplicate delivery increments pageviews once and order retries share one event", () => {
    assert.equal(eventIds.size, 2);
    assert.equal(pageviewIncrements, 1);
  });
  const { POST } = await import("../src/app/api/track/event/route");
  const before = transactions;
  for (const body of ["null", "[]", '{"events":[null,{}, {"type":"order_submitted"}]}']) {
    const result = await POST(new NextRequest("https://www.pocketrccars.com/api/track/event", { method: "POST", headers, body }));
    assert.equal(result.status, 204);
  }
  check("malformed batches and client-forged order events never reach the database", () => assert.equal(transactions, before));
  console.log(`\n${checks} tracking integrity regression groups passed. No live data was accessed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
