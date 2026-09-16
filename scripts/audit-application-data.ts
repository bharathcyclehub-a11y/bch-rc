/**
 * Read-only aggregate audit; prints no customer identities or credentials.
 * node --env-file=.env.local --import tsx scripts/audit-application-data.ts --from=2025-01-01 --to=2026-09-11
 * Optional --site=prc. Without it, audits all site IDs in the configured DB.
 */
import { parseAnalyticsRange } from "../src/lib/analytics-range";

async function main() {
  if (!process.env.DATABASE_URL_POOLED && !process.env.DATABASE_URL) {
    console.error("Audit not run: configure DATABASE_URL_POOLED or DATABASE_URL. No live data was checked.");
    process.exitCode = 2;
    return;
  }
  const params = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const index = arg.indexOf("=");
    return [arg.slice(2, index), arg.slice(index + 1)];
  }));
  const window = parseAnalyticsRange(params);
  if (window.error) throw new Error(window.error);
  const [{ db }, { sites }, { getAnalyticsQuality }] = await Promise.all([
    import("../src/db"), import("../src/db/schema"), import("../src/lib/analytics-quality"),
  ]);
  const available = (await db.select({ id: sites.id }).from(sites)).map((s) => s.id);
  if (params.site && !available.includes(params.site)) throw new Error("Unknown site ID.");
  const siteIds = params.site ? [params.site] : available;
  const report = await getAnalyticsQuality(siteIds, window);
  console.log(JSON.stringify({ period: window.label, timeZone: "Asia/Kolkata", siteIds, ...report }, null, 2));
  process.exitCode = report.checks.some((check) => check.count > 0) ? 1 : 0;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(() => {
  console.error("Audit failed. Check the configured database connection, schema and date arguments. No clean result is assumed.");
  process.exit(2);
});
