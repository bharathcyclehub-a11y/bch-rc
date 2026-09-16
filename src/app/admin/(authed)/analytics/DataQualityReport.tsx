import { getAnalyticsQuality } from "@/lib/analytics-quality";
import type { MetricWindow } from "@/lib/analytics-range";

const date = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "No records";

export async function DataQualityReport({ siteIds, window }: { siteIds: string[]; window: MetricWindow }) {
  let report;
  try {
    report = await getAnalyticsQuality(siteIds, window);
  } catch {
    return <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">Data checks could not run. Check database connectivity and applied migrations, then reload. No healthy result is assumed.</div>;
  }
  const warnings = report.checks.filter((c) => c.count > 0).length;
  return <div className="space-y-4">
    <div className="rounded-2xl border border-brand-line bg-white p-4 sm:p-5">
      <h2 className="font-semibold text-brand-ink">{warnings ? `${warnings} checks need review` : "No issues detected by these checks"}</h2>
      <p className="mt-2 text-sm text-brand-ink-soft">Checked {report.ordersChecked.toLocaleString("en-IN")} orders, {report.sessionsChecked.toLocaleString("en-IN")} sessions and {report.eventsChecked.toLocaleString("en-IN")} events in the selected period. Read-only check at {date(report.checkedAt)} IST.</p>
      <p className="mt-2 text-xs text-brand-ink-soft">These checks do not prove GA4/Clarity receipt or payment settlement. Zero records may mean no activity or missing collection.</p>
      <p className="mt-2 text-sm text-amber-900">Refund handling needs a separate reconciliation: partial refunds and refunds before goods are returned can affect sales and inventory accuracy. Active sales are not net cash receipts.</p>
    </div>
    <div className="rounded-2xl border border-brand-line bg-white divide-y divide-brand-line">
      {report.checks.map((c) => <div key={c.key} className="p-4 sm:p-5 flex items-start justify-between gap-4">
        <div><h3 className="text-sm font-semibold text-brand-ink">{c.label}</h3><p className="mt-1 text-sm text-brand-ink-soft">{c.explanation}</p></div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${c.count ? "bg-amber-100 text-amber-900" : "bg-brand-cream text-brand-ink"}`}>{c.count ? `${c.count.toLocaleString("en-IN")} to review` : "0 flagged"}</span>
      </div>)}
    </div>
    <div className="rounded-2xl border border-brand-line bg-white p-4 sm:p-5">
      <h2 className="font-semibold text-brand-ink">Available history · all dates</h2>
      <p className="mt-1 text-sm text-brand-ink-soft">Dates below show stored records, not a guarantee of uninterrupted collection. Reports cannot recover tracking from before collection began.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Earliest (IST)</th><th className="py-2">Latest (IST)</th></tr></thead><tbody>{report.history.map((h) => <tr className="border-t border-brand-line" key={h.source}><th className="py-2 pr-3 font-medium">{h.source}</th><td className="py-2 pr-3">{date(h.first)}</td><td className="py-2">{date(h.latest)}</td></tr>)}</tbody></table></div>
    </div>
  </div>;
}
