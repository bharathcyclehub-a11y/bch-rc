/**
 * Tracking rules — deterministic, fixed-clock tests (no DB, no network).
 *
 *   node --import tsx --test scripts/tests/tracking.test.ts
 *   (or: npm test)
 *
 * Scenarios A–E mirror the support-centre brief; the integration file
 * (tracking.integration.test.ts) replays them against a real database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCarrierTime, formatIstDateTime, istEndOfDay } from "../../src/lib/tracking/time";
import { normalizeCarrierStatus, canTrackingMoveOrder, orderStatusFor } from "../../src/lib/tracking/status";
import {
  assessTracking,
  failureBackoffMinutes,
  nextSyncDelayMinutes,
  type TrackingFacts,
} from "../../src/lib/tracking/assess";
import { DEFAULT_TRACKING_CONFIG as CFG, resolveTrackingConfig } from "../../src/lib/tracking/config";
import {
  baseOrderId,
  parseShiprocketTracking,
  parseShiprocketWebhook,
  scanFingerprint,
  snapshotEvents,
} from "../../src/lib/tracking/carrier";
import { noticeSendAt } from "../../src/lib/notifications/quiet-hours";
import { deriveTrackingStatus } from "../../src/lib/tracking/derive";

/** IST wall-clock → Date. */
const ist = (s: string) => {
  const d = parseCarrierTime(s);
  if (!d) throw new Error(`bad fixture time ${s}`);
  return d;
};

function facts(over: Partial<TrackingFacts> = {}): TrackingFacts {
  return {
    kind: "FORWARD",
    status: "IN_TRANSIT",
    statusLabel: "IN TRANSIT",
    statusChangedAt: ist("2026-10-07 20:30:00"),
    awbCode: "149022338812",
    createdAt: ist("2026-10-05 21:41:00"),
    lastEventAt: ist("2026-10-07 20:30:00"),
    eddAt: null,
    eddSource: null,
    deliveredAt: null,
    terminalAt: null,
    deliveryAttempts: 0,
    lastSyncSuccessAt: ist("2026-10-09 11:20:00"),
    lastWebhookAt: null,
    consecutiveFailures: 0,
    ...over,
  };
}

describe("courier time parsing", () => {
  it("reads offset-less Shiprocket times as IST", () => {
    assert.equal(parseCarrierTime("2026-10-07 20:30:00")!.toISOString(), "2026-10-07T15:00:00.000Z");
    assert.equal(parseCarrierTime("07 10 2026 20:30:00")!.toISOString(), "2026-10-07T15:00:00.000Z");
    assert.equal(parseCarrierTime("07 Oct 2026, 08:30 PM")!.toISOString(), "2026-10-07T15:00:00.000Z");
  });
  it("honours explicit offsets", () => {
    assert.equal(parseCarrierTime("2026-10-07T15:00:00Z")!.toISOString(), "2026-10-07T15:00:00.000Z");
  });
  it("never invents a time for blanks or garbage", () => {
    for (const v of ["", "NA", "0000-00-00 00:00:00", "2026-09-31 10:00:00", "soon", null, 42]) {
      assert.equal(parseCarrierTime(v), null, String(v));
    }
  });
  it("formats in IST", () => {
    assert.equal(formatIstDateTime(ist("2026-10-07 20:30:00")), "7 Oct, 8:30 pm");
  });
});

