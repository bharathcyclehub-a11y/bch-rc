import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck, Clock, IndianRupee, OctagonAlert, Truck, type LucideIcon } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { formatRelative, requestTime } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { TONE_DOT, type Tone } from "@/lib/admin/status";
import { isMissingTableError, loadSupportDashboard, type AttentionItem, type SupportDashboard } from "@/lib/support/admin-queries";
import { EXCEPTION_LABEL, type ExceptionType } from "@/lib/tracking/assess";
import { formatIST, formatINR, cn } from "@/lib/utils";
import { ButtonLink } from "@/components/admin/Button";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { Panel, PanelHeader } from "@/components/admin/Panel";
import { NewTicketButton } from "./tickets/NewTicketButton";
import { categoryLabel, formatDuration, NoAccessNotice, shortEmail, SupportSetupNotice } from "./ticket-ui";

/**
 * Support dashboard — the morning view for the support desk. Every number is
 * a live query scoped to the operator's sites (src/lib/support/admin-queries.ts);
 * each card links to the list that explains it.
 */
export default async function SupportDashboardPage() {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.view")) return <NoAccessNotice title="Support" />;
  const now = new Date(requestTime());

  let data: SupportDashboard;
  try {
    data = await loadSupportDashboard(ctx.siteIds, now);
  } catch (err) {
    if (isMissingTableError(err)) return <SupportSetupNotice title="Support" />;
    throw err;
  }
  const m = data.metrics;
  const today = formatIST(now, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/g, "Sep");

  return (
    <>
      <PageHeader
        title="Support"
        description={<span className="block truncate">{today} · {fmt(m.open)} open · {fmt(m.unanswered)} waiting on us</span>}
        actions={
          <>
            <ButtonLink href="/admin/support/tickets">All tickets</ButtonLink>
            {can(ctx.role, "support.reply") && <NewTicketButton variant="primary" />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricLink href="/admin/support/tickets" label="Open tickets" value={m.open} hint="All open statuses" />
        <MetricLink
          href="/admin/support/tickets?view=unassigned"
          label="Unassigned"
          value={m.unassigned}
          hint={m.unassigned ? "Needs triage" : "All assigned"}
          tone={m.unassigned ? "attention" : undefined}
        />
        <MetricLink
          href="/admin/support/tickets?priority=CRITICAL"
          label="Critical"
          value={m.critical}
          hint={m.critical ? "Safety / delivered-not-received" : "None open"}
          tone={m.critical ? "negative" : undefined}
        />
        <MetricLink
          href="/admin/support/tickets?focus=breached"
          label="SLA breaches"
          value={m.slaBreaches}
          hint={m.slaBreaches ? "First reply overdue" : "On target"}
          tone={m.slaBreaches ? "negative" : undefined}
        />
        <MetricLink
          href="/admin/support/exceptions"
          label="Delivery delays"
          value={m.deliveryDelays}
          hint="Estimate missed · no movement · courier delay"
          tone={m.deliveryDelays ? "attention" : undefined}
        />
        <MetricLink
          href="/admin/support/exceptions?type=SYNC_FAILING"
          label="Tracking sync failures"
          value={m.syncFailures}
          hint={m.syncFailures ? "Courier data stale" : "All syncing"}
          tone={m.syncFailures ? "negative" : "positive"}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MiniStat href="/admin/support/exceptions?type=RTO" label="RTO cases" value={m.rto} tone="negative" />
        <MiniStat href="/admin/support/tickets?focus=replacements" label="Pending replacements" value={m.pendingReplacements} tone="attention" />
        <MiniStat
          href="/admin/support/tickets?focus=refunds"
          label="Pending refunds"
          value={m.pendingRefunds}
          tone="attention"
          sub={m.refundsAwaitingApproval ? `${fmt(m.refundsAwaitingApproval)} awaiting approval` : undefined}
        />
        <MiniStat href="/admin/support/tickets?focus=unanswered" label="Unanswered conversations" value={m.unanswered} tone="info" />
        <MiniStat href="/admin/orders" label="Failed shipments" value={m.failedShipments} tone="negative" sub="Shipment job failed, order still open" />
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <NeedsAttention items={data.attention} now={now} />
        <ThisWeek week={data.week} now={now} />
      </div>
    </>
  );
}

// ── Metric cards ────────────────────────────────────────────────────────────

const TONE_VALUE: Partial<Record<Tone, string>> = { negative: "text-tone-neg", attention: "text-tone-warn" };

function MetricLink({ href, label, value, hint, tone }: { href: string; label: string; value: number; hint: string; tone?: Tone }) {
  return (
    <Link
      href={href}
      className="group min-w-0 rounded-xl border border-admin-line bg-white p-4 transition-colors hover:border-admin-line-strong focus-visible:outline-2 focus-visible:outline-brand-red"
    >
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold leading-7 tabular-nums text-brand-ink", value > 0 && tone && TONE_VALUE[tone])}>
        {fmt(value)}
      </p>
      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-admin-muted">
        {tone && value > 0 && <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />}
        <span className="truncate">{hint}</span>
      </p>
    </Link>
  );
}

function MiniStat({ href, label, value, tone, sub }: { href: string; label: string; value: number; tone: Tone; sub?: string }) {
  return (
    <Link
      href={href}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-admin-line bg-white px-4 py-3 transition-colors hover:border-admin-line-strong focus-visible:outline-2 focus-visible:outline-brand-red"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-brand-ink">{label}</p>
        {sub && <p className="truncate text-xs text-admin-muted">{sub}</p>}
      </div>
      <span className="text-lg font-semibold tabular-nums text-brand-ink">{fmt(value)}</span>
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", value > 0 ? TONE_DOT[tone] : "bg-admin-line-strong")} />
    </Link>
  );
}

// ── Needs attention ─────────────────────────────────────────────────────────

function NeedsAttention({ items, now }: { items: AttentionItem[]; now: Date }) {
  const t = now.getTime();
  return (
    <Panel>
      <PanelHeader
        title="Needs attention"
        description="Critical tickets, SLA breaches, escalated deliveries and refunds awaiting approval — most urgent first"
        actions={items.length > 0 ? <span className="rounded-full bg-brand-red-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-brand-red">{items.length}</span> : undefined}
      />
      {items.length === 0 ? (
        <EmptyState icon={CircleCheck} compact title="Nothing needs attention" description="No critical tickets, SLA breaches, escalations or refunds waiting." />
      ) : (
        <ul className="divide-y divide-admin-line">
          {items.map((it) => {
            switch (it.kind) {
              case "critical":
                return (
                  <AttentionRow
                    key={`c-${it.id}`}
                    icon={OctagonAlert}
                    tone="negative"
                    href={`/admin/support/tickets/${it.id}`}
                    action={it.assignedTo ? "Open" : "Assign"}
                    meta={`Opened ${formatRelative(it.at, t).toLowerCase()} · ${it.assignedTo ? `assigned to ${shortEmail(it.assignedTo)}` : "unassigned"}${it.breached ? " · first reply overdue" : ""}`}
                  >
                    <Mono>{it.number}</Mono> is <span className="font-semibold text-tone-neg">critical</span>
                    {it.reason ? <> — {it.reason}</> : null}
                  </AttentionRow>
                );
              case "sla":
                return (
                  <AttentionRow
                    key={`s-${it.id}`}
                    icon={Clock}
                    tone="negative"
                    href={`/admin/support/tickets/${it.id}`}
                    action="Reply"
                    meta={`First reply was due ${formatDuration(t - it.dueAt.getTime())} ago`}
                  >
                    <Mono>{it.number}</Mono> breached its first-response SLA — {it.subject}
                  </AttentionRow>
                );
              case "exception":
                return (
                  <AttentionRow
                    key={`e-${it.id}`}
                    icon={Truck}
                    tone="attention"
                    href={`/admin/orders/${it.orderId}`}
                    action="Investigate"
                    meta={`Escalated ${formatRelative(it.escalatedAt, t).toLowerCase()}${it.detail ? ` · ${it.detail}` : ""}`}
                  >
                    <Mono>{it.orderId}</Mono> {(EXCEPTION_LABEL[it.type as ExceptionType] ?? it.type).toLowerCase()}
                  </AttentionRow>
                );
              case "refund":
                return (
                  <AttentionRow
                    key={`r-${it.id}`}
                    icon={IndianRupee}
                    tone="attention"
                    href={it.ticketId ? `/admin/support/tickets/${it.ticketId}` : `/admin/orders/${it.orderId}`}
                    action="Review"
                    meta={`Requested ${formatRelative(it.at, t).toLowerCase()}${it.ticketNumber ? ` · ticket ${it.ticketNumber}` : ""} · ${it.method === "MANUAL" ? "bank/UPI transfer" : "Razorpay"}`}
                  >
                    Refund {formatINR(it.amountInr)} for <Mono>{it.orderId}</Mono> awaits finance approval
                  </AttentionRow>
                );
            }
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-admin-line px-4 py-3 text-xs text-admin-muted sm:px-5">
        <span>Showing up to 5 of each kind</span>
        <Link href="/admin/support/tickets?view=open" className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline">
          Open ticket queue <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </Panel>
  );
}

const ICON_TONE: Record<string, string> = {
  negative: "bg-tone-neg-bg text-tone-neg",
  attention: "bg-tone-warn-bg text-tone-warn",
};

function AttentionRow({
  icon: Icon,
  tone,
  href,
  action,
  meta,
  children,
}: {
  icon: LucideIcon;
  tone: "negative" | "attention";
  href: string;
  action: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", ICON_TONE[tone])}>
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-brand-ink">{children}</p>
        <p className="mt-0.5 truncate text-xs text-admin-muted" title={meta}>{meta}</p>
      </div>
      <ButtonLink href={href} size="sm" className="shrink-0">
        {action} <ArrowRight size={13} aria-hidden />
      </ButtonLink>
    </li>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="rounded bg-admin-subtle px-1 py-px font-mono text-[12px] font-medium">{children}</span>;
}

// ── This week ───────────────────────────────────────────────────────────────

function ThisWeek({ week, now }: { week: SupportDashboard["week"]; now: Date }) {
  const max = Math.max(1, ...week.days.map((d) => d.count));
  const todayYmd = week.days[week.days.length - 1]?.ymd;
  const first = week.days[0]?.ymd;
  const range = first ? `${dayLabel(first, { day: "numeric", month: "short" })} – ${formatIST(now, { day: "numeric", month: "short" })}` : "";
  const slaPct = week.resolved > 0 ? Math.round((week.resolvedInSla / week.resolved) * 100) : null;
  const catMax = Math.max(1, ...week.topCategories.map((c) => c.count));

  return (
    <Panel>
      <PanelHeader title="This week" description={`Last 7 days (IST) · ${range}`} />
      <div className="space-y-5 p-4 sm:p-5">
        <section aria-labelledby="tickets-per-day">
          <div className="flex items-baseline justify-between">
            <h3 id="tickets-per-day" className="text-[13px] font-medium text-brand-ink">Tickets created</h3>
            <span className="text-[13px] font-semibold tabular-nums text-brand-ink">{fmt(week.total)} total</span>
          </div>
          <div aria-hidden className="mt-3 flex h-32 items-end gap-0.5">
            {week.days.map((d) => {
              const isToday = d.ymd === todayYmd;
              const isPeak = d.count === max && d.count > 0;
              const label = `${dayLabel(d.ymd, { weekday: "short", day: "numeric", month: "short" })}: ${fmt(d.count)} ticket${d.count === 1 ? "" : "s"}`;
              return (
                <div key={d.ymd} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={label}>
                  <span
                    className={cn(
                      "mb-1 text-[11px] tabular-nums text-admin-muted",
                      !(isToday || isPeak) && "invisible group-hover:visible",
                    )}
                  >
                    {d.count}
                  </span>
                  <div
                    className={cn(
                      "w-full max-w-10 rounded-t transition-colors",
                      isToday ? "bg-brand-ink" : "bg-admin-line-strong group-hover:bg-brand-ink-soft",
                    )}
                    style={{ height: d.count > 0 ? `${Math.max(4, (d.count / max) * 100)}%` : "2px" }}
                  />
                </div>
              );
            })}
          </div>
          <div aria-hidden className="mt-1.5 flex gap-0.5 border-t border-admin-line pt-1.5">
            {week.days.map((d) => (
              <span
                key={d.ymd}
                className={cn("min-w-0 flex-1 text-center text-[11px]", d.ymd === todayYmd ? "font-semibold text-brand-ink" : "text-admin-muted")}
              >
                {dayLabel(d.ymd, { weekday: "short" })}
              </span>
            ))}
          </div>
          <table className="sr-only">
            <caption>Tickets created per day, last 7 days</caption>
            <tbody>
              {week.days.map((d) => (
                <tr key={d.ymd}>
                  <th scope="row">{dayLabel(d.ymd, { weekday: "long", day: "numeric", month: "long" })}</th>
                  <td>{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-admin-line bg-admin-page p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">Median first response</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums text-brand-ink">
              {week.medianFirstResponseMin == null ? "—" : formatDuration(week.medianFirstResponseMin * 60_000)}
            </p>
            <p className="mt-0.5 text-xs text-admin-muted">
              {week.firstResponseSample ? `${fmt(week.firstResponseSample)} answered · clock time` : "No replies yet this week"}
            </p>
          </div>
          <div className="rounded-lg border border-admin-line bg-admin-page p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">Resolved in SLA</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums text-brand-ink">{slaPct == null ? "—" : `${slaPct}%`}</p>
            <p className="mt-0.5 text-xs text-admin-muted">
              {week.resolved ? `${fmt(week.resolvedInSla)} of ${fmt(week.resolved)} resolved` : "Nothing resolved yet this week"}
            </p>
          </div>
        </div>

        <section aria-labelledby="top-categories">
          <h3 id="top-categories" className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">
            Top categories
          </h3>
          {week.topCategories.length === 0 ? (
            <p className="mt-2 text-[13px] text-admin-muted">No tickets this week.</p>
          ) : (
            <ol className="mt-2 space-y-2.5">
              {week.topCategories.map((c, i) => (
                <li key={c.category}>
                  <Link
                    href={`/admin/support/tickets?view=all&category=${encodeURIComponent(c.category)}`}
                    className="flex items-baseline justify-between gap-2 text-[13px] text-brand-ink hover:underline"
                  >
                    <span className="truncate">
                      {i + 1}. {categoryLabel(c.category)}
                    </span>
                    <span className="tabular-nums">{fmt(c.count)}</span>
                  </Link>
                  <div aria-hidden className="mt-1 h-1.5 rounded-full bg-admin-subtle">
                    <div className="h-full rounded-full bg-brand-ink" style={{ width: `${(c.count / catMax) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Panel>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Format an IST calendar day key ("2026-10-09") — noon IST keeps it on the same day. */
function dayLabel(ymd: string, opts: Intl.DateTimeFormatOptions): string {
  return formatIST(new Date(`${ymd}T12:00:00+05:30`), opts).replace(/\bSept\b/g, "Sep");
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
