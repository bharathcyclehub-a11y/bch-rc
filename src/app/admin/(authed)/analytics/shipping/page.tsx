import type { ReactNode } from "react";
import { Database, Lock } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { parseAnalyticsRange, type AnalyticsSearchParams } from "@/lib/analytics-range";
import { isMissingTableError } from "@/lib/support/admin-queries";
import { COURIER_PROVIDER_LABEL } from "@/lib/couriers";
import type { CourierProvider } from "@/lib/couriers/types";
import type { RoutingReason } from "@/lib/couriers/routing";
import { formatIST } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/admin/Panel";
import { EmptyState } from "@/components/admin/EmptyState";
import { Metric } from "@/components/admin/Metric";
import { Table, TBody, TD, TH, THead, TR } from "@/components/admin/Table";
import { RangeTabs } from "../../RangeTabs";
import {
  DELIVERY_EXCEPTION_TYPES,
  PICKUP_EXCEPTION_TYPES,
  WEIGHT_SLAB_GRAMS,
  loadShippingReport,
  type BreakdownRow,
  type ProviderSummary,
  type RoutingRow,
  type ShippingReport,
} from "./queries";

export const dynamic = "force-dynamic";

const TITLE = "Shipping costs";
const MIGRATION = "src/db/migrations/manual/2026-10-12_courier_provider.sql";

const REASON_LABEL: Record<RoutingReason, string> = {
  PREFERRED_ELIGIBLE: "Preferred provider eligible",
  PREFERRED_CHEAPER: "Preferred provider cheaper",
  ALTERNATIVE_CHEAPER: "Other provider cheaper",
  PREFERRED_COST_UNVERIFIED: "Preferred; prices not comparable",
  COST_UNVERIFIED_REVIEW: "Prices not comparable; staff review",
  FALLBACK: "Fallback; preferred not eligible",
  NO_ELIGIBLE_PROVIDER: "No eligible provider",
  REVIEW_ORDER_VALUE: "Order value above review threshold",
  INVALID_PINCODE: "Invalid pincode",
  INVALID_PARCEL: "Invalid parcel",
};

const reasonLabel = (code: string) => REASON_LABEL[code as RoutingReason] ?? code;
const providerLabel = (p: CourierProvider | null) => (p ? COURIER_PROVIDER_LABEL[p] : "None (staff review)");