describe("status normalisation", () => {
  const cases: Array<[string, string]> = [
    ["RTO Delivered", "RTO_DELIVERED"],
    ["RTO Initiated", "RTO_IN_TRANSIT"],
    ["UNDELIVERED", "DELIVERY_ATTEMPTED"],
    ["Undelivered-AT SOURCE HUB", "DELIVERY_ATTEMPTED"],
    ["OUT FOR DELIVERY", "OUT_FOR_DELIVERY"],
    ["DELIVERED", "DELIVERED"],
    ["Partial Delivered", "EXCEPTION"],
    ["LOST", "EXCEPTION"],
    ["OUT FOR PICKUP", "AWAITING_PICKUP"],
    ["Manifested - Manifest uploaded", "AWAITING_PICKUP"],
    ["PICKED UP", "PICKED_UP"],
    ["REACHED AT DESTINATION HUB", "IN_TRANSIT"],
    ["SHIPMENT DELAYED", "DELAYED"],
    ["Canceled", "CANCELLED"],
    ["NA", "UNKNOWN"],
  ];
  for (const [label, want] of cases) {
    it(`${label} → ${want}`, () => assert.equal(normalizeCarrierStatus(label), want));
  }
  it("a reverse pickup's RETURN/DELIVERED wording is a normal journey", () => {
    assert.equal(normalizeCarrierStatus("DELIVERED", "RETURN"), "DELIVERED");
  });
  it("order status only moves forward", () => {
    assert.equal(orderStatusFor("IN_TRANSIT"), "SHIPPED");
    assert.ok(canTrackingMoveOrder("PACKED", "SHIPPED"));
    assert.ok(!canTrackingMoveOrder("DELIVERED", "SHIPPED"));
    assert.ok(!canTrackingMoveOrder("REFUNDED", "DELIVERED"));
    assert.ok(!canTrackingMoveOrder("SHIPPED", "CANCELLED"));
  });
});

describe("Scenario A — old courier event, no new scan", () => {
  const now = ist("2026-10-09 11:20:00");
  const a = assessTracking(facts(), { now, config: CFG });

  it("keeps the 7 Oct scan as the last courier update", () => {
    assert.equal(a.lastCourierUpdateAt!.toISOString(), ist("2026-10-07 20:30:00").toISOString());
  });
  it("reports the actual check time separately", () => {
    assert.equal(a.lastCheckedAt!.toISOString(), now.toISOString());
  });
  it("flags no movement after 36 h, visible to the customer", () => {
    const e = a.exceptions.find((x) => x.type === "NO_MOVEMENT");
    assert.ok(e, "NO_MOVEMENT expected");
    assert.ok(e.customerVisible);
    assert.match(a.delay!.headline, /No new courier movement for over 38 hours/);
  });
  it("does not claim arriving today", () => assert.equal(a.estimate.arrivingToday, false));
});

describe("Scenario B — estimate expired, no new courier date", () => {
  const now = ist("2026-10-09 11:20:00");
  const a = assessTracking(
    facts({ eddAt: ist("2026-10-08 00:00:00"), eddSource: "COURIER", lastEventAt: ist("2026-10-08 18:00:00") }),
    { now, config: CFG },
  );
  it("never advertises the expired date as current", () => {
    assert.equal(a.estimate.state, "EXPIRED");
    assert.equal(a.estimate.date, null);
    assert.equal(a.estimate.expiredDate!.toISOString(), ist("2026-10-08 00:00:00").toISOString());
  });
  it("explains the delay to the customer and opens an exception", () => {
    assert.equal(a.delay!.headline, "Delivery delayed — updated estimate pending.");
    assert.ok(a.exceptions.some((e) => e.type === "EDD_EXPIRED"));
  });
  it("is not expired while the estimate day is still running", () => {
    const sameDay = assessTracking(facts({ eddAt: ist("2026-10-08 00:00:00"), eddSource: "COURIER" }), {
      now: ist("2026-10-08 23:30:00"),
      config: CFG,
    });
    assert.equal(sameDay.estimate.state, "COURIER");
    assert.equal(sameDay.estimate.arrivingToday, true);
  });
  it("escalates after the configured number of days", () => {
    const late = assessTracking(facts({ eddAt: ist("2026-10-08 00:00:00"), eddSource: "COURIER", lastEventAt: ist("2026-10-10 09:00:00") }), {
      now: ist("2026-10-10 12:00:00"),
      config: CFG,
    });
    const e = late.exceptions.find((x) => x.type === "EDD_EXPIRED")!;
    assert.equal(e.escalate, true);
    assert.equal(e.severity, "HIGH");
  });
  it("a PRC store estimate expires the same way and is never 'arriving today'", () => {
    const s = assessTracking(facts({ lastEventAt: ist("2026-10-09 08:00:00") }), {
      now: ist("2026-10-09 11:20:00"),
      config: CFG,
      storeEstimate: ist("2026-10-09 00:00:00"),
    });
    assert.equal(s.estimate.state, "STORE_ESTIMATE");
    assert.equal(s.estimate.arrivingToday, false);
  });
});

