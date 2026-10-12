/**
 * Courier layer — deterministic unit tests (no network, no database).
 *
 *   node --import tsx --test scripts/tests/couriers.test.ts
 *   (or: npm test)
 *
 * Covers the pure routing engine (decideRoute / parcelFacts / quotesComparable),
 * the Delhivery tracking parsers and status mapping, and the Delhivery adapter
 * with `globalThis.fetch` replaced by an in-process stub. Every id here is
 * fictional (PRC-ABCD1234, 9999… waybills, example.com).
 *
 * The courier modules import the settings store, which imports the DB client.
 * The client is never connected: `db.select` is replaced so every settings
 * read fails at once and falls back to the code defaults — exactly what
 * happens in production when app_settings is unreachable. Nothing is written.
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  delhiveryLabel,
  parseDelhiveryTracking,
  parseDelhiveryWebhook,
  scanFingerprint,
} from "../../src/lib/tracking/carrier";
import { normalizeCarrierStatus } from "../../src/lib/tracking/status";
import type { CourierQuote, PickupResult, ShipmentRef } from "../../src/lib/couriers/types";
import type { ProviderAssessment, RoutingInput } from "../../src/lib/couriers/routing";
import type { CourierSettings } from "../../src/lib/couriers/settings";

process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
delete process.env.DATABASE_URL_POOLED;
process.env.DATABASE_POOL_MAX = "1";
process.env.DELHIVERY_API_TOKEN = "dlv-unit-token";
process.env.DELHIVERY_PICKUP_LOCATION = "Test Warehouse";
delete process.env.DELHIVERY_ENV;

// ---- fetch stub --------------------------------------------------------------
type Call = { url: string; method: string; body: string; headers: Headers };
const calls: Call[] = [];
let handler: (url: string, init?: RequestInit) => Response | Promise<Response> = (url) => {
  throw new Error(`unexpected fetch ${url}`);
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? ""), headers: new Headers(init?.headers) });
  return handler(url, init);
}) as typeof fetch;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function route(h: typeof handler) {
  calls.length = 0;
  handler = h;
}

let R: typeof import("../../src/lib/couriers/routing");
let S: typeof import("../../src/lib/couriers/settings");
let D: typeof import("../../src/lib/couriers/delhivery");
let H: typeof import("../../src/lib/couriers/health");
let C: typeof import("../../src/lib/couriers");

before(async () => {
  const { db } = await import("../../src/db");
  (db as unknown as { select: () => never }).select = () => {
    throw new Error("no database in unit tests");
  };
  R = await import("../../src/lib/couriers/routing");
  S = await import("../../src/lib/couriers/settings");
  D = await import("../../src/lib/couriers/delhivery");
  H = await import("../../src/lib/couriers/health");
  C = await import("../../src/lib/couriers");
});

// ---- routing fixtures ---------------------------------------------------------
function settings(over: Partial<CourierSettings> = {}): CourierSettings {
  return { ...S.DEFAULT_COURIER_SETTINGS, mode: "auto", delhiveryEnabled: true, ...over };
}
function quote(provider: "delhivery" | "shiprocket", rupees: number, over: Partial<CourierQuote> = {}): CourierQuote {
  return {
    provider,
    totalPaise: Math.round(rupees * 100),
    taxIncluded: true,
    confidence: "full",
    components: { freightPaise: null, codPaise: null, fuelPaise: null, remoteAreaPaise: null, otherPaise: null, taxPaise: null },
    courierName: provider === "delhivery" ? "Delhivery" : "Delhivery Surface",
    mode: "surface",
    chargedWeightGrams: 500,
    zone: "B",
    source: "test",
    quotedAt: "2026-10-12T05:00:00.000Z",
    ...over,
  };
}
function assess(provider: "delhivery" | "shiprocket", over: Partial<ProviderAssessment> = {}): ProviderAssessment {
  return {
    provider,
    enabled: true,
    disabledReason: null,
    healthy: true,
    serviceable: true,
    codAvailable: true,
    quote: null,
    bookingCommits: provider === "delhivery",
    error: null,
    ...over,
  };
}
function input(over: Partial<RoutingInput> & { d?: Partial<ProviderAssessment>; s?: Partial<ProviderAssessment> } = {}): RoutingInput {
  const { d, s, ...rest } = over;
  const st = rest.settings ?? settings();
  return {
    pincode: "560038",
    paymentMethod: "Prepaid",
    orderValueInr: 1099,
    parcel: st.parcel,
    assessments: [assess("delhivery", d), assess("shiprocket", s)],
    settings: st,
    ...rest,
  };
}
const eligibility = (v: { eligibility: Array<{ provider: string; eligible: boolean; reason: string | null }> }, p: string) =>
  v.eligibility.find((e) => e.provider === p)!;

describe("routing: decideRoute", () => {
  it("#1 Delhivery serviceable and cheaper (requireCheaper, both full quotes) → Delhivery", () => {
    const v = R.decideRoute(
      input({ settings: settings({ requireCheaper: true }), d: { quote: quote("delhivery", 80) }, s: { quote: quote("shiprocket", 95) } }),
    );
    assert.equal(v.recommended, "delhivery");
    assert.equal(v.reasonCode, "PREFERRED_CHEAPER");
    assert.equal(v.comparable, true);
    assert.equal(v.savingsPaise, 1500);
  });

  it("#2 Delhivery serviceable but dearer (requireCheaper) → Shiprocket", () => {
    const v = R.decideRoute(
      input({ settings: settings({ requireCheaper: true }), d: { quote: quote("delhivery", 120) }, s: { quote: quote("shiprocket", 95) } }),
    );
    assert.equal(v.recommended, "shiprocket");
    assert.equal(v.reasonCode, "ALTERNATIVE_CHEAPER");
    assert.equal(v.savingsPaise, 2500);
  });

  it("#3 Delhivery not serviceable, Shiprocket serviceable → FALLBACK to Shiprocket", () => {
    const v = R.decideRoute(input({ d: { serviceable: false, codAvailable: false } }));
    assert.equal(v.recommended, "shiprocket");
    assert.equal(v.reasonCode, "FALLBACK");
    assert.match(eligibility(v, "delhivery").reason ?? "", /does not deliver/);
    assert.equal(v.savingsPaise, null, "no savings claimed when the other provider couldn't serve it");
  });

  it("#4 both serviceable, default policy → the preferred provider (Delhivery)", () => {
    const v = R.decideRoute(input({ d: { quote: quote("delhivery", 90.52) }, s: { quote: quote("shiprocket", 95, { confidence: "partial", taxIncluded: null }) } }));
    assert.equal(v.recommended, "delhivery");
    assert.equal(v.reasonCode, "PREFERRED_ELIGIBLE");
    assert.equal(v.comparable, false, "full vs partial is not a like-for-like comparison");
    assert.equal(v.savingsPaise, null);
    const sr = R.decideRoute(input({ settings: settings({ preferred: "shiprocket" }) }));
    assert.equal(sr.recommended, "shiprocket");
    assert.equal(sr.reasonCode, "PREFERRED_ELIGIBLE");
  });

  it("#5 only Shiprocket configured → Shiprocket (fallback), or staff review when fallback=review", () => {
    const d = { enabled: false, disabledReason: "Delhivery credentials are not configured", serviceable: null, codAvailable: null };
    const v = R.decideRoute(input({ d }));
    assert.equal(v.recommended, "shiprocket");
    assert.equal(v.reasonCode, "FALLBACK");
    assert.match(v.reason, /credentials are not configured/);
    const review = R.decideRoute(input({ d, settings: settings({ fallback: "review" }) }));
    assert.equal(review.recommended, null);
    assert.equal(review.reasonCode, "NO_ELIGIBLE_PROVIDER");
  });

  it("#6 neither eligible → staff review (NO_ELIGIBLE_PROVIDER) with both reasons", () => {
    const v = R.decideRoute(input({ d: { serviceable: false }, s: { serviceable: false } }));
    assert.equal(v.recommended, null);
    assert.equal(v.reasonCode, "NO_ELIGIBLE_PROVIDER");
    assert.match(v.reason, /Delhivery does not deliver/);
    assert.match(v.reason, /Shiprocket does not deliver/);
  });

  it("an unverified Delhivery lane (serviceability unknown) is never booked; an unverified Shiprocket lane may be", () => {
    const v = R.decideRoute(input({ d: { serviceable: null, codAvailable: null, error: "serviceability check failed" } }));
    assert.equal(v.recommended, "shiprocket");
    assert.match(eligibility(v, "delhivery").reason ?? "", /could not be checked \(serviceability check failed\)/);
    const s = R.decideRoute(input({ settings: settings({ preferred: "shiprocket" }), s: { serviceable: null, codAvailable: null } }));
    assert.equal(s.recommended, "shiprocket");
  });

  it("an open circuit breaker makes a provider ineligible", () => {
    const v = R.decideRoute(input({ d: { healthy: false } }));
    assert.equal(v.recommended, "shiprocket");
    assert.match(eligibility(v, "delhivery").reason ?? "", /paused/);
  });

  it("#15 COD: like-for-like COD quotes decide on cost; no COD on the lane / COD switched off → the other provider", () => {
    const cheap = R.decideRoute(
      input({
        paymentMethod: "COD",
        settings: settings({ requireCheaper: true }),
        d: { quote: quote("delhivery", 92) },
        s: { quote: quote("shiprocket", 118) },
      }),
    );
    assert.equal(cheap.recommended, "delhivery");
    assert.equal(cheap.savingsPaise, 2600);
    const noCod = R.decideRoute(input({ paymentMethod: "COD", d: { codAvailable: false } }));
    assert.equal(noCod.recommended, "shiprocket");
    assert.match(eligibility(noCod, "delhivery").reason ?? "", /no cash on delivery/);
    const off = R.decideRoute(input({ paymentMethod: "COD", settings: settings({ delhiveryCod: false }) }));
    assert.equal(off.recommended, "shiprocket");
    assert.match(eligibility(off, "delhivery").reason ?? "", /COD is not allowed on Delhivery/);
    // Prepaid is unaffected by the COD switch.
    assert.equal(R.decideRoute(input({ settings: settings({ delhiveryCod: false }) })).recommended, "delhivery");
  });

  it("#16 prepaid: full vs partial / GST-unknown quotes never compare at minRateConfidence=full", () => {
    const s = settings({ requireCheaper: true });
    const dFull = quote("delhivery", 120);
    // Shiprocket is cheaper on paper but its quote is partial → cost can't decide.
    assert.equal(R.quotesComparable(dFull, quote("shiprocket", 95, { confidence: "partial", taxIncluded: null }), s), false);
    // Both "full" but one doesn't state GST → not comparable.
    assert.equal(R.quotesComparable(dFull, quote("shiprocket", 95, { taxIncluded: null }), s), false);
    // Different tax bases → not comparable.
    assert.equal(R.quotesComparable(dFull, quote("shiprocket", 95, { taxIncluded: false }), s), false);
    assert.equal(R.quotesComparable(dFull, quote("shiprocket", 95), s), true);
    // Explicitly accepting partial quotes makes them comparable.
    assert.equal(R.quotesComparable(dFull, quote("shiprocket", 95, { confidence: "partial", taxIncluded: null }), settings({ minRateConfidence: "partial" })), true);

    const v = R.decideRoute(input({ settings: s, d: { quote: dFull }, s: { quote: quote("shiprocket", 95, { confidence: "partial", taxIncluded: null }) } }));
    assert.equal(v.recommended, "delhivery", "an unverifiable cheaper price never overrides the preference");
    assert.equal(v.reasonCode, "PREFERRED_COST_UNVERIFIED");
    assert.equal(v.savingsPaise, null);
    const review = R.decideRoute(
      input({ settings: settings({ requireCheaper: true, fallback: "review" }), d: { quote: dFull }, s: { quote: quote("shiprocket", 95, { confidence: "partial", taxIncluded: null }) } }),
    );
    assert.equal(review.recommended, null);
    assert.equal(review.reasonCode, "COST_UNVERIFIED_REVIEW");

    const off = R.decideRoute(input({ settings: settings({ delhiveryPrepaid: false }) }));
    assert.equal(off.recommended, "shiprocket");
    assert.match(eligibility(off, "delhivery").reason ?? "", /Prepaid is not allowed on Delhivery/);
  });

  it("#16 maxRateInr: an unverified quote is ineligible; a full quote is held to the cap", () => {
    const capped = settings({ maxRateInr: 100 });
    const unverified = R.decideRoute(
      input({ settings: capped, d: { quote: quote("delhivery", 80) }, s: { quote: quote("shiprocket", 60, { confidence: "partial", taxIncluded: null }) } }),
    );
    assert.equal(eligibility(unverified, "shiprocket").eligible, false);
    assert.match(eligibility(unverified, "shiprocket").reason ?? "", /could not be verified against the ₹100 cap/);
    assert.equal(unverified.recommended, "delhivery");
    const noQuote = R.decideRoute(input({ settings: capped, d: { quote: null }, s: { quote: quote("shiprocket", 60) } }));
    assert.equal(eligibility(noQuote, "delhivery").eligible, false);
    assert.equal(noQuote.recommended, "shiprocket");
    const above = R.decideRoute(input({ settings: capped, d: { quote: quote("delhivery", 100.01) }, s: { quote: quote("shiprocket", 99) } }));
    assert.match(eligibility(above, "delhivery").reason ?? "", /above the ₹100 cap/);
    assert.equal(above.recommended, "shiprocket");
    const atCap = R.decideRoute(input({ settings: capped, d: { quote: quote("delhivery", 100) }, s: { quote: quote("shiprocket", 99) } }));
    assert.equal(atCap.recommended, "delhivery");
  });

  it("#17 missing / invalid parcel dimensions → INVALID_PARCEL (and a bad pincode → INVALID_PINCODE)", () => {
    for (const parcel of [
      { weightGrams: 300, lengthCm: 0, breadthCm: 18, heightCm: 4 },
      { weightGrams: Number.NaN, lengthCm: 25, breadthCm: 18, heightCm: 4 },
      { weightGrams: 300, lengthCm: 25, breadthCm: -1, heightCm: 4 },
      { weightGrams: 300, lengthCm: 25, breadthCm: 18 } as never,
    ]) {
      const v = R.decideRoute(input({ parcel }));
      assert.equal(v.recommended, null);
      assert.equal(v.reasonCode, "INVALID_PARCEL");
      assert.equal(v.parcel, null);
    }
    assert.equal(R.decideRoute(input({ pincode: "56003" })).reasonCode, "INVALID_PINCODE");
    assert.equal(R.decideRoute(input({ pincode: "060038" })).reasonCode, "INVALID_PINCODE");
  });

  it("orders above the review threshold wait for staff", () => {
    const v = R.decideRoute(input({ orderValueInr: 5000, settings: settings({ reviewAboveInr: 2000 }) }));
    assert.equal(v.recommended, null);
    assert.equal(v.reasonCode, "REVIEW_ORDER_VALUE");
  });

  it("#18 chargeable weight = max(dead weight, volumetric L×B×H÷5000)", () => {
    const poly = R.parcelFacts({ weightGrams: 300, lengthCm: 25, breadthCm: 18, heightCm: 4 })!;
    assert.equal(poly.volumetricGrams, 360);
    assert.equal(poly.chargeableGrams, 360, "volumetric wins for a light, bulky parcel");
    const heavy = R.parcelFacts({ weightGrams: 700, lengthCm: 25, breadthCm: 18, heightCm: 4 })!;
    assert.equal(heavy.chargeableGrams, 700, "dead weight wins for a dense parcel");
    const box = R.parcelFacts({ weightGrams: 300, lengthCm: 20, breadthCm: 15, heightCm: 10 })!;
    assert.equal(box.volumetricGrams, 600);
    assert.equal(box.chargeableGrams, 600);
    assert.equal(R.parcelFacts({ weightGrams: 0, lengthCm: 25, breadthCm: 18, heightCm: 4 }), null);
  });
});

describe("courier settings", () => {
  it("merges stored overrides field by field and drops invalid values", () => {
    const s = S.resolveCourierSettings({ mode: "auto", delhiveryEnabled: "yes", maxRateInr: -5, parcel: { weightGrams: 10 }, bogus: 1 });
    assert.equal(s.mode, "auto");
    assert.equal(s.delhiveryEnabled, false, "a non-boolean switch keeps the safe default");
    assert.equal(s.maxRateInr, null);
    assert.deepEqual(s.parcel, S.DEFAULT_COURIER_SETTINGS.parcel);
    assert.equal(S.resolveCourierSettings(null).mode, "shadow", "ships in shadow mode");
    assert.equal(S.DEFAULT_COURIER_SETTINGS.delhiveryEnabled, false, "Delhivery booking ships disabled");
  });

  it("booking-state helpers: a Delhivery waybill is a completed booking; Shiprocket's legacy 'undefined' is not", () => {
    assert.equal(C.hasCompletedBooking({ courierProvider: "delhivery", shiprocketOrderId: null, awbCode: "9999000011112" }), true);
    assert.equal(C.hasCompletedBooking({ courierProvider: "delhivery", shiprocketOrderId: null, awbCode: null }), false);
    assert.equal(C.hasCompletedBooking({ courierProvider: "shiprocket", shiprocketOrderId: "undefined", awbCode: "X1" }), false);
    assert.equal(C.hasCompletedBooking({ courierProvider: "shiprocket", shiprocketOrderId: "123456", awbCode: "X1" }), true);
    assert.equal(C.courierBookingRef({ courierProvider: "delhivery", shiprocketOrderId: null, awbCode: "9999000011112" }), "9999000011112");
    assert.deepEqual(C.shipmentRefOf({ courierProvider: "shiprocket", shiprocketOrderId: "undefined", shiprocketShipmentId: "undefined", awbCode: "" }), {
      awb: null,
      shipmentId: null,
      providerOrderId: null,
    });
  });
});

// ---- Delhivery tracking ------------------------------------------------------
const dlvScan = (at: string, type: string, scan: string, code: string, instructions: string, location: string) => ({
  ScanDetail: { ScanDateTime: at, ScanType: type, Scan: scan, StatusCode: code, Instructions: instructions, ScannedLocation: location, StatusDateTime: at },
});
function dlvTrack(status: { type: string; status: string; code?: string; at: string; instructions?: string }, scans: unknown[]) {
  return {
    ShipmentData: [
      {
        Shipment: {
          AWB: "9999000011112",
          ReferenceNo: "PRC-ABCD1234",
          Status: { Status: status.status, StatusType: status.type, StatusCode: status.code, StatusDateTime: status.at, Instructions: status.instructions ?? "", StatusLocation: "Chennai_Hub (Tamil Nadu)" },
          Scans: scans,
          ExpectedDeliveryDate: "2026-10-11T23:59:59",
          PickedupDate: "2026-10-08T18:10:00",
        },
      },
    ],
  };
}
const label = (t: string, s: string, c: string | null = null) => normalizeCarrierStatus(delhiveryLabel(t, s, c));

describe("Delhivery tracking parsers", () => {
  it("#12 several scans with the same normalised status stay distinct events (different fingerprints)", () => {
    const snap = parseDelhiveryTracking(
      dlvTrack({ type: "UD", status: "In Transit", at: "2026-10-09T14:00:00" }, [
        dlvScan("2026-10-08T18:10:00", "UD", "In Transit", "X-PPOM", "Shipment picked up", "Bengaluru_Hub (Karnataka)"),
        dlvScan("2026-10-09T02:40:00", "UD", "In Transit", "X-DLL2F", "Shipment Received at Facility", "Hosur_Hub (Tamil Nadu)"),
        dlvScan("2026-10-09T14:00:00", "UD", "In Transit", "X-DLL2F", "Shipment Received at Facility", "Chennai_Hub (Tamil Nadu)"),
        // The very same scan delivered twice is one event.
        dlvScan("2026-10-09T14:00:00", "UD", "In Transit", "X-DLL2F", "Shipment Received at Facility", "Chennai_Hub (Tamil Nadu)"),
      ]),
    )!;
    assert.ok(snap);
    assert.equal(snap.scans.length, 3);
    assert.ok(snap.scans.every((s) => normalizeCarrierStatus(s.label) === "IN_TRANSIT"));
    assert.equal(new Set(snap.scans.map(scanFingerprint)).size, 3);
    assert.equal(snap.courierName, "Delhivery");
    assert.equal(snap.trackUrl, "https://www.delhivery.com/track-v2/package/9999000011112");
    assert.equal(snap.edd?.toISOString(), "2026-10-11T18:29:59.000Z", "offset-less Delhivery times are IST");
    assert.equal(snap.scans[0].at.toISOString(), "2026-10-08T12:40:00.000Z");
  });

  it("#13 delivery exception: UD Pending + EOD-11 → Undelivered → DELIVERY_ATTEMPTED; LT Lost → EXCEPTION", () => {
    assert.equal(delhiveryLabel("UD", "Pending", "EOD-11"), "Undelivered");
    assert.equal(label("UD", "Pending", "EOD-11"), "DELIVERY_ATTEMPTED");
    assert.equal(label("UD", "Pending", "EOD-38"), "IN_TRANSIT", "EOD-38 is not a failed attempt");
    assert.equal(label("UD", "Pending", null), "IN_TRANSIT");
    assert.equal(label("LT", "Lost"), "EXCEPTION");
    const snap = parseDelhiveryTracking(
      dlvTrack({ type: "UD", status: "Pending", code: "EOD-11", at: "2026-10-10T17:00:00", instructions: "Consignee unavailable" }, [
        dlvScan("2026-10-10T17:00:00", "UD", "Pending", "EOD-11", "Consignee unavailable", "Chennai_DC (Tamil Nadu)"),
      ]),
    )!;
    assert.equal(snap.currentLabel, "Undelivered");
    assert.equal(normalizeCarrierStatus(snap.currentLabel), "DELIVERY_ATTEMPTED");
    assert.equal(snap.reason, "Consignee unavailable");
    assert.equal(snap.deliveredAt, null);
  });

  it("#14 RTO: RT In Transit → RTO_IN_TRANSIT, DL RTO → RTO_DELIVERED, UD Dispatched → OUT_FOR_DELIVERY, RT Dispatched stays RTO", () => {
    assert.equal(label("RT", "In Transit"), "RTO_IN_TRANSIT");
    assert.equal(label("RT", "Pending"), "RTO_IN_TRANSIT");
    assert.equal(label("DL", "RTO"), "RTO_DELIVERED");
    assert.equal(label("UD", "Dispatched"), "OUT_FOR_DELIVERY");
    assert.equal(delhiveryLabel("RT", "Dispatched", null), "RTO Out for Delivery");
    assert.equal(label("RT", "Dispatched"), "RTO_IN_TRANSIT");
    // The rest of the lifecycle.
    assert.equal(label("UD", "Manifested"), "AWAITING_PICKUP");
    assert.equal(label("UD", "Not Picked"), "AWAITING_PICKUP");
    assert.equal(label("UD", "In Transit"), "IN_TRANSIT");
    assert.equal(label("DL", "Delivered"), "DELIVERED");
    assert.equal(label("CN", "Canceled"), "CANCELLED");
    const rto = parseDelhiveryTracking(dlvTrack({ type: "DL", status: "RTO", at: "2026-10-15T12:00:00" }, []))!;
    assert.equal(rto.currentLabel, "RTO Delivered");
    assert.equal(rto.deliveredAt, null, "an RTO delivery is not a customer delivery");
    const delivered = parseDelhiveryTracking(dlvTrack({ type: "DL", status: "Delivered", at: "2026-10-11T13:05:00" }, []))!;
    assert.equal(delivered.deliveredAt?.toISOString(), "2026-10-11T07:35:00.000Z");
  });

  it("an HTTP-200 'no such waybill' body is not a tracking answer → null", () => {
    assert.equal(parseDelhiveryTracking({ Success: false, Error: "Data does not exists for provided Waybill(s)" }), null);
    assert.equal(parseDelhiveryTracking({ ShipmentData: [] }), null);
    assert.equal(parseDelhiveryTracking(null), null);
  });

  it("scan-push webhook → one-scan snapshot", () => {
    const snap = parseDelhiveryWebhook({
      Shipment: {
        AWB: "9999000011112",
        ReferenceNo: "PRC-ABCD1234",
        NSLCode: "X-DDD3FD",
        Status: { Status: "Dispatched", StatusType: "UD", StatusDateTime: "2026-10-10T09:30:00.000", StatusLocation: "Chennai_DC (Tamil Nadu)", Instructions: "Out for delivery" },
      },
    })!;
    assert.equal(snap.currentLabel, "Out for Delivery");
    assert.equal(snap.scans.length, 1);
    assert.equal(normalizeCarrierStatus(snap.scans[0].label), "OUT_FOR_DELIVERY");
    assert.equal(parseDelhiveryWebhook({}), null);
  });
});

// ---- Delhivery adapter (fetch stubbed) ----------------------------------------
describe("Delhivery adapter", () => {
  const ref = (awb: string | null): ShipmentRef => ({ awb, shipmentId: null, providerOrderId: null });

  it("serviceability: listed pincode; empty delivery_codes → not serviceable; Embargo → not serviceable; HTTP 500 → null", async () => {
    const pin = (p: Record<string, unknown>) => json(200, { delivery_codes: [{ postal_code: { pin: 560038, ...p } }] });
    route(() => pin({ pre_paid: "Y", cod: "Y", remarks: "" }));
    assert.deepEqual(await D.delhiveryAdapter.serviceability("560038"), { serviceable: true, codAvailable: true });
    assert.match(calls[0].url, /\/c\/api\/pin-codes\/json\/\?filter_codes=560038$/);
    assert.equal(calls[0].headers.get("authorization"), "Token dlv-unit-token");

    route(() => pin({ pre_paid: "Y", cod: "N", remarks: "" }));
    assert.deepEqual(await D.delhiveryAdapter.serviceability("560038"), { serviceable: true, codAvailable: false });

    route(() => json(200, { delivery_codes: [] }));
    assert.deepEqual(await D.delhiveryAdapter.serviceability("560038"), { serviceable: false, codAvailable: false });

    route(() => pin({ pre_paid: "Y", cod: "Y", remarks: "Embargo" }));
    assert.deepEqual(await D.delhiveryAdapter.serviceability("560038"), { serviceable: false, codAvailable: false });

    route(() => json(500, { error: "upstream" }));
    assert.equal(await D.delhiveryAdapter.serviceability("560038"), null, "an outage is never 'not serviceable'");

    route(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await D.delhiveryAdapter.serviceability("560038"), null);

    route(() => json(200, {}));
    assert.equal(await D.delhiveryAdapter.serviceability("12345"), null);
    assert.equal(calls.length, 0, "an invalid pincode is never sent");
  });

  it("quote: parses the real invoice-charges sample into a FULL, tax-included quote", async () => {
    const sample = [
      {
        status: "Delivered",
        zone: "B",
        charge_DL: 33,
        charge_COD: 40,
        charge_DPH: 1.22,
        charge_LM: 2.5,
        gross_amount: 76.72,
        total_amount: 90.52,
        charged_weight: 500,
        tax_data: { SGST: 6.9, CGST: 6.9, IGST: 0 },
      },
    ];
    route(() => json(200, sample));
    const q = (await D.delhiveryAdapter.quote({
      originPincode: "560043",
      pincode: "560038",
      cod: true,
      codAmountInr: 1099,
      declaredValueInr: 1099,
      parcel: { weightGrams: 360, lengthCm: 25, breadthCm: 18, heightCm: 4 },
    }))!;
    assert.equal(q.totalPaise, 9052);
    assert.equal(q.taxIncluded, true);
    assert.equal(q.confidence, "full");
    assert.equal(q.components.taxPaise, 1380);
    assert.equal(q.components.freightPaise, 3300);
    assert.equal(q.components.codPaise, 4000);
    assert.equal(q.components.otherPaise, 372, "unlisted charge_* lines are kept, not dropped");
    assert.equal(q.chargedWeightGrams, 500);
    assert.equal(q.zone, "B");
    assert.equal(q.mode, "surface");
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, "/api/kinko/v1/invoice/charges/.json");
    assert.equal(u.searchParams.get("md"), "S");
    assert.equal(u.searchParams.get("cgm"), "360");
    assert.equal(u.searchParams.get("pt"), "COD");
    assert.equal(u.searchParams.get("cod"), "1099");

    route(() => json(200, [{ total_amount: 0 }]));
    assert.equal(
      await D.delhiveryAdapter.quote({ originPincode: "560043", pincode: "560038", cod: false, codAmountInr: 0, declaredValueInr: 1099, parcel: { weightGrams: 360, lengthCm: 25, breadthCm: 18, heightCm: 4 } }),
      null,
    );
  });

  it("#7 auth failure: 401 → DelhiveryApiError, read as a refusal (opens the breaker); credentials redacted", async () => {
    route(() => json(401, { detail: "Invalid token" }));
    let err: unknown;
    try {
      await D.delhiveryAdapter.track(ref("9999000011112"));
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof D.DelhiveryApiError);
    assert.equal(err.status, 401);
    assert.equal(H.isCourierRefusal(err), true);
    assert.equal(H.isCourierRefusal(new D.DelhiveryApiError("x", 403)), true);
    assert.equal(H.isCourierRefusal(new D.DelhiveryApiError("x", 429)), true);
    assert.equal(H.isCourierRefusal(new D.DelhiveryApiError("x", 500)), false);
    assert.equal(H.isCourierRefusal(new Error("timeout")), false);
    assert.equal(H.redactCourierError("Authorization: Token dlv-unit-token failed"), "Authorization: Token *** failed");
    await assert.rejects(D.delhiveryAdapter.findBooking("PRC-ABCD1234"), (e: unknown) => e instanceof D.DelhiveryApiError && e.status === 401);
  });

  it("track: an unknown waybill answered with HTTP 200 is a failed sync, never 'no news'", async () => {
    route(() => json(200, { Success: false, Error: "Data does not exists for provided Waybill(s)" }));
    await assert.rejects(D.delhiveryAdapter.track(ref("9999000011112")), /Unrecognised Delhivery tracking response/);
    await assert.rejects(D.delhiveryAdapter.track(ref(null)), /waybill only/);
  });

  it("#10 pickup: 'already exists' is a soft success; 'ClientWarehouse matching query does not exist.' is NOT", async () => {
    const refs = [ref("9999000011112")];
    route(() => json(200, { pickup_id: 4321, pickup_date: "2026-10-13", pickup_location_name: "Test Warehouse" }));
    const ok = await D.delhiveryAdapter.schedulePickup(refs);
    assert.equal(ok.ok, true);
    assert.equal(ok.pickupId, "4321");
    assert.equal(ok.alreadyScheduled, false);
    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.pickup_location, "Test Warehouse");
    assert.equal(sent.expected_package_count, 1);

    route(() => json(200, { error: "A Pickup Request 123 for this Pickup Location Already Exist." }));
    const dup = await D.delhiveryAdapter.schedulePickup(refs);
    assert.equal(dup.ok, true);
    assert.equal(dup.alreadyScheduled, true);

    route(() => json(400, { pr_exist: true, error: { message: "A Pickup Request 123 for this Pickup Location Already Exist." } }));
    const dupHttp = await D.delhiveryAdapter.schedulePickup(refs);
    assert.equal(dupHttp.ok, true);
    assert.equal(dupHttp.alreadyScheduled, true);

    route(() => json(200, { error: "ClientWarehouse matching query does not exist." }));
    const bad = await D.delhiveryAdapter.schedulePickup(refs);
    assert.equal(bad.ok, false);
    assert.equal(bad.alreadyScheduled, false);
    assert.match(bad.message, /ClientWarehouse matching query does not exist/);

    route(() => json(400, { error: "ClientWarehouse matching query does not exist." }));
    const badHttp = await D.delhiveryAdapter.schedulePickup(refs);
    assert.equal(badHttp.ok, false);
    assert.equal(badHttp.alreadyScheduled, false);
  });

  it("pickup date: before 13:00 IST asks for today, after that for tomorrow", async () => {
    const schedule = D.delhiveryAdapter.schedulePickup as unknown as (r: ShipmentRef[], now: Date) => Promise<PickupResult>;
    route(() => json(200, { pickup_id: 1 }));
    await schedule([ref("9999000011112")], new Date("2026-10-12T10:00:00+05:30"));
    assert.equal(JSON.parse(calls[0].body).pickup_date, "2026-10-12");
    route(() => json(200, { pickup_id: 2 }));
    await schedule([ref("9999000011112")], new Date("2026-10-12T15:00:00+05:30"));
    assert.equal(JSON.parse(calls[0].body).pickup_date, "2026-10-13");
  });

  it("#25 label: packing_slip pdf_download_link → url; no packages → null; no waybill → no call", async () => {
    route(() => json(200, { packages: [{ wbn: "9999000011112", pdf_download_link: "https://example.com/label-9999000011112.pdf" }], packages_found: 1 }));
    assert.deepEqual(await D.delhiveryAdapter.label(ref("9999000011112")), { url: "https://example.com/label-9999000011112.pdf" });
    assert.match(calls[0].url, /\/api\/p\/packing_slip\?wbns=9999000011112&pdf=true/);
    route(() => json(200, { packages: null, packages_found: 0 }));
    assert.deepEqual(await D.delhiveryAdapter.label(ref("9999000011112")), { url: null });
    route(() => json(200, {}));
    assert.deepEqual(await D.delhiveryAdapter.label(ref(null)), { url: null });
    assert.equal(calls.length, 0);
    await assert.rejects(D.delhiveryAdapter.manifest([ref("9999000011112")]), /does not support manifest/);
  });

  it("book: waybill on success; outright refusal vs 'partially saved' vs duplicate order id", async () => {
    const booking = {
      orderId: "PRC-ABCD1234",
      orderPlacedAt: new Date("2026-10-12T05:00:00Z"),
      customer: { name: "Test Buyer & Co", phone: "+91 99999 99999", line1: "1 MG Road #4", city: "Bengaluru", state: "Karnataka", pincode: "560038" },
      items: [{ name: "Pocket BMW", sku: "pocket-bmw", units: 2, unitPriceInr: 1099 }],
      invoiceValueInr: 2198,
      codAmountInr: 0,
      paymentMethod: "Prepaid" as const,
      parcel: { weightGrams: 300, lengthCm: 25, breadthCm: 18, heightCm: 4 },
    };
    route(() => json(200, { success: true, upload_wbn: "UPL-TEST-1", packages: [{ waybill: "9999000011112", refnum: "PRC-ABCD1234", status: "Success", remarks: [] }] }));
    const r = await D.delhiveryAdapter.book(booking);
    assert.equal(r.awb, "9999000011112");
    assert.equal(r.providerOrderId, null);
    assert.equal(r.shipmentId, null);
    assert.equal(r.requestId, "UPL-TEST-1");
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get("format"), "json");
    const data = JSON.parse(form.get("data")!);
    assert.equal(data.pickup_location.name, "Test Warehouse");
    const sh = data.shipments[0];
    assert.equal(sh.order, "PRC-ABCD1234");
    assert.equal(sh.waybill, "", "Delhivery assigns the waybill");
    assert.equal(sh.phone, "9999999999");
    assert.equal(sh.name, "Test Buyer Co", "characters Delhivery rejects are stripped");
    assert.equal(sh.add, "1 MG Road 4");
    assert.equal(sh.payment_mode, "Prepaid");
    assert.equal(sh.cod_amount, "0");
    assert.equal(sh.quantity, "2");
    assert.equal(sh.shipping_mode, "Surface");

    route(() => json(200, { success: false, rmk: "ClientWarehouse matching query does not exist.", packages: [] }));
    await assert.rejects(D.delhiveryAdapter.book(booking), (e: unknown) => e instanceof D.DelhiveryRejectedError && /ClientWarehouse/.test(e.remark));

    const partial = "Crashing while saving package due to exception 'Prepaid client manifest charge API failed due to insufficient balance'. Package might have been partially saved.";
    route(() => json(200, { success: false, rmk: partial, packages: [{ status: "Fail", waybill: "", refnum: "PRC-ABCD1234", remarks: [partial] }] }));
    await assert.rejects(D.delhiveryAdapter.book(booking), (e: unknown) => e instanceof D.DelhiveryAmbiguousError);

    route((u) =>
      u.includes("/api/cmu/create.json")
        ? json(200, { success: false, packages: [{ status: "Fail", waybill: "", refnum: "PRC-ABCD1234", remarks: ["Duplicate order id"] }] })
        : json(200, { ShipmentData: [{ Shipment: { AWB: "9999000011112", ReferenceNo: "PRC-ABCD1234", Status: { Status: "Manifested", StatusType: "UD" } } }] }),
    );
    const adopted = await D.delhiveryAdapter.book(booking);
    assert.equal(adopted.awb, "9999000011112", "a duplicate order id adopts the existing booking");
    assert.match(calls[1].url, /ref_ids=PRC-ABCD1234/);

    route(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await assert.rejects(
      D.delhiveryAdapter.book(booking),
      (e: unknown) => !(e instanceof D.DelhiveryRejectedError) && !(e instanceof D.DelhiveryAmbiguousError),
      "a timeout is neither a refusal nor 'partially saved' — create-shipment reconciles it",
    );
  });

  it("findBooking: matches our order id, skips cancelled shipments, null when unknown", async () => {
    route(() =>
      json(200, {
        ShipmentData: [
          { Shipment: { AWB: "9999000000001", ReferenceNo: "PRC-ABCD1234", Status: { Status: "Canceled", StatusType: "CN" } } },
          { Shipment: { AWB: "9999000000002", ReferenceNo: "PRC-OTHER123", Status: { Status: "Manifested", StatusType: "UD" } } },
          { Shipment: { AWB: "9999000000003", ReferenceNo: "PRC-ABCD1234", Status: { Status: "Manifested", StatusType: "UD" } } },
        ],
      }),
    );
    assert.deepEqual(await D.delhiveryAdapter.findBooking("PRC-ABCD1234"), { awb: "9999000000003" });
    route(() => json(200, { Error: "No such waybill or Order Id found" }));
    assert.equal(await D.delhiveryAdapter.findBooking("PRC-ABCD1234"), null);
  });

  it("cancel: status true → ok; no waybill → refused locally", async () => {
    route(() => json(200, { status: true, remark: "Shipment has been cancelled" }));
    assert.deepEqual(await D.delhiveryAdapter.cancel(ref("9999000011112")), { ok: true, message: "Shipment has been cancelled" });
    assert.deepEqual(JSON.parse(calls[0].body), { waybill: "9999000011112", cancellation: "true" });
    route(() => json(200, {}));
    assert.equal((await D.delhiveryAdapter.cancel(ref(null))).ok, false);
    assert.equal(calls.length, 0);
  });
});
