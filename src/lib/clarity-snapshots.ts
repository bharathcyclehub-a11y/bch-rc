import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fetchClaritySnapshot } from "@/lib/analytics-integrations";
import { claritySnapshotDue, isValidIntegrationRange, type ClarityReport, type IntegrationRange } from "@/lib/analytics-integrations-adapters";

export type ClarityHistory = {
  status: "ready" | "not_configured" | "unavailable" | "error";
  message: string;
  snapshots: ClarityReport[];
  firstCapturedAt: string | null;
  totalSnapshots: number;
};

const clean = (value: string | undefined) => (value ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
const config = () => ({ siteId: clean(process.env.ANALYTICS_INTEGRATION_SITE_ID), projectId: clean(process.env.NEXT_PUBLIC_CLARITY_ID) });
const asRows = (value: unknown) => value as Record<string, unknown>[];
const empty = (status: ClarityHistory["status"], message: string): ClarityHistory => ({ status, message, snapshots: [], firstCapturedAt: null, totalSnapshots: 0 });

export async function getClarityHistory(range: IntegrationRange): Promise<ClarityHistory> {
  const { siteId, projectId } = config();
  if (!siteId || !projectId) return empty("not_configured", "Connect a Clarity project and storefront to enable saved history.");
  if (!range.siteIds.includes(siteId)) return empty("unavailable", "The connected Clarity project is outside your permitted storefront scope.");
  if (!isValidIntegrationRange(range)) return empty("error", "Choose a valid date range for saved Clarity snapshots.");
  const from = new Date(`${range.startDate}T00:00:00+05:30`);
  const until = new Date(new Date(`${range.endDate}T00:00:00+05:30`).getTime() + 86_400_000);
  try {
    const [entries, counts] = await Promise.all([
      db.execute(sql`
        SELECT report FROM clarity_analytics_snapshots
        WHERE site_id = ${siteId} AND project_id = ${projectId}
          AND window_end >= ${from.toISOString()} AND window_end < ${until.toISOString()}
        ORDER BY window_end DESC LIMIT 400
      `),
      db.execute(sql`
        SELECT min(captured_at)::text AS first_captured_at,
          count(*) FILTER (WHERE window_end >= ${from.toISOString()} AND window_end < ${until.toISOString()})::int AS total
        FROM clarity_analytics_snapshots WHERE site_id = ${siteId} AND project_id = ${projectId}
      `),
    ]);
    const [count] = asRows(counts);
    const snapshots = asRows(entries).map((row) => validateSavedReport(row.report));
    const totalSnapshots = Number(count?.total ?? 0);
    const firstCapturedAt = typeof count?.first_captured_at === "string" ? new Date(count.first_captured_at).toISOString() : null;
    const message = !firstCapturedAt
      ? "No saved snapshots yet. Apply the archive migration and enable the scheduled collector; history starts with its first successful run."
      : `${totalSnapshots} saved rolling 24-hour snapshots ending within the selected IST dates. ${totalSnapshots > 400 ? "Showing the latest 400. " : ""}Actual UTC windows are preserved; scheduler drift can leave small overlaps and missed runs leave gaps. Do not add users, counts or percentages across snapshots.`;
    return { status: "ready", message, snapshots, firstCapturedAt, totalSnapshots };
  } catch (error) {
    let cause: unknown = error;
    for (let depth = 0; depth < 3 && cause && typeof cause === "object"; depth++) {
      const detail = cause as { code?: string; cause?: unknown };
      if (detail.code === "42P01") return empty("unavailable", "Clarity history storage is not installed. Apply the archive migration to start retaining future snapshots beyond 90 days.");
      cause = detail.cause;
    }
    return empty("error", "Saved Clarity history could not be read. Check the archive database setup.");
  }
}

function validateSavedReport(value: unknown): ClarityReport {
  const report = value as Partial<ClarityReport> | null;
  if (!report || report.windowHours !== 24 || typeof report.windowStart !== "string" || typeof report.windowEnd !== "string"
    || !Number.isFinite(Date.parse(report.windowStart)) || !Number.isFinite(Date.parse(report.windowEnd))
    || Date.parse(report.windowEnd) - Date.parse(report.windowStart) !== 86_400_000
    || !Array.isArray(report.metrics) || !Array.isArray(report.notes)) throw new Error("Invalid stored snapshot");
  for (const metric of report.metrics) {
    if (!metric || typeof metric.name !== "string" || !Array.isArray(metric.values)
      || metric.values.some((value) => typeof value.label !== "string" || !Number.isFinite(value.value))) throw new Error("Invalid stored metric");
  }
  return report as ClarityReport;
}

type CollectionResult = { status: "saved" | "skipped" | "not_configured" | "error"; message: string };

/** One rolling 24h snapshot approximately daily. Keep the lock through
 * the API call, so concurrent cron invocations cannot consume extra requests.
 * Provider failures are committed as attempts and retried at most every 6h.
 */
export async function collectClaritySnapshot(): Promise<CollectionResult> {
  const { siteId, projectId } = config();
  if (!siteId || !projectId || !clean(process.env.CLARITY_EXPORT_API_TOKEN)) {
    return { status: "not_configured", message: "Clarity export credentials or storefront mapping are missing." };
  }
  try {
    return await db.transaction(async (tx): Promise<CollectionResult> => {
      const [lock] = asRows(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`clarity-archive:${projectId}`}, 0)) AS acquired`));
      if (lock?.acquired !== true) return { status: "skipped", message: "Another collector is active." };
      const [state] = asRows(await tx.execute(sql`
        SELECT
          (SELECT max(window_end) FROM clarity_analytics_snapshots WHERE site_id = ${siteId} AND project_id = ${projectId})::text AS last_window_end,
          (SELECT last_attempt_at FROM clarity_analytics_sync_state WHERE site_id = ${siteId} AND project_id = ${projectId})::text AS last_attempt_at
      `));
      const now = Date.now();
      const lastWindowEnd = state?.last_window_end ? Date.parse(String(state.last_window_end)) : 0;
      const lastAttemptAt = state?.last_attempt_at ? Date.parse(String(state.last_attempt_at)) : 0;
      if (!claritySnapshotDue(lastWindowEnd, lastAttemptAt, now)) return { status: "skipped", message: "The next daily snapshot or six-hour retry is not due yet." };
      await tx.execute(sql`
        INSERT INTO clarity_analytics_sync_state (site_id, project_id, last_attempt_at)
        VALUES (${siteId}, ${projectId}, ${new Date(now).toISOString()})
        ON CONFLICT (site_id, project_id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at
      `);
      const result = await fetchClaritySnapshot(24);
      if (!result.report || result.status !== "connected") return { status: "error", message: result.message };
      const report = result.report;
      // Explicitly record gaps and keep the actual provider windows. Do not
      // manufacture a calendar-day total from a rolling-window API response.
      if (lastWindowEnd && Date.parse(report.windowStart) - lastWindowEnd > 60_000) {
        report.notes.push("A gap precedes this snapshot because the collector did not run at the previous window boundary.");
      }
      if (lastWindowEnd && Date.parse(report.windowStart) < lastWindowEnd) {
        report.notes.push("This snapshot has a small overlap with the previous one due to scheduler drift. Do not add snapshot counts together.");
      }
      await tx.execute(sql`
        INSERT INTO clarity_analytics_snapshots (site_id, project_id, window_start, window_end, report)
        VALUES (${siteId}, ${projectId}, ${report.windowStart}, ${report.windowEnd}, ${JSON.stringify(report)}::jsonb)
        ON CONFLICT (site_id, project_id, window_end) DO NOTHING
      `);
      return { status: "saved", message: "Saved one rolling 24-hour Clarity aggregate snapshot." };
    });
  } catch {
    return { status: "error", message: "Clarity archive collection failed. Check the database migration and integration configuration." };
  }
}