describe("Scenario C — courier supplies a new estimate", () => {
  it("shows the new 11 Oct date and clears the delay", () => {
    const a = assessTracking(
      facts({ eddAt: ist("2026-10-11 00:00:00"), eddSource: "COURIER", lastEventAt: ist("2026-10-09 10:00:00") }),
      { now: ist("2026-10-09 11:20:00"), config: CFG },
    );
    assert.equal(a.estimate.state, "COURIER");
    assert.equal(a.estimate.date!.toISOString(), ist("2026-10-11 00:00:00").toISOString());
    assert.equal(a.delay, null);
  });
});

describe("Scenario D — duplicate webhook payloads", () => {
  const body = {
    awb: 149022338812,
    current_status: "IN TRANSIT",
    current_timestamp: "07 10 2026 20:30:00",
    etd: "2026-10-08 18:00:00",
    scans: [
      { date: "2026-10-06 17:12:00", status: "X-PPOM", activity: "Shipment picked up", location: "Bengaluru (Karnataka)", "sr-status-label": "PICKED UP" },
      { date: "2026-10-07 20:30:00", status: "X-DLL2F", activity: "Arrived at hub", location: "Bengaluru_Hub (Karnataka)", "sr-status-label": "IN TRANSIT" },
      { date: "2026-10-07 20:30:00", status: "X-DLL2F", activity: "Arrived at hub", location: "Bengaluru_Hub (Karnataka)", "sr-status-label": "IN TRANSIT" },
    ],
  };
  it("collapses repeated scans inside one payload", () => {
    assert.equal(parseShiprocketWebhook(body).scans.length, 2);
  });
  it("produces identical fingerprints for the same scan from webhook and poll", () => {
    const fromHook = parseShiprocketWebhook(body).scans[1];
    const fromPoll = parseShiprocketTracking({
      tracking_data: {
        track_status: 1,
        shipment_track: [{ awb_code: "149022338812", current_status: "IN TRANSIT" }],
        shipment_track_activities: [body.scans[1]],
      },
    })!.scans[0];
    assert.equal(scanFingerprint(fromHook), scanFingerprint(fromPoll));
  });
  it("does not add a separate current-status event that duplicates the last scan", () => {
    assert.equal(snapshotEvents(parseShiprocketWebhook(body)).length, 2);
  });
  it("reads the courier EDD as IST", () => {
    assert.equal(parseShiprocketWebhook(body).edd!.toISOString(), "2026-10-08T12:30:00.000Z");
  });
});

describe("Scenario E — courier API unavailable", () => {
  const now = ist("2026-10-09 18:00:00");
  const a = assessTracking(
    facts({ lastSyncSuccessAt: ist("2026-10-09 09:00:00"), consecutiveFailures: 4, lastEventAt: ist("2026-10-09 08:00:00") }),
    { now, config: CFG },
  );
  it("keeps the last verified data and reports sync as unhealthy", () => {
    assert.equal(a.sync.healthy, false);
    assert.equal(a.lastCheckedAt!.toISOString(), ist("2026-10-09 09:00:00").toISOString());
    assert.equal(a.lastCourierUpdateAt!.toISOString(), ist("2026-10-09 08:00:00").toISOString());
  });
  it("raises an internal (not customer-facing) sync exception", () => {
    const e = a.exceptions.find((x) => x.type === "SYNC_FAILING")!;
    assert.ok(e);
    assert.equal(e.customerVisible, false);
    assert.equal(e.escalate, false, "per-shipment sync failures must not page ops individually");
  });
  it("backs off exponentially with a cap", () => {
    const fixed = () => 0.5;
    assert.equal(failureBackoffMinutes(1, CFG, fixed), 15);
    assert.equal(failureBackoffMinutes(3, CFG, fixed), 60);
    assert.equal(failureBackoffMinutes(20, CFG, fixed), 360);
  });
});

