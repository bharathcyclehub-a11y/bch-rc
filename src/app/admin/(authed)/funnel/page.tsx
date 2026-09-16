import { AlertTriangle, Info, Activity } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { getFunnelReport } from "@/lib/funnel-queries";
import { clampPct, safePct } from "@/lib/analytics-validation";
import { RangeTabs } from "../RangeTabs";
import { parseAnalyticsRange, type AnalyticsSearchParams } from "@/lib/analytics-range";

export const dynamic = "force-dynamic";

function pct(x: number): string {
  return `${x.toFixed(x < 10 ? 1 : 0)}%`;
}

export default async function FunnelDashboard({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;
  const range = parseAnalyticsRange({ ...sp, range: sp.range ?? sp.window }, { defaultDays: 7 });

  // Single combined store — aggregate across every site this admin manages.
  const report = await getFunnelReport(ctx.siteIds, range.days, range);

  const top = report.stages[0]?.visitors ?? 0;
  const paid = report.stages[report.stages.length - 1]?.visitors ?? 0;
  const overallConv = safePct(paid, top);
  const maxBar = Math.max(1, top);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-brand-ink flex items-center gap-2">
            <Activity size={22} className="text-brand-red" /> Conversion funnel
          </h1>
          <p className="text-sm text-brand-ink-soft mt-1">
            Recorded reach at each shopping stage, with order totals from the sales ledger.
          </p>
        </div>
        <RangeTabs key={range.query} presets={[1, 7, 30, 90, 365]} defaultRange={7} custom calendar />
      </div>

      <p className="text-sm text-brand-ink-soft">{range.label} · IST</p>
      {range.error && <p role="alert" className="text-sm text-brand-red">{range.error}</p>}
      {/* Headline KPIs */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Kpi label="Visitors" value={top.toLocaleString("en-IN")} />
        <Kpi label="Sale buyers" value={paid.toLocaleString("en-IN")} />
        <Kpi
          label="Buyers / visitors"
          value={top > 0 ? pct(overallConv) : "—"}
          accent
          sub={top > 0 ? `${paid.toLocaleString("en-IN")} of ${top.toLocaleString("en-IN")}` : undefined}
        />
      </div>

      {/* Callouts */}
      <div className="space-y-3">
        {report.serviceability.total > 0 && report.serviceability.blockedPct >= 40 && (
          <Callout tone="red" icon={<AlertTriangle size={18} className="text-brand-red shrink-0 mt-0.5" />}>
            <b>{pct(report.serviceability.blockedPct)} of pincode checks were rejected</b>{" "}
            ({report.serviceability.blocked} of {report.serviceability.total}). If this is high,
            checkout may be blocking real customers — check the pickup config and the
            blocked-pincodes list below.
          </Callout>
        )}

        {report.anomalies.length > 0 && (
          <Callout tone="blue" icon={<Info size={18} className="text-blue-600 shrink-0 mt-0.5" />}>
            <b className="block">Measurement notes</b>
            {report.anomalies.map((a, i) => (
              <p key={i}>{a}</p>
            ))}
          </Callout>
        )}

        {report.visitors > 0 && report.coveragePct < 95 && (
          <Callout tone="blue" icon={<Info size={18} className="text-blue-600 shrink-0 mt-0.5" />}>
            <b className="block">
              Client-side events cover {Math.round(report.coveragePct)}% of visitors
            </b>
            <p>
              Visits come from recorded sessions and buyers from the order ledger.
              Steps 2–4 depend on browser events. For this period,{" "}
              <b>{(report.visitors - report.trackedVisitors).toLocaleString("en-IN")} visitors</b>{" "}
              did not send a page-view event. Missing events and session-boundary differences
              limit comparison with recorded visits; this is not a count of confirmed drop-offs.
            </p>
          </Callout>
        )}


      </div>

      {/* The funnel */}
      <div className="rounded-2xl border border-brand-line bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-brand-line">
          <h2 className="font-semibold text-brand-ink">Funnel steps</h2>
          <span className="text-xs text-brand-ink-soft">
            {range.label} · recorded reach
          </span>
        </div>
        <div className="p-3 sm:p-5 space-y-1.5">
          {report.stages.map((s, i) => {
            // Display measured counts without inflating missing browser events.
            const shown = s.visitors;
            const widthPct = clampPct((shown / maxBar) * 100);
            const kept = s.fromTopPct;
            const weak = i > 0 && kept < 50;
            return (
              <div key={s.key}>
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="grid place-items-center h-6 w-6 shrink-0 rounded-full bg-brand-cream text-[11px] font-bold tabular-nums text-brand-ink-soft">
                    {i + 1}
                  </span>
                  <span className="w-24 sm:w-44 shrink-0 text-sm font-medium text-brand-ink truncate">
                    {s.label}
                  </span>
                  <div className="relative h-8 sm:h-9 flex-1 rounded-lg bg-brand-cream overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-brand-red to-brand-red/65"
                      style={{ width: `${shown > 0 ? Math.max(widthPct, 2) : 0}%` }}
                    />
                  </div>
                  <span
                    className="w-12 sm:w-20 text-right font-bold tabular-nums text-brand-ink text-sm"
                    title={s.clientTracked ? "Observed browser visitors; blocked events are missing" : "Recorded total"}
                  >
                    {shown.toLocaleString("en-IN")}

                  </span>
                  <span
                    className={`w-11 text-right text-xs font-semibold tabular-nums ${
                      i === 0 ? "text-brand-ink-soft/40" : weak ? "text-brand-red" : "text-success"
                    }`}
                    title="Recorded reach as a share of all recorded visitors"
                  >
                    {i === 0 || top === 0 ? "—" : pct(kept)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Why they leak */}
      <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
        <InsightCard
          title="Pincodes we rejected"
          hint="Customers told “no courier serves this pincode.” A flood of these = a config/courier problem, not real unserviceable areas."
        >
          {report.blockedPincodes.length === 0 ? (
            <Empty>No rejected pincode checks recorded in this period.</Empty>
          ) : (
            <ul className="divide-y divide-brand-line">
              {report.blockedPincodes.map((p) => (
                <li key={p.pincode} className="flex justify-between px-4 sm:px-5 py-2.5 text-sm">
                  <span className="font-mono text-brand-ink">{p.pincode}</span>
                  <span className="text-brand-ink-soft tabular-nums">
                    {p.visitors} {p.visitors === 1 ? "person" : "people"} · {p.checks} checks
                  </span>
                </li>
              ))}
            </ul>
          )}
        </InsightCard>

        <InsightCard
          title="Payment failures"
          hint="Reasons Razorpay reported when a payment failed at the modal."
        >
          {report.paymentFailures.length === 0 ? (
            <Empty>No payment failures recorded in this period.</Empty>
          ) : (
            <ul className="divide-y divide-brand-line">
              {report.paymentFailures.map((f, i) => (
                <li key={i} className="flex justify-between gap-3 px-4 sm:px-5 py-2.5 text-sm">
                  <span className="text-brand-ink truncate">{f.reason}</span>
                  <span className="text-brand-ink-soft shrink-0 tabular-nums">{f.n}</span>
                </li>
              ))}
            </ul>
          )}
        </InsightCard>
      </div>

      <p className="text-xs text-brand-ink-soft leading-relaxed">
        Counts show observed activity; missing browser events are never replaced with estimates.
        Each stage is counted independently, so visitors may skip stages. Visitor cookies and
        customer records use different identities, and this is not an ordered cohort funnel.
        “Sale buyers” includes accepted COD sales and does not mean COD cash was collected.
        Tracking history starts when collection was enabled; periods without events are not proof
        that no visits or purchases occurred.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-white p-3 sm:p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink-soft">{label}</div>
      <div className={`mt-1 text-xl sm:text-2xl font-bold tabular-nums ${accent ? "text-brand-red" : "text-brand-ink"}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-brand-ink-soft mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

const CALLOUT_TONE: Record<"red" | "amber" | "blue", string> = {
  red: "border-brand-red/30 bg-brand-red/5 text-brand-red",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  blue: "border-blue-300 bg-blue-50 text-blue-900",
};

function Callout({ tone, icon, children }: { tone: "red" | "amber" | "blue"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-3 sm:p-4 flex gap-3 text-sm ${CALLOUT_TONE[tone]}`}>
      {icon}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function InsightCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-white overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-brand-line">
        <h2 className="font-semibold text-brand-ink">{title}</h2>
        <p className="text-xs text-brand-ink-soft mt-1">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-brand-ink-soft">{children}</p>;
}
