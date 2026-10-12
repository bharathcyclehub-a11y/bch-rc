/**
 * Support rules — deterministic unit tests (no DB, no network).
 *   node --import tsx --test scripts/tests/support.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addSupportHours,
  canStaffMove,
  checkEligibility,
  computePriority,
  DEFAULT_SLA,
  mentionsSafetyHazard,
} from "../../src/lib/support/rules";

const ist = (s: string) => new Date(`${s.replace(" ", "T")}+05:30`);

describe("priority rules", () => {
  it("any safety hazard is CRITICAL", () => {
    assert.equal(computePriority({ category: "GENERAL", description: "the battery is swelling", safetyFlag: false }).priority, "CRITICAL");
    assert.equal(computePriority({ category: "BATTERY_CHARGING", description: "won't charge", safetyFlag: true }).priority, "CRITICAL");
    assert.ok(mentionsSafetyHazard("it started smoking while charging"));
    assert.ok(!mentionsSafetyHazard("the remote is fine, car slow"));
  });
  it("not received while the courier says delivered is CRITICAL", () => {
    assert.equal(
      computePriority({ category: "ORDER_NOT_RECEIVED", description: "never got it", safetyFlag: false, trackingDelivered: true }).priority,
      "CRITICAL",
    );
  });
  it("damage / wrong / missing are HIGH, delays depend on the estimate", () => {
    assert.equal(computePriority({ category: "DAMAGED_PRODUCT", description: "cracked shell", safetyFlag: false }).priority, "HIGH");
    assert.equal(computePriority({ category: "DELIVERY_DELAYED", description: "late order", safetyFlag: false }).priority, "MEDIUM");
    assert.equal(
      computePriority({ category: "DELIVERY_DELAYED", description: "late order", safetyFlag: false, estimateExpired: true }).priority,
      "HIGH",
    );
  });
  it("spares and general enquiries are LOW", () => {
    assert.equal(computePriority({ category: "SPARE_PARTS", description: "need a battery", safetyFlag: false }).priority, "LOW");
  });
});

describe("SLA in support hours (10:00–20:00 IST)", () => {
  it("rolls an evening ticket into the next morning", () => {
    assert.equal(addSupportHours(ist("2026-10-09 19:30:00"), 1, DEFAULT_SLA).toISOString(), ist("2026-10-10 10:30:00").toISOString());
  });
  it("starts the clock at opening time for night tickets", () => {
    assert.equal(addSupportHours(ist("2026-10-09 08:00:00"), 4, DEFAULT_SLA).toISOString(), ist("2026-10-09 14:00:00").toISOString());
  });
  it("spans several days", () => {
    assert.equal(addSupportHours(ist("2026-10-09 18:00:00"), 30, DEFAULT_SLA).toISOString(), ist("2026-10-12 18:00:00").toISOString());
  });
});

describe("return / replacement eligibility (published 7-day policy)", () => {
  const now = ist("2026-10-09 12:00:00");
  it("damage 3 days after delivery is eligible for replacement, evidence required", () => {
    const e = checkEligibility({ category: "DAMAGED_PRODUCT", orderStatus: "DELIVERED", deliveredAt: ist("2026-10-06 15:00:00"), now });
    assert.equal(e.eligible, true);
    assert.equal(e.claimType, "REPLACEMENT");
    assert.equal(e.daysSinceDelivery, 3);
    assert.equal(e.evidence, "REQUIRED");
  });
  it("outside the window is not eligible but still reviewable", () => {
    const e = checkEligibility({ category: "PRODUCT_NOT_WORKING", orderStatus: "DELIVERED", deliveredAt: ist("2026-09-29 10:00:00"), now });
    assert.equal(e.eligible, false);
    assert.match(e.message, /outside the 7-day window/);
  });
  it("an undelivered order can't be checked yet", () => {
    const e = checkEligibility({ category: "WRONG_ITEM", orderStatus: "SHIPPED", deliveredAt: null, now });
    assert.equal(e.eligible, false);
    assert.match(e.message, /isn't marked delivered/);
  });
  it("change of mind is a RETURN with conditions", () => {
    const e = checkEligibility({ category: "RETURN_REQUEST", orderStatus: "DELIVERED", deliveredAt: ist("2026-10-08 10:00:00"), now });
    assert.equal(e.claimType, "RETURN");
    assert.ok(e.conditions.some((c) => /unopened/i.test(c)));
  });
  it("delivery categories are not claims", () => {
    assert.equal(checkEligibility({ category: "DELIVERY_DELAYED", orderStatus: "SHIPPED", deliveredAt: null, now }).claimType, null);
  });
});

describe("ticket transitions", () => {
  it("closed tickets are final; resolved ones can reopen", () => {
    assert.ok(!canStaffMove("CLOSED", "OPEN"));
    assert.ok(canStaffMove("RESOLVED", "REOPENED"));
    assert.ok(!canStaffMove("RESOLVED", "IN_PROGRESS"));
  });
});

describe("support session cookie", async () => {
  process.env.SUPPORT_SESSION_SECRET = "unit-test-secret";
  const { signSession, readSessionToken } = await import("../../src/lib/support/session");
  const s = { customerId: "c1", email: "a@example.com", orderId: "PRC-ABCD1234" };
  it("round-trips", () => assert.equal(readSessionToken(signSession(s))?.customerId, "c1"));
  it("rejects tampering", () => {
    const [p, sig] = signSession(s).split(".");
    const forged = Buffer.from(JSON.stringify({ ...s, customerId: "c2", exp: 9e9 })).toString("base64url");
    assert.equal(readSessionToken(`${forged}.${sig}`), null);
    assert.equal(readSessionToken(`${p}.x${sig}`), null);
  });
  it("expires", () => assert.equal(readSessionToken(signSession(s, Date.now() - 5 * 3_600_000)), null));
});