describe("re-ships and courier cancellations (PRC-ABCD1234, Oct 2026)", () => {
  const now = ist("2026-10-09 11:20:00");
  it("matches a Shiprocket clone id to its base order", () => {
    assert.equal(baseOrderId("PRC-ABCD1234-C"), "PRC-ABCD1234");
    assert.equal(baseOrderId("PRC-ABCD1234-C2"), "PRC-ABCD1234");
    assert.equal(baseOrderId("PRC-ABCD1234"), null);
  });
  it("a courier cancellation never cancels the order", () => {
    assert.ok(!canTrackingMoveOrder("PAID", "CANCELLED"));
    assert.ok(!canTrackingMoveOrder("PACKED", "CANCELLED"));
  });
  it("flags a cancelled shipment on an open order for staff", () => {
    const a = assessTracking(facts({ status: "CANCELLED", terminalAt: now }), { now, config: CFG, orderStatus: "PACKED" });
    const e = a.exceptions.find((x) => x.type === "SHIPMENT_CANCELLED");
    assert.ok(e && e.escalate && !e.customerVisible);
  });
  it("flags a moving parcel on a cancelled order", () => {
    const a = assessTracking(facts({ status: "PICKED_UP", lastEventAt: now }), { now, config: CFG, orderStatus: "CANCELLED" });
    assert.ok(a.exceptions.some((x) => x.type === "ORDER_MISMATCH"));
  });
  it("reads the undelivered reason and attempt count from the webhook", () => {
    const s = parseShiprocketWebhook({ awb: "1", current_status: "UNDELIVERED", undelivered_reason: "Consignee not available", delivery_attempt_count: "2" });
    assert.equal(s.reason, "Consignee not available");
    assert.equal(s.attemptCount, 2);
  });
});

describe("real production labels (replayed 715 webhooks, Oct 2026)", () => {
  const cases: Array<[string, string]> = [
    ["Not Picked", "AWAITING_PICKUP"],
    ["Pickup Not Done", "AWAITING_PICKUP"],
    ["PickupFailed", "AWAITING_PICKUP"],
    ["RTB Manifested", "DELIVERY_ATTEMPTED"],
    ["Undelivered-AT SOURCE HUB", "DELIVERY_ATTEMPTED"],
    ["At Destination", "IN_TRANSIT"],
    ["Scheduled for Delivery", "IN_TRANSIT"],
    ["REACHED BACK AT SELLER CITY", "RTO_DELIVERED"],
    ["RTO NDR", "RTO_IN_TRANSIT"],
    ["Dispatched - Dispatched for RTO", "RTO_IN_TRANSIT"],
  ];
  for (const [label, want] of cases) it(`${label} → ${want}`, () => assert.equal(normalizeCarrierStatus(label), want));
});

