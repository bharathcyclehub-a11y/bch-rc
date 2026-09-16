/** Provider response validation. No credentials or network access in this module. */
export type IntegrationStatus = "connected" | "not_configured" | "scope_mismatch" | "error";

export type IntegrationResult<T> = {
  status: IntegrationStatus;
  message: string;
  missing: string[];
  dashboardUrl: string | null;
  fetchedAt: string | null;
  report: T | null;
};

export type IntegrationRange = { startDate: string; endDate: string; siteIds: string[] };

export type Ga4Report = {
  startDate: string;
  endDate: string;
  timeZone: string;
  currencyCode: string;
  activeUsers: number;
  sessions: number;
  pageviews: number;
  engagedSessions: number;
  purchases: number;
  purchaseRevenue: number;
  channels: { channel: string; sessions: number; activeUsers: number; purchases: number }[];
  notes: string[];
};

export type ClarityReport = {
  windowHours: 24 | 72;
  windowStart: string;
  windowEnd: string;
  metrics: { name: string; values: { label: string; value: number }[] }[];
  notes: string[];
};

export const GA4_METRICS = [
  "activeUsers", "sessions", "screenPageViews", "engagedSessions", "ecommercePurchases", "purchaseRevenue",
] as const;

export function isValidIntegrationRange(range: Pick<IntegrationRange, "startDate" | "endDate">): boolean {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
  return validDate(range.startDate) && validDate(range.endDate) && range.startDate <= range.endDate;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider response");
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error("Missing provider metric");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid provider metric");
  return parsed;
}

function metricRows(value: unknown, expected: readonly string[]): {
  rows: { metrics: Record<string, number>; dimensions: string[] }[];
  metadata: Record<string, unknown>;
  rowCount: number;
} {
  const report = object(value);
  if (!Array.isArray(report.metricHeaders)) throw new Error("Missing provider headers");
  const headers = report.metricHeaders.map((header) => object(header).name);
  if (!expected.every((name) => headers.includes(name))) throw new Error("Provider metric schema changed");
  if (report.rows !== undefined && !Array.isArray(report.rows)) throw new Error("Invalid provider rows");
  const rows = (report.rows as unknown[] | undefined ?? []).map((entry) => {
    const row = object(entry);
    const metricValues = row.metricValues;
    if (!Array.isArray(metricValues) || metricValues.length !== headers.length) {
      throw new Error("Incomplete provider row");
    }
    return {
      metrics: Object.fromEntries(headers.map((header, i) => [String(header), number(object(metricValues[i]).value)])),
      dimensions: Array.isArray(row.dimensionValues)
        ? row.dimensionValues.map((dimension) => String(object(dimension).value ?? "")) : [],
    };
  });
  const rowCount = report.rowCount === undefined ? rows.length : number(report.rowCount);
  if (rowCount > 0 && !rows.length) throw new Error("Missing provider rows");
  return { rows, metadata: report.metadata ? object(report.metadata) : {}, rowCount };
}

/** A dimensionless total avoids double-counting users who visit through multiple channels. */
export function parseGa4Report(summary: unknown, channelReport: unknown, range: Pick<IntegrationRange, "startDate" | "endDate">): Ga4Report {
  const totals = metricRows(summary, GA4_METRICS);
  if (totals.rows.length > 1) throw new Error("Expected aggregate GA4 report");
  const m = totals.rows[0]?.metrics ?? Object.fromEntries(GA4_METRICS.map((name) => [name, 0]));
  const channels = metricRows(channelReport, ["sessions", "activeUsers", "ecommercePurchases"]);
  const notes = [
    "GA4 measures consented and modeled browser activity. Purchase events are not the order ledger or verified payments.",
    "Daily boundaries use the GA4 property's time zone; recent data may still be processing.",
  ];
  for (const report of [totals, channels]) {
    if (report.metadata.subjectToThresholding === true) notes.push("Google applied privacy thresholds; some data may be withheld.");
    if (report.metadata.dataLossFromOtherRow === true) notes.push("Google grouped some high-cardinality data into an other row.");
    if (Array.isArray(report.metadata.samplingMetadatas) && report.metadata.samplingMetadatas.length) {
      notes.push("This GA4 response includes sampled data.");
    }
  }
  if (channels.rowCount > channels.rows.length) notes.push("Only the top 20 acquisition channels are displayed.");
  return {
    startDate: range.startDate, endDate: range.endDate,
    timeZone: typeof totals.metadata.timeZone === "string" ? totals.metadata.timeZone : "Property time zone (not returned)",
    currencyCode: typeof totals.metadata.currencyCode === "string" ? totals.metadata.currencyCode : "INR",
    activeUsers: m.activeUsers, sessions: m.sessions, pageviews: m.screenPageViews,
    engagedSessions: m.engagedSessions, purchases: m.ecommercePurchases, purchaseRevenue: m.purchaseRevenue,
    channels: channels.rows.map((row) => ({
      channel: row.dimensions[0] || "(not set)", sessions: row.metrics.sessions,
      activeUsers: row.metrics.activeUsers, purchases: row.metrics.ecommercePurchases,
    })),
    notes: [...new Set(notes)],
  };
}