/** Paise → "₹1,234" (sums) or "₹1,234.50" (averages). */
function inr(paise: number, decimals = 0): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
const avgInr = (sum: number, n: number) => (n > 0 ? inr(sum / n, 2) : "—");
function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—";
}
function signedInr(paise: number): string {
  return `${paise > 0 ? "+" : paise < 0 ? "−" : ""}${inr(Math.abs(paise), 2)}`;
}
function slabLabel(grams: number | string | null): string {
  if (typeof grams !== "number") return "Not recorded";
  const kg = (g: number) => (g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return grams <= WEIGHT_SLAB_GRAMS ? `≤ ${kg(grams)} kg` : `${kg(grams - WEIGHT_SLAB_GRAMS)}–${kg(grams)} kg`;
}

function Notice({ icon, title, description }: { icon: typeof Lock; title: string; description: ReactNode }) {
  return (
    <>
      <PageHeader title={TITLE} />
      <Panel>
        <EmptyState icon={icon} title={title} description={description} />
      </Panel>
    </>
  );
}

export default async function ShippingCostsPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "shipping.costs")) {
    return <Notice icon={Lock} title="No access" description="Your role can't open shipping costs. Ask an owner if you need it." />;
  }

  // Same parser + control as Analytics, so a preset means the same IST span.
  const win = parseAnalyticsRange(await searchParams);

  let report: ShippingReport;
  try {
    report = await loadShippingReport(ctx.siteIds, win.start, win.end);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return (
      <Notice
        icon={Database}
        title="Courier columns aren't in the database yet"
        description={
          <>
            Apply <span className="font-mono text-xs">{MIGRATION}</span> (after the shipment tracking migration), then reload.
          </>
        }
      />
    );
  }

  const { providers, byZone, byWeight, routing, sync } = report;
  const total = providers.reduce(
    (t, p) => ({
      booked: t.booked + p.booked,
      cod: t.cod + p.cod,
      quotedN: t.quotedN + p.quotedN,
      quotedSum: t.quotedSum + p.quotedSum,
      billedN: t.billedN + p.billedN,
      billedSum: t.billedSum + p.billedSum,
    }),
    { booked: 0, cod: 0, quotedN: 0, quotedSum: 0, billedN: 0, billedSum: 0 },
  );
  const savings = routing.reduce(
    (t, r) => ({
      decisions: t.decisions + r.n,
      comparable: t.comparable + r.comparableN,
      n: t.n + r.savingsN,
      sum: t.sum + r.savingsSum,
      followedN: t.followedN + r.savingsFollowedN,
      followedSum: t.followedSum + r.savingsFollowedSum,
    }),
    { decisions: 0, comparable: 0, n: 0, sum: 0, followedN: 0, followedSum: 0 },
  );

  return (
    <>
      <PageHeader
        title={TITLE}
        description={`${win.label} · IST · orders by placement date · Shiprocket vs Delhivery direct`}
        actions={<RangeTabs key={win.query} presets={[7, 30, 90, 365]} defaultRange={30} custom calendar />}
      />
      <div className="space-y-4 sm:space-y-5">
        {win.error && (
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {win.error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Shipments booked" value={total.booked} hint={`${total.booked - total.cod} prepaid · ${total.cod} COD`} />
          <Metric
            label="Quoted cost"
            value={inr(total.quotedSum)}
            hint={`${total.quotedN} of ${total.booked} have a stored quote`}
          />
          <Metric
            label="Billed cost"
            value={total.billedN > 0 ? inr(total.billedSum) : "—"}
            hint={`${total.billedN} of ${total.booked} entered from invoices`}
            hintTone={total.booked > 0 && total.billedN === 0 ? "attention" : undefined}
          />
          <Metric
            label="Est. savings"
            value={savings.n > 0 ? signedInr(savings.sum) : "—"}
            hint={`like-for-like quotes · ${savings.n} of ${savings.decisions} decisions`}
          />
        </div>

        <ProviderTable providers={providers} sync={sync} />

        {/* Side by side only where both five-column tables fit without a scrollbar. */}
        <div className="grid gap-4 2xl:grid-cols-2">
          <BreakdownPanel
            title="Cost by destination zone"
            description="Zone from the booked provider's own quote; zone codes differ by provider. Not recorded = no stored quote, or the quote gave no zone."
            keyLabel="Zone"
            rows={byZone}
            label={(k) => (k === null ? "Not recorded" : String(k))}
          />
          <BreakdownPanel
            title="Cost by charged weight"
            description={`Charged weight from the booked provider's quote, in ${WEIGHT_SLAB_GRAMS} g slabs. Not recorded = no stored quote, or no weight in it.`}
            keyLabel="Weight"
            rows={byWeight}
            label={slabLabel}
          />
        </div>

        <RoutingPanels rows={routing} />

        <Panel>
          <PanelHeader
            title="Savings from routing"
            description="Estimated from quotes. Not invoices, and not confirmed."
          />
          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
            <Metric
              label="Estimated (like-for-like quotes)"
              value={savings.n > 0 ? signedInr(savings.sum) : "—"}
              hint={`${savings.n} of ${savings.decisions} decisions had comparable quotes`}
            />
            <Metric
              label="Of which booked as recommended"
              value={savings.followedN > 0 ? signedInr(savings.followedSum) : "—"}
              hint={`${savings.followedN} orders; the rest are shadow or overridden`}
            />
            <Metric label="Confirmed savings" value="Not measurable yet" hint="needs both providers' bills for one parcel" />
          </div>
          <PanelBody className="border-t border-admin-line pt-3 text-xs leading-5 text-admin-muted sm:pt-4">
            Estimated savings add up the routing engine&rsquo;s figure: the other provider&rsquo;s quote minus the recommended
            one, counted only when both quotes were like-for-like (same confidence and tax basis) and the other provider could
            have taken the parcel. A negative total means the recommendations cost more than the alternative would have.
            Shadow decisions are recommendations only; those orders were booked on Shiprocket anyway. Confirmed savings need
            what <b>both</b> providers billed for the <b>same</b>{" "}
            parcel. A parcel is only ever carried and billed by one provider, so that comparison does not exist for any order. The nearest real check is each provider&rsquo;s
            billed-vs-quoted gap in the table above.
          </PanelBody>
        </Panel>

        <p className="text-xs leading-5 text-admin-muted">
          Booked: Delhivery orders with a waybill, Shiprocket orders with a Shiprocket order id, plus anything dispatched.
          Quoted cost is the booked provider&rsquo;s quote stored at booking. Shiprocket quotes are for its cheapest surface
          courier, before staff pick the actual courier, and don&rsquo;t state tax. Billed cost is entered by staff from
          provider invoices and is never estimated. Pickup failure = a &ldquo;{PICKUP_EXCEPTION_TYPES.join(", ")}&rdquo;
          exception ÷ booked. Delivery exceptions = {DELIVERY_EXCEPTION_TYPES.join(", ")} ÷ dispatched. RTO = returned ÷
          dispatched (shipped, delivered or returned), the same rule as Returns / RTO. Delivery time = delivered − shipped
          (courier pickup), for delivered orders. Orders placed before the courier migration count as Shiprocket with no
          stored quote.
        </p>
      </div>
    </>
  );
}

// ── Per-provider comparison ─────────────────────────────────────────────────

type Cell = { value: ReactNode; sub?: ReactNode };

function ProviderTable({ providers, sync }: { providers: ProviderSummary[]; sync: ShippingReport["sync"] }) {
  const section = (label: string, lines: Array<{ label: string; cell: (p: ProviderSummary) => Cell }>) => ({ label, lines });
  const syncOf = (p: ProviderSummary) => sync.find((s) => s.provider === p.provider)!;

  const sections = [
    section("Volume", [
      { label: "Shipments booked", cell: (p) => ({ value: p.booked }) },
      { label: "Prepaid / COD", cell: (p) => ({ value: `${p.prepaid} / ${p.cod}`, sub: p.booked > 0 ? `${pct(p.cod, p.booked)} COD` : undefined }) },
    ]),
    section("Cost", [
      {
        label: "Quoted",
        cell: (p) => ({ value: p.quotedN > 0 ? inr(p.quotedSum) : "—", sub: `avg ${avgInr(p.quotedSum, p.quotedN)} · ${p.quotedN} quoted` }),
      },
      {
        label: "Billed (from invoices)",
        cell: (p) => ({
          value: p.billedN > 0 ? inr(p.billedSum) : "—",
          sub: `avg ${avgInr(p.billedSum, p.billedN)} · ${p.billedN} of ${p.booked} billed`,
        }),
      },
      {
        label: "Billed − quoted",
        cell: (p) => ({
          value: p.pairedN > 0 ? signedInr(p.pairedGap / p.pairedN) : "—",
          sub: p.pairedN > 0 ? `avg per order · ${p.pairedN} with both` : "no order has both yet",
        }),
      },
      {
        label: "Avg cost per delivered",
        cell: (p) => {
          const known = p.deliveredBilledN + p.deliveredQuotedN;
          const basis =
            p.deliveredQuotedN === 0 ? "billed" : p.deliveredBilledN === 0 ? "quoted" : `${p.deliveredBilledN} billed + ${p.deliveredQuotedN} quoted`;
          return {
            value: known > 0 ? avgInr(p.deliveredCostSum, known) : "—",
            sub:
              known > 0
                ? `${basis} · ${known} of ${p.delivered} delivered`
                : p.delivered > 0
                  ? `no figure for ${p.delivered} delivered`
                  : "none delivered",
          };
        },
      },
    ]),
    section("Service", [
      { label: "Pickup failure rate", cell: (p) => ({ value: pct(p.pickupFailed, p.booked), sub: `${p.pickupFailed} of ${p.booked} booked` }) },
      {
        label: "Delivery exception rate",
        cell: (p) => ({ value: pct(p.deliveryExceptions, p.dispatched), sub: `${p.deliveryExceptions} of ${p.dispatched} dispatched` }),
      },
      { label: "RTO rate", cell: (p) => ({ value: pct(p.returned, p.dispatched), sub: `${p.returned} of ${p.dispatched} dispatched` }) },
      {
        label: "Avg delivery time",
        cell: (p) => ({
          value: p.transitDays !== null && p.transitN > 0 ? `${p.transitDays.toFixed(1)} days` : "—",
          sub: `shipped → delivered · ${p.transitN} orders`,
        }),
      },
      {
        label: "Tracking sync failing now",
        cell: (p) => {
          const s = syncOf(p);
          return {
            value: `${s.failing} of ${s.active}`,
            sub:
              s.failing > 0
                ? `active rows · up to ${s.maxFailures} failures in a row${s.lastFailedAt ? ` · last ${formatIST(s.lastFailedAt)}` : ""}`
                : `active rows${s.waitingForAwb > 0 ? ` · ${s.waitingForAwb} waiting for an AWB` : ""}`,
          };
        },
      },
    ]),
  ];

  return (
    <Panel>
      <PanelHeader
        title="By provider"
        description="Tracking sync is the current state of every active shipment; everything else is this period's orders."
      />
      <Table minWidth={520}>
        <THead>
          <TH className="w-[34%]">Metric</TH>
          {providers.map((p) => (
            <TH key={p.provider} align="right">
              {COURIER_PROVIDER_LABEL[p.provider]}
            </TH>
          ))}
        </THead>
        <TBody>
          {sections.flatMap((s) => [
            <tr key={s.label}>
              <td
                colSpan={providers.length + 1}
                className="border-b border-admin-line bg-admin-subtle/40 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted"
              >
                {s.label}
              </td>
            </tr>,
            ...s.lines.map((line) => (
              <TR key={`${s.label}:${line.label}`}>
                <TD className="text-admin-muted">{line.label}</TD>
                {providers.map((p) => {
                  const c = line.cell(p);
                  return (
                    <TD key={p.provider} align="right">
                      <div className="font-medium">{c.value}</div>
                      {c.sub && <div className="mt-0.5 text-xs text-admin-muted">{c.sub}</div>}
                    </TD>
                  );
                })}
              </TR>
            )),
          ])}
        </TBody>
      </Table>
    </Panel>
  );
}

// ── Zone / weight breakdowns ────────────────────────────────────────────────

function BreakdownPanel({
  title,
  description,
  keyLabel,
  rows,
  label,
}: {
  title: string;
  description: string;
  keyLabel: string;
  rows: BreakdownRow[];
  label: (key: BreakdownRow["key"]) => string;
}) {
  return (
    <Panel>
      <PanelHeader title={title} description={description} />
      {rows.length === 0 ? (
        <EmptyState icon={Database} title="No booked shipments in this period" compact />
      ) : (
        <Table minWidth={460}>
          <THead>
            <TH>Provider</TH>
            <TH>{keyLabel}</TH>
            <TH align="right">Shipments</TH>
            <TH align="right">Avg quoted</TH>
            <TH align="right">Avg billed</TH>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={`${r.provider}:${r.key ?? "none"}`}>
                <TD nowrap>{COURIER_PROVIDER_LABEL[r.provider]}</TD>
                <TD nowrap className={r.key === null ? "text-admin-muted" : undefined}>
                  {label(r.key)}
                </TD>
                <TD align="right">{r.n}</TD>
                <TD align="right" nowrap>
                  {avgInr(r.quotedSum, r.quotedN)}
                  {r.quotedN > 0 && r.quotedN < r.n && <span className="ml-1 text-xs text-admin-muted">({r.quotedN})</span>}
                </TD>
                <TD align="right" nowrap>
                  {avgInr(r.billedSum, r.billedN)}
                  {r.billedN > 0 && <span className="ml-1 text-xs text-admin-muted">({r.billedN})</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

// ── Routing decisions ───────────────────────────────────────────────────────

/** shadow = recommendation only; manual / auto acted on the decision. */
const isShadow = (mode: string) => mode === "shadow";

function RoutingPanels({ rows }: { rows: RoutingRow[] }) {
  type Agg = { key: string; label: string; shadow: number; live: number; extra: number };
  const group = (keyOf: (r: RoutingRow) => string, labelOf: (r: RoutingRow) => string, extraOf: (r: RoutingRow) => number) => {
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const key = keyOf(r);
      const a = m.get(key) ?? { key, label: labelOf(r), shadow: 0, live: 0, extra: 0 };
      if (isShadow(r.mode)) a.shadow += r.n;
      else a.live += r.n;
      a.extra += extraOf(r);
      m.set(key, a);
    }
    return [...m.values()].sort((a, b) => b.shadow + b.live - (a.shadow + a.live));
  };
  const byReason = group((r) => r.reasonCode, (r) => reasonLabel(r.reasonCode), (r) => r.comparableN);
  const byRecommended = group((r) => r.recommended ?? "none", (r) => providerLabel(r.recommended), (r) => r.followed);

  const table = (aggs: Agg[], first: string, extra: string) => (
    <Table minWidth={420}>
      <THead>
        <TH>{first}</TH>
        <TH align="right">Shadow</TH>
        <TH align="right">Live</TH>
        <TH align="right">{extra}</TH>
      </THead>
      <TBody>
        {aggs.map((a) => (
          <TR key={a.key}>
            <TD>{a.label}</TD>
            <TD align="right">{a.shadow}</TD>
            <TD align="right">{a.live}</TD>
            <TD align="right">{a.extra}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );

  const empty = <EmptyState icon={Database} title="No routing decisions in this period" description="Decisions are recorded once routing is in shadow, manual or auto mode." compact />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="Routing decisions by reason" description="Shadow decisions are recommendations only; live ones chose the booking." />
        {rows.length === 0 ? empty : table(byReason, "Reason", "Comparable quotes")}
      </Panel>
      <Panel>
        <PanelHeader title="Routing decisions by recommended provider" description="Booked as recommended = the order went to the recommended provider." />
        {rows.length === 0 ? empty : table(byRecommended, "Recommended", "Booked as recommended")}
      </Panel>
    </div>
  );
}