describe("status derivation: Shiprocket summary vs courier scans", () => {
  const t = (s: string) => ist(s);
  it("a poll's summary beats an older, mis-labelled scan (DTDC failed-attempt pattern, Oct 2026)", () => {
    const r = deriveTrackingStatus({
      previous: { status: "IN_TRANSIT", statusChangedAt: t("2026-09-16 20:51:00"), summary: null },
      latestKnownScan: { status: "IN_TRANSIT", at: t("2026-09-28 22:21:00") },
      snapshotSummary: { status: "DELIVERY_ATTEMPTED", at: t("2026-10-09 15:00:00") },
      hasAwb: true,
    });
    assert.equal(r.status, "DELIVERY_ATTEMPTED");
  });
  it("a late webhook carrying an older summary can't drag the status back", () => {
    const r = deriveTrackingStatus({
      previous: { status: "OUT_FOR_DELIVERY", statusChangedAt: t("2026-10-09 09:00:00"), summary: { status: "OUT_FOR_DELIVERY", at: t("2026-10-09 09:00:00") } },
      latestKnownScan: { status: "OUT_FOR_DELIVERY", at: t("2026-10-09 09:00:00") },
      snapshotSummary: { status: "IN_TRANSIT", at: t("2026-10-08 18:00:00") },
      hasAwb: true,
    });
    assert.equal(r.status, "OUT_FOR_DELIVERY");
  });
  it("a scan newer than any summary decides", () => {
    const r = deriveTrackingStatus({
      previous: { status: "IN_TRANSIT", statusChangedAt: t("2026-10-08 10:00:00"), summary: { status: "IN_TRANSIT", at: t("2026-10-08 10:00:00") } },
      latestKnownScan: { status: "OUT_FOR_DELIVERY", at: t("2026-10-09 09:00:00") },
      snapshotSummary: null,
      hasAwb: true,
    });
    assert.equal(r.status, "OUT_FOR_DELIVERY");
  });
  it("delivered stays delivered unless a newer courier fact says otherwise", () => {
    const base = { statusChangedAt: t("2026-10-09 12:00:00"), summary: { status: "DELIVERED" as const, at: t("2026-10-09 12:00:00") } };
    const stale = deriveTrackingStatus({ previous: { status: "DELIVERED", ...base }, latestKnownScan: { status: "IN_TRANSIT", at: t("2026-10-08 10:00:00") }, snapshotSummary: null, hasAwb: true });
    assert.equal(stale.status, "DELIVERED");
    const fresh = deriveTrackingStatus({ previous: { status: "DELIVERED", ...base }, latestKnownScan: null, snapshotSummary: { status: "DELIVERY_ATTEMPTED", at: t("2026-10-10 12:00:00") }, hasAwb: true });
    assert.equal(fresh.status, "DELIVERY_ATTEMPTED");
    assert.equal(fresh.correction, true);
  });
});

describe("scheduling", () => {
  const now = ist("2026-10-09 11:20:00");
  it("polls attention states faster", () => {
    const f = facts({ status: "OUT_FOR_DELIVERY", lastEventAt: ist("2026-10-09 09:00:00") });
    assert.equal(nextSyncDelayMinutes(f, assessTracking(f, { now, config: CFG }), CFG, now), CFG.attentionIntervalMin);
  });
  it("does one final reconciliation after delivery, then stops", () => {
    const f = facts({ status: "DELIVERED", deliveredAt: now, terminalAt: ist("2026-10-08 11:00:00") });
    assert.equal(nextSyncDelayMinutes(f, assessTracking(f, { now, config: CFG }), CFG, now), null);
  });
  it("rejects invalid config overrides field by field", () => {
    const c = resolveTrackingConfig({ movingIntervalMin: 1, noMovementHours: 48, bogus: 1 });
    assert.equal(c.movingIntervalMin, CFG.movingIntervalMin);
    assert.equal(c.noMovementHours, 48);
  });
});

describe("notification quiet hours (IST)", () => {
  const q = { startHour: 21, endHour: 9 };
  it("defers a 23:00 notice to 09:00 next day", () => {
    assert.equal(noticeSendAt(ist("2026-10-09 23:00:00"), q).toISOString(), ist("2026-10-10 09:00:00").toISOString());
  });
  it("sends immediately in the daytime", () => {
    const t = ist("2026-10-09 14:00:00");
    assert.equal(noticeSendAt(t, q).toISOString(), t.toISOString());
  });
  it("istEndOfDay is the last instant of the IST day", () => {
    assert.equal(istEndOfDay(ist("2026-10-08 00:00:00")).toISOString(), "2026-10-08T18:29:59.999Z");
  });
});
