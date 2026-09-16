import type { ReactNode } from "react";
import { getAnalyticsIntegrations, type IntegrationRange, type IntegrationResult } from "@/lib/analytics-integrations";
import { getClarityHistory } from "@/lib/clarity-snapshots";
import { formatINR } from "@/lib/utils";

const date = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
const metricName = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2");

function ProviderCard({ title, result, children }: { title: string; result: IntegrationResult<unknown>; children: ReactNode }) {
  return <section className="rounded-2xl border border-brand-line bg-white p-4 sm:p-5 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold text-brand-ink">{title}</h2>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.status === "connected" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>{result.status === "connected" ? "Report received" : result.status === "not_configured" ? "Connection needed" : "Report unavailable"}</span>
    </div>
    <p className="text-sm text-brand-ink-soft">{result.message}</p>
    {children}
    {result.fetchedAt && <p className="text-xs text-brand-ink-soft">Received {date(result.fetchedAt)} IST. Cached reports may refresh later.</p>}
    {result.dashboardUrl && <a href={result.dashboardUrl} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-brand-red underline underline-offset-4">Open {title}</a>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-brand-cream p-3"><div className="text-xs text-brand-ink-soft">{label}</div><div className="mt-1 font-semibold tabular-nums text-brand-ink">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</div></div>;
}

export async function IntegrationReports(range: IntegrationRange) {
  const [{ ga4, clarity }, history] = await Promise.all([getAnalyticsIntegrations(range), getClarityHistory(range)]);
  const g = ga4.report;
  const c = clarity.report;
  return <div className="space-y-4">
    <p className="text-sm text-brand-ink-soft">GA4 and Clarity measure different audiences and time windows. Read them alongside store sales; adding their totals would count some visitors more than once.</p>
    <ProviderCard title="Google Analytics 4" result={ga4}>
      {g && <>
        <p className="text-xs text-brand-ink-soft">{g.startDate} – {g.endDate} · {g.timeZone}</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <Metric label="Active users" value={g.activeUsers} /><Metric label="Sessions" value={g.sessions} /><Metric label="Pageviews" value={g.pageviews} />
          <Metric label="Engaged sessions" value={g.engagedSessions} /><Metric label="Purchase events" value={g.purchases} /><Metric label="Reported purchase revenue" value={formatINR(g.purchaseRevenue)} />
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="py-2 pr-3">Channel</th><th className="py-2 pr-3 text-right">Sessions</th><th className="py-2 text-right">Purchases</th></tr></thead><tbody>{g.channels.map((r) => <tr key={r.channel} className="border-t border-brand-line"><th className="py-2 pr-3 font-medium">{r.channel}</th><td className="py-2 pr-3 text-right">{r.sessions}</td><td className="py-2 text-right">{r.purchases}</td></tr>)}</tbody></table></div>
        {g.notes.map((note) => <p key={note} className="text-xs text-brand-ink-soft">{note}</p>)}
      </>}
    </ProviderCard>
    <ProviderCard title="Microsoft Clarity" result={clarity}>
      {c && <>
        <p className="text-sm font-medium text-brand-ink">Latest {c.windowHours} hours · independent of the selected sales dates</p>
        <p className="text-xs text-brand-ink-soft">{date(c.windowStart)} – {date(c.windowEnd)} IST</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">{c.metrics.flatMap((metric) => metric.values.map((v) => <Metric key={`${metric.name}-${v.label}`} label={`${metricName(metric.name)} · ${v.label}`} value={v.value} />))}</div>
        {c.notes.map((note) => <p key={note} className="text-xs text-brand-ink-soft">{note}</p>)}
      </>}
    </ProviderCard>
    <section className="rounded-2xl border border-brand-line bg-white p-4 sm:p-5 space-y-3">
      <h2 className="font-semibold text-brand-ink">Saved Clarity history</h2>
      <p className="text-sm text-brand-ink-soft">{history.message}</p>
      {history.status === "ready" && <p className="text-sm text-brand-ink-soft">{history.totalSnapshots} snapshots in the selected period; showing {history.snapshots.length}.</p>}
      <p className="text-sm text-brand-ink-soft">Daily snapshots preserve aggregate insights beyond the live API window; recordings stay in Clarity. Unique users and percentages are not added across days.</p>
      {history.firstCapturedAt && <p className="text-xs text-brand-ink-soft">Archive began {date(history.firstCapturedAt)} IST. Missing snapshots cannot be reconstructed from the order database.</p>}
      <div className="max-h-96 overflow-auto space-y-2">{history.snapshots.map((snapshot) => <details key={snapshot.windowEnd} className="rounded-xl border border-brand-line p-3">
        <summary className="cursor-pointer text-sm font-medium text-brand-ink">{date(snapshot.windowStart)} – {date(snapshot.windowEnd)} IST</summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">{snapshot.metrics.flatMap((metric) => metric.values.map((value) => <div key={`${metric.name}-${value.label}`} className="text-sm"><dt className="text-brand-ink-soft">{metricName(metric.name)} · {value.label}</dt><dd className="font-medium tabular-nums">{value.value.toLocaleString("en-IN")}</dd></div>))}</dl>
        {snapshot.notes.map((note) => <p key={note} className="mt-2 text-xs text-brand-ink-soft">{note}</p>)}
      </details>)}</div>
    </section>
  </div>;
}