/** Allow at most one minute of scheduler drift; actual overlapping windows are
 * retained and labeled, never added into a false calendar-day or unique total. */
export function claritySnapshotDue(lastWindowEnd: number, lastAttemptAt: number, now: number): boolean {
  return now - lastWindowEnd >= 86_340_000 && now - lastAttemptAt >= 21_600_000;
}

// Only aggregate numeric behavior fields are exposed. URL/referrer/page-title
// reports can contain personal data and are deliberately excluded from exports.
const CLARITY_METRICS = new Set([
  "Traffic", "ScrollDepth", "EngagementTime", "DeadClickCount", "ExcessiveScroll",
  "RageClickCount", "QuickbackClick", "ScriptErrorCount", "ErrorClickCount",
]);
const normalize = (value: string) => value.replace(/[\s_-]/g, "");
const fieldLabel = (value: string) => ({
  totalSessionCount: "Total sessions", totalBotSessionCount: "Bot sessions",
  distantUserCount: "Unique users", distinctUserCount: "Unique users",
  PagesPerSessionPercentage: "Pages per session",
  pagesPerSessionPercentage: "Pages per session",
}[value] ?? value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (s) => s.toUpperCase()));

export function parseClarityReport(value: unknown, windowHours: 24 | 72, fetchedAt: string): ClarityReport {
  if (!Array.isArray(value)) throw new Error("Invalid Clarity response");
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("Invalid snapshot time");
  const metrics: ClarityReport["metrics"] = [];
  const notes = [
    `Clarity covers the rolling ${windowHours} hours ending at the fetch time (UTC), independently of the selected sales dates.`,
    "Clarity tracks visitors who allow analytics. Recordings and heatmaps open in Clarity; its export API returns aggregate metrics only.",
    "Provider values are retained as reported. Unique users and percentages must not be summed across snapshots.",
  ];
  for (const entry of value) {
    const metric = object(entry);
    if (typeof metric.metricName !== "string" || !Array.isArray(metric.information)) throw new Error("Invalid Clarity metric");
    if (!CLARITY_METRICS.has(normalize(metric.metricName))) continue;
    if (metric.information.length > 1) {
      notes.push(`The ${metric.metricName} response contained multiple groups; no combined total was inferred.`);
      continue;
    }
    if (!metric.information.length) continue;
    const values = Object.entries(object(metric.information[0])).flatMap(([key, raw]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || !/(count|percentage|time|depth|rate)$/i.test(key)) return [];
      try { return [{ label: fieldLabel(key), value: number(raw) }]; } catch { return []; }
    });
    if (values.length) metrics.push({ name: fieldLabel(metric.metricName), values });
  }
  if (value.length && !metrics.length) throw new Error("No supported Clarity aggregates returned");
  return {
    windowHours, windowStart: new Date(Date.parse(fetchedAt) - windowHours * 3_600_000).toISOString(),
    windowEnd: new Date(fetchedAt).toISOString(), metrics, notes: [...new Set(notes)],
  };
}
