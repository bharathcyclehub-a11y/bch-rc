/** Offline provider fixtures; no real accounts, credentials or HTTP requests. */
import assert from "node:assert/strict";
import { GA4_METRICS, claritySnapshotDue, isValidIntegrationRange, parseClarityReport, parseGa4Report } from "../src/lib/analytics-integrations-adapters";

const range = { startDate: "2025-01-01", endDate: "2026-09-11" };
const summary = {
  metricHeaders: GA4_METRICS.map((name) => ({ name })),
  rows: [{ metricValues: [8, 12, 28, 7, 3, 4899.5].map((value) => ({ value: String(value) })) }],
  metadata: { timeZone: "Asia/Kolkata", currencyCode: "INR", subjectToThresholding: true }, rowCount: 1,
};
const channels = {
  metricHeaders: ["sessions", "activeUsers", "ecommercePurchases"].map((name) => ({ name })),
  rows: [
    { dimensionValues: [{ value: "Organic Social" }], metricValues: [8, 7, 2].map((value) => ({ value: String(value) })) },
    { dimensionValues: [{ value: "Direct" }], metricValues: [4, 5, 1].map((value) => ({ value: String(value) })) },
  ], rowCount: 2,
};

assert.equal(isValidIntegrationRange(range), true, "Historical reports support dates beyond 90 days");
assert.equal(isValidIntegrationRange({ startDate: "2024-02-29", endDate: "2024-02-29" }), true);
for (const invalid of [
  { startDate: "2026-02-29", endDate: "2026-03-01" },
  { startDate: "2026-09-12", endDate: "2026-09-11" },
  { startDate: "2026-9-01", endDate: "2026-09-11" },
  { startDate: "today", endDate: "today" },
  { startDate: "2026-13-01", endDate: "2026-13-02" },
]) assert.equal(isValidIntegrationRange(invalid), false);

const ga4 = parseGa4Report(summary, channels, range);
assert.equal(ga4.activeUsers, 8, "Distinct users use provider aggregate, not the sum of channel users (12)");
assert.equal(ga4.sessions, 12);
assert.equal(ga4.pageviews, 28);
assert.equal(ga4.purchaseRevenue, 4899.5, "Do not truncate rupee decimals");
assert.equal(ga4.timeZone, "Asia/Kolkata");
assert.equal(ga4.channels[0].channel, "Organic Social");
assert.ok(ga4.notes.some((note) => note.includes("privacy thresholds")));
assert.throws(() => parseGa4Report({ error: { message: "redacted account details" } }, channels, range));
assert.throws(() => parseGa4Report({ ...summary, metricHeaders: [{ name: "sessions" }] }, channels, range));
assert.throws(() => parseGa4Report({ ...summary, rows: [{ metricValues: [{ value: "NaN" }] }] }, channels, range));
assert.throws(() => parseGa4Report({ ...summary, rows: [], rowCount: 1 }, channels, range));
const empty = parseGa4Report({ ...summary, rows: [], rowCount: 0 }, { ...channels, rows: [], rowCount: 0 }, range);
assert.equal(empty.sessions, 0, "An authenticated empty report is zero, not a connection failure");
const reordered = { ...summary, metricHeaders: [...summary.metricHeaders].reverse(), rows: [{ metricValues: [...summary.rows[0].metricValues].reverse() }] };
assert.equal(parseGa4Report(reordered, channels, range).sessions, 12, "Read metrics by header, not assumed column order");

// Microsoft's documented Traffic response uses the spelling distantUserCount.
const clarityFixture = [
  { metricName: "Traffic", information: [{ totalSessionCount: "44", totalBotSessionCount: "4", distantUserCount: "31", PagesPerSessionPercentage: 2.125 }] },
  { metricName: "RageClickCount", information: [{ sessionsCount: "3", sessionsWithMetricPercentage: 6.818 }] },
  { metricName: "PopularPages", information: [{ url: "https://example.test/?email=private@example.test", visitsCount: 20 }] },
];
const clarity = parseClarityReport(clarityFixture, 72, "2026-09-11T12:00:00.000Z");
assert.equal(clarity.windowStart, "2026-09-08T12:00:00.000Z");
assert.equal(clarity.windowEnd, "2026-09-11T12:00:00.000Z");
assert.equal(clarity.metrics[0].values.find((item) => item.label === "Unique users")?.value, 31);
assert.equal(clarity.metrics[0].values.find((item) => item.label === "Pages per session")?.value, 2.125);
assert.equal(clarity.metrics.length, 2);
assert.equal(JSON.stringify(clarity).includes("private@example.test"), false, "Do not persist URL/referrer personal data");
assert.equal(parseClarityReport(clarityFixture, 24, "2026-09-11T12:00:00.000Z").windowStart, "2026-09-10T12:00:00.000Z");
assert.throws(() => parseClarityReport({ message: "rate limited" }, 72, "2026-09-11T12:00:00.000Z"));
assert.throws(() => parseClarityReport([{ metricName: "Traffic", information: null }], 72, "2026-09-11T12:00:00.000Z"));
assert.throws(() => parseClarityReport([{ metricName: "Traffic", information: [{ totalSessionCount: "NaN" }] }], 72, "2026-09-11T12:00:00.000Z"));
const grouped = parseClarityReport([
  clarityFixture[1],
  { metricName: "Traffic", information: [{ totalSessionCount: "4", distantUserCount: "3", OS: "Android" }, { totalSessionCount: "5", distantUserCount: "4", OS: "iOS" }] },
], 72, "2026-09-11T12:00:00.000Z");
assert.equal(grouped.metrics.some((metric) => metric.name === "Traffic"), false, "Never sum distinct users or ratios across groups");
assert.ok(grouped.notes.some((note) => note.includes("multiple groups")));

const now = Date.parse("2026-09-11T12:00:00.000Z");
assert.equal(claritySnapshotDue(now - 86_400_000 + 1, now - 86_400_000, now), true, "One millisecond of scheduler drift must not lose the day's snapshot");
assert.equal(claritySnapshotDue(now - 82_800_000, now - 86_400_000, now), false, "A 23-hour retry cannot duplicate yesterday's window");
assert.equal(claritySnapshotDue(0, now - 3_600_000, now), false, "Provider failures retain the six-hour retry throttle");
assert.equal(claritySnapshotDue(0, 0, now), true, "A new archive is immediately eligible");

console.log("Analytics provider fixtures passed: dates, aggregate semantics, malformed responses, privacy notes, and rolling Clarity windows.");
