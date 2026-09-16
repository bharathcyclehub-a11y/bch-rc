/** Run with: node --import tsx scripts/verify-analytics-ranges.ts */
import assert from "node:assert/strict";
import { analyticsBuckets, analyticsWindow, fillSalesTimeSeries, MAX_WINDOW_DAYS, parseAnalyticsRange } from "../src/lib/analytics-range";
import { csvCell, toCsv } from "../src/lib/csv";

const now = new Date("2026-09-10T20:30:00Z"); // Sep 11, 02:00 IST
let passed = 0;
function check(label: string, test: () => void) {
  test();
  passed++;
  console.log(`PASS ${label}`);
}

check("rolling periods include exactly N IST days and have an exclusive upper bound", () => {
  const range = analyticsWindow(7, now);
  assert.equal(range.start.toISOString(), "2026-09-04T18:30:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-11T18:30:00.000Z");
  assert.equal(range.prevStart.toISOString(), "2026-08-28T18:30:00.000Z");
});
check("one specific day includes the entire day across the UTC boundary", () => {
  const range = parseAnalyticsRange({ from: "2026-09-05", to: "2026-09-05" }, { now });
  assert.equal(range.error, undefined);
  assert.equal(range.days, 1);
  assert.equal(range.start.toISOString(), "2026-09-04T18:30:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-05T18:30:00.000Z");
  assert.ok(new Date("2026-09-05T18:29:59Z") < range.end);
  assert.match(range.label, /2026/);
});
check("history beyond 90 and 365 days is retained without clipping", () => {
  const range = parseAnalyticsRange({ from: "2023-01-01", to: "2025-12-31" }, { now });
  assert.equal(range.days, 1096);
  assert.equal(range.fromYmd, "2023-01-01");
  assert.equal(range.toYmd, "2025-12-31");
  assert.equal(parseAnalyticsRange({ range: "730" }, { now }).days, 730);
  assert.equal(parseAnalyticsRange({ range: String(MAX_WINDOW_DAYS) }, { now }).days, MAX_WINDOW_DAYS);
});
check("leap months and years include February 29", () => {
  const month = parseAnalyticsRange({ month: "2024-02" }, { now });
  assert.equal(month.days, 29);
  assert.equal(month.toYmd, "2024-02-29");
  assert.equal(month.end.toISOString(), "2024-02-29T18:30:00.000Z");
  const year = parseAnalyticsRange({ year: "2024" }, { now });
  assert.equal(year.days, 366);
  assert.equal(year.granularity, "month");
  assert.equal(analyticsBuckets(year, "month").length, 12);
});
check("invalid dates, incomplete filters, inversions and excessive windows report explicit errors", () => {
  for (const input of [
    { from: "2026-02-31", to: "2026-03-02" },
    { from: "2026-09-05", to: "2026-09-04" },
    { from: "2026-09-05" },
    { from: "2000-01-01", to: "2026-09-05" },
    { month: "2026-13" },
    { year: "2026", month: "2026-09" },
    { range: "0" }, { range: "7.5" }, { range: "Infinity" }, { range: "99999" },
  ]) {
    const result = parseAnalyticsRange(input, { now });
    assert.ok(result.error, JSON.stringify(input));
    assert.equal(result.days, 30);
  }
  assert.throws(() => analyticsWindow(MAX_WINDOW_DAYS + 1, now), RangeError);
});
check("same-length comparison window immediately precedes selected dates", () => {
  const range = parseAnalyticsRange({ month: "2024-02" }, { now });
  assert.equal(range.start.getTime() - range.prevStart.getTime(), range.end.getTime() - range.start.getTime());
});
check("month and year buckets cross calendar boundaries and clip partial periods", () => {
  const range = parseAnalyticsRange({ from: "2023-12-29", to: "2024-02-02" }, { now });
  const months = analyticsBuckets(range, "month");
  assert.deepEqual(months.map((b) => b.key), ["2023-12-01", "2024-01-01", "2024-02-01"]);
  assert.equal(months[0].start.toISOString(), range.start.toISOString());
  assert.equal(months[2].end.toISOString(), range.end.toISOString());
  assert.deepEqual(analyticsBuckets(range, "year").map((b) => b.key), ["2023-01-01", "2024-01-01"]);
  assert.equal(analyticsBuckets(range, "day").length, range.days);
});
check("zero-filled time series reconciles sales and profile totals", () => {
  const range = parseAnalyticsRange({ from: "2024-01-01", to: "2024-03-31" }, { now });
  const points = fillSalesTimeSeries(range, "month", [
    { key: "2024-01-01", revenue: 1500, orders: 2 },
    { key: "2024-03-01", revenue: 900, orders: 1 },
  ], [{ key: "2024-02-01", customers: 3 }]);
  assert.equal(points.length, 3);
  assert.deepEqual(points.map((p) => p.revenue), [1500, 0, 900]);
  assert.deepEqual(points.map((p) => p.customers), [0, 3, 0]);
  assert.equal(points.reduce((total, p) => total + p.revenue, 0), 2400);
});
check("explicit chart grouping survives reproducible query strings", () => {
  const original = parseAnalyticsRange({ from: "2022-01-01", to: "2025-12-31", granularity: "month" }, { now });
  const roundtrip = parseAnalyticsRange(Object.fromEntries(new URLSearchParams(original.query)), { now });
  assert.equal(roundtrip.granularity, "month");
  assert.equal(roundtrip.start.toISOString(), original.start.toISOString());
  assert.equal(roundtrip.end.toISOString(), original.end.toISOString());
});
check("CSV treats untrusted formula text as text and preserves genuine numeric amounts", () => {
  for (const value of ["=HYPERLINK(\"https://evil.invalid\")", "+919999999999", "-1+1", "@SUM(A1)", "  =1+1", "\t=1+1"]) {
    assert.ok(csvCell(value).replace(/^"/, "").startsWith("'"), value);
  }
  assert.equal(csvCell(-500), "-500");
  assert.equal(csvCell('Name, "quoted"'), '"Name, ""quoted"""');
  assert.equal(toCsv(["name", "value"], [["Line\nbreak", 100]]), 'name,value\r\n"Line\nbreak",100');
});
console.log(`Analytics date and export checks: ${passed} passed`);
