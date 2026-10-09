import Link from "next/link";
import { CircleCheck, CirclePause, Database, Inbox, Lock, SearchX } from "lucide-react";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, max, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { deliveryExceptions, orders, shipmentTracking, trackingSyncRuns, webhooksInbound } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { formatRelative, requestTime } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { formatINR } from "@/lib/utils";
import { EXCEPTION_TYPES, type ExceptionType } from "@/lib/tracking/assess";
import { circuitState } from "@/lib/tracking/sync";
import { formatIstDate, formatIstDateTime } from "@/lib/tracking/time";
import { Badge, Tag } from "@/components/admin/Badge";
import { ButtonLink } from "@/components/admin/Button";
import { Chip, ChipRow } from "@/components/admin/Chip";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { Panel } from "@/components/admin/Panel";
import { SearchForm } from "@/components/admin/SearchForm";
import { RowLink, Table, TBody, TD, TH, THead, TR } from "@/components/admin/Table";
import { Tabs } from "@/components/admin/Tabs";
import { ExceptionActions } from "./ExceptionActions";
import { ResyncAllButton } from "./ResyncAllButton";
import { ago, estimatePassed, exceptionLabel, exceptionTone, formatSpan, lastCheckOf } from "./format";

/** Rows rendered per view — the queue should stay short; filters narrow it. */
const ROW_CAP = 200;

const TABS = [
  { key: "open", label: "Open", status: "OPEN" },
  { key: "acknowledged", label: "Acknowledged", status: "ACKNOWLEDGED" },
  { key: "resolved", label: "Resolved", status: "RESOLVED" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS: readonly TabKey[] = TABS.map((t) => t.key);

type SearchParams = Record<string, string | string[] | undefined>;
type ListState = { tab: TabKey; type: ExceptionType | ""; q: string };

export default async function ShipmentExceptionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.view")) {
    return (
      <>
        <PageHeader title="Shipment exceptions" />
        <Panel>
          <EmptyState icon={Lock} title="No access" description="Your role can't view support and shipment exceptions." />
        </Panel>
      </>
    );
  }

  const params = await searchParams;
  const state: ListState = {
    tab: pick(TAB_KEYS, first(params.tab)) || "open",
    type: pick(EXCEPTION_TYPES, first(params.type)),
    q: first(params.q).trim().slice(0, 64),
  };
  const now = new Date(requestTime());

  let data: Awaited<ReturnType<typeof loadExceptions>>;
  try {
    data = await loadExceptions(ctx.siteIds, state, now);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return (
      <>
        <PageHeader title="Shipment exceptions" />
        <Panel>
          <EmptyState
            icon={Database}
            title="Shipment tracking isn't set up yet"
            description={
              <>
                Apply <span className="font-mono text-xs">src/db/migrations/manual/2026-10-09_shipment_tracking.sql</span>{" "}
                to the database, then reload this page.
              </>
            }
          />
        </Panel>
      </>
    );
  }

  const { tabCounts, typeCounts, rows, capped, lastRun, lastWebhookAt, circuit } = data;
  const canResync = can(ctx.role, "tracking.resync");
  const canManage = can(ctx.role, "exceptions.manage");
  // "Just now" / "Yesterday" read mid-sentence in lower case; dates keep theirs.
  const rel = (d: Date) => formatRelative(d, now.getTime()).replace(/^(Just now|Yesterday)$/, (s) => s.toLowerCase());
  const synced = lastRun?.finishedAt ? `tracking last synced ${rel(lastRun.finishedAt)}` : "tracking never synced";
  const webhook = lastWebhookAt ? `last courier webhook ${rel(lastWebhookAt)}` : "no courier webhooks yet";
  const skipped = !circuit && lastRun?.skippedReason ? lastRun.skippedReason : null;

  const tabTotal = tabCounts[state.tab];
  const chipTypes = EXCEPTION_TYPES.filter((t) => (typeCounts[t] ?? 0) > 0 || t === state.type);
  const filtered = Boolean(state.q || state.type);

  return (
    <>
      <PageHeader
        title="Shipment exceptions"
        description={
          <>
            <span className="block truncate">
              {fmt(tabCounts.open)} open · {synced} · {webhook}
            </span>
            {skipped && (
              <span className="block truncate text-tone-warn" title={skipped}>
                Last sync didn&rsquo;t poll the courier: {skipped}
              </span>
            )}
          </>
        }
        actions={canResync ? <ResyncAllButton /> : undefined}
      />

      {circuit && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-tone-warn/25 bg-tone-warn-bg px-4 py-3 text-[13px] leading-5 text-tone-warn"
        >
          <CirclePause size={16} aria-hidden className="mt-0.5 shrink-0" />
          <p className="min-w-0 break-words">
            <span className="font-semibold">
              Courier tracking paused until {formatIstDateTime(new Date(circuit.openUntil))}
            </span>{" "}
            — {circuit.reason}. Scheduled and manual syncs resume on their own after that.
          </p>
        </div>
      )}

      <Tabs
        ariaLabel="Exception status"
        active={state.tab}
        items={TABS.map((t) => ({ key: t.key, label: t.label, count: tabCounts[t.key], href: listHref({ tab: t.key }) }))}
      />

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchForm
          action="/admin/support/exceptions"
          defaultValue={state.q}
          placeholder="Search order ID or AWB"
          keep={{ tab: state.tab === "open" ? undefined : state.tab, type: state.type || undefined }}
          clearHref={listHref({ ...state, q: "" })}
          className="max-lg:flex-none lg:max-w-sm"
        />
        {chipTypes.length > 0 && (
          <ChipRow ariaLabel="Exception type" className="min-w-0 lg:flex-1">
            <Chip href={listHref({ ...state, type: "" })} active={!state.type} count={tabTotal}>
              All
            </Chip>
            {chipTypes.map((t) => (
              <Chip key={t} href={listHref({ ...state, type: t })} active={state.type === t} count={typeCounts[t] ?? 0}>
                {exceptionLabel(t)}
              </Chip>
            ))}
          </ChipRow>
        )}
      </div>

      <Panel className="mt-4">
        {rows.length === 0 ? (
          <ListEmpty state={state} filtered={filtered} />
        ) : (
          <>
            <ExceptionsTable rows={rows} now={now} canResync={canResync} canManage={canManage} />
            <ExceptionCards rows={rows} now={now} canResync={canResync} canManage={canManage} />
            <div className="border-t border-admin-line px-4 py-3 text-xs tabular-nums text-admin-muted sm:px-5">
              {capped
                ? `Showing the first ${fmt(ROW_CAP)} — narrow the list with a type filter or search.`
                : `Showing ${fmt(rows.length)} ${rows.length === 1 ? "exception" : "exceptions"}`}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

// ── Data ────────────────────────────────────────────────────────────────────

async function loadExceptions(siteIds: string[], state: ListState, now: Date) {
  const tab = TABS.find((t) => t.key === state.tab) ?? TABS[0];
  const inScope = inArray(deliveryExceptions.siteId, siteIds);
  const inTab = and(inScope, eq(deliveryExceptions.status, tab.status))!;

  const where: SQL[] = [inTab];
  if (state.type) where.push(eq(deliveryExceptions.type, state.type));
  if (state.q) {
    const like = `%${state.q}%`;
    where.push(
      or(ilike(deliveryExceptions.orderId, like), ilike(shipmentTracking.awbCode, like), ilike(orders.awbCode, like))!,
    );
  }

  const severityRank = sql<number>`CASE ${deliveryExceptions.severity} WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`;
  const order = tab.status === "RESOLVED"
    ? [desc(deliveryExceptions.resolvedAt)]
    : [asc(severityRank), asc(deliveryExceptions.openedAt)];

  const [statusRows, typeRows, fetched, [lastRun], [webhookRow], circuit] = await Promise.all([
    db
      .select({ status: deliveryExceptions.status, n: count() })
      .from(deliveryExceptions)
      .where(inScope)
      .groupBy(deliveryExceptions.status),
    db
      .select({ type: deliveryExceptions.type, n: count() })
      .from(deliveryExceptions)
      .where(inTab)
      .groupBy(deliveryExceptions.type),
    db
      .select({
        id: deliveryExceptions.id,
        orderId: deliveryExceptions.orderId,
        type: deliveryExceptions.type,
        status: deliveryExceptions.status,
        severity: deliveryExceptions.severity,
        detail: deliveryExceptions.detail,
        openedAt: deliveryExceptions.openedAt,
        escalatedAt: deliveryExceptions.escalatedAt,
        resolvedAt: deliveryExceptions.resolvedAt,
        resolvedBy: deliveryExceptions.resolvedBy,
        resolution: deliveryExceptions.resolution,
        trackingId: shipmentTracking.id,
        courierName: shipmentTracking.courierName,
        awbCode: shipmentTracking.awbCode,
        lastEventAt: shipmentTracking.lastEventAt,
        lastSyncSuccessAt: shipmentTracking.lastSyncSuccessAt,
        lastWebhookAt: shipmentTracking.lastWebhookAt,
        eddAt: shipmentTracking.eddAt,
        terminalAt: shipmentTracking.terminalAt,
        orderCourier: orders.courierName,
        orderAwb: orders.awbCode,
        customerName: sql<string | null>`${orders.shippingAddress}->>'fullName'`,
        totalInr: orders.totalInr,
      })
      .from(deliveryExceptions)
      .innerJoin(orders, eq(orders.id, deliveryExceptions.orderId))
      // The exception's own shipment; an order-level exception (no tracking id)
      // borrows the order's FORWARD shipment for its courier facts.
      .leftJoin(
        shipmentTracking,
        or(
          eq(shipmentTracking.id, deliveryExceptions.trackingId),
          and(
            isNull(deliveryExceptions.trackingId),
            eq(shipmentTracking.orderId, deliveryExceptions.orderId),
            eq(shipmentTracking.kind, "FORWARD"),
          ),
        ),
      )
      .where(and(...where))
      .orderBy(...order)
      .limit(ROW_CAP + 1),
    db
      .select({ finishedAt: trackingSyncRuns.finishedAt, skippedReason: trackingSyncRuns.skippedReason })
      .from(trackingSyncRuns)
      .where(isNotNull(trackingSyncRuns.finishedAt))
      .orderBy(desc(trackingSyncRuns.finishedAt))
      .limit(1),
    db
      .select({ at: max(webhooksInbound.createdAt) })
      .from(webhooksInbound)
      .where(eq(webhooksInbound.source, "shiprocket")),
    circuitState(now).catch(() => null),
  ]);

  const tabCounts: Record<TabKey, number> = { open: 0, acknowledged: 0, resolved: 0 };
  for (const r of statusRows) {
    const t = TABS.find((x) => x.status === r.status);
    if (t) tabCounts[t.key] = r.n;
  }
  const typeCounts: Partial<Record<string, number>> = {};
  for (const r of typeRows) typeCounts[r.type] = r.n;

  return {
    tabCounts,
    typeCounts,
    rows: fetched.slice(0, ROW_CAP),
    capped: fetched.length > ROW_CAP,
    lastRun: lastRun ?? null,
    lastWebhookAt: webhookRow?.at ?? null,
    circuit,
  };
}

type Row = Awaited<ReturnType<typeof loadExceptions>>["rows"][number];
type RowProps = { rows: Row[]; now: Date; canResync: boolean; canManage: boolean };

// ── Table (md+) ─────────────────────────────────────────────────────────────

function ExceptionsTable({ rows, now, canResync, canManage }: RowProps) {
  return (
    <Table className="max-md:hidden">
      <THead>
        <TH className="pl-4 pr-3">Order</TH>
        <TH className="px-3">Courier / AWB</TH>
        <TH className="px-3">Exception</TH>
        <TH className="hidden px-3 xl:table-cell">Detail</TH>
        <TH className="px-3">Last courier update</TH>
        <TH className="hidden px-3 lg:table-cell">Last check</TH>
        <TH className="hidden px-3 lg:table-cell">Estimate</TH>
        <TH align="right" className="px-3">Open for</TH>
        <TH className="pl-1 pr-3"><span className="sr-only">Actions</span></TH>
      </THead>
      <TBody>
        {rows.map((r) => {
          const courier = r.courierName ?? r.orderCourier;
          const awb = r.awbCode ?? r.orderAwb;
          const check = lastCheckOf(r.lastSyncSuccessAt, r.lastWebhookAt);
          return (
            <TR key={r.id}>
              <TD nowrap className="pl-4 pr-3">
                <RowLink href={`/admin/orders/${r.orderId}`} className="font-mono">{r.orderId}</RowLink>
                <div className="mt-0.5 max-w-44 truncate text-xs text-admin-muted">
                  {[r.customerName?.trim(), formatINR(r.totalInr)].filter(Boolean).join(" · ")}
                </div>
              </TD>
              <TD className="px-3">
                <div className="max-w-36 truncate" title={courier ?? undefined}>{courier || <span className="text-admin-muted">—</span>}</div>
                <div className="max-w-36 truncate font-mono text-xs text-admin-muted">{awb || "No AWB"}</div>
              </TD>
              <TD className="px-3">
                <ExceptionBadge row={r} />
                {r.detail && <div className="mt-1 max-w-56 truncate text-xs text-admin-muted xl:hidden" title={r.detail}>{r.detail}</div>}
              </TD>
              <TD className="hidden w-[22%] max-w-0 px-3 xl:table-cell">
                <div className="truncate text-brand-ink-soft" title={r.detail ?? undefined}>{r.detail ?? "—"}</div>
                {r.status === "RESOLVED" && r.resolution && (
                  <div className="truncate text-xs text-admin-muted" title={r.resolution}>
                    {r.resolvedBy ? `${r.resolvedBy}: ` : ""}{r.resolution}
                  </div>
                )}
              </TD>
              <TD nowrap className="px-3 tabular-nums"><When at={r.lastEventAt} now={now} empty="No scan yet" /></TD>
              <TD nowrap className="hidden px-3 tabular-nums lg:table-cell"><When at={check} now={now} empty="Never" /></TD>
              <TD nowrap className="hidden px-3 tabular-nums lg:table-cell"><Estimate edd={r.eddAt} terminal={!!r.terminalAt} now={now} /></TD>
              <TD align="right" nowrap className="px-3 text-brand-ink-soft">{openFor(r, now)}</TD>
              <TD interactive nowrap className="pl-1 pr-3">
                <ExceptionActions
                  id={r.id}
                  orderId={r.orderId}
                  trackingId={r.trackingId}
                  status={r.status}
                  awb={awb}
                  canResync={canResync}
                  canManage={canManage}
                />
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

// ── Row cards (phones) ──────────────────────────────────────────────────────

function ExceptionCards({ rows, now, canResync, canManage }: RowProps) {
  return (
    <ul className="divide-y divide-admin-line md:hidden">
      {rows.map((r) => {
        const courier = r.courierName ?? r.orderCourier;
        const awb = r.awbCode ?? r.orderAwb;
        const check = lastCheckOf(r.lastSyncSuccessAt, r.lastWebhookAt);
        return (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Link href={`/admin/orders/${r.orderId}`} className="truncate font-mono text-[13px] font-semibold text-brand-ink active:underline">
                {r.orderId}
              </Link>
              <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-admin-muted">{openFor(r, now)}</span>
            </div>
            <div className="mt-1.5"><ExceptionBadge row={r} /></div>
            {r.detail && <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-brand-ink-soft">{r.detail}</p>}
            {r.status === "RESOLVED" && r.resolution && (
              <p className="mt-1 line-clamp-2 text-xs leading-4 text-admin-muted">
                Resolved{r.resolvedBy ? ` by ${r.resolvedBy}` : ""}: {r.resolution}
              </p>
            )}
            <p className="mt-1.5 truncate text-xs text-admin-muted">
              {courier || "No courier"} · {awb ? <span className="font-mono">{awb}</span> : "No AWB"}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-admin-muted">
              Scan {r.lastEventAt ? ago(r.lastEventAt, now) : "—"} · Checked {check ? ago(check, now) : "never"}
              {r.eddAt && (
                <>
                  {" · Est. "}
                  <Estimate edd={r.eddAt} terminal={!!r.terminalAt} now={now} inline />
                </>
              )}
            </p>
            <div className="mt-2.5 flex justify-end">
              <ExceptionActions
                id={r.id}
                orderId={r.orderId}
                trackingId={r.trackingId}
                status={r.status}
                awb={awb}
                canResync={canResync}
                canManage={canManage}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Cells ───────────────────────────────────────────────────────────────────

function ExceptionBadge({ row }: { row: Row }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={exceptionTone(row.status, row.severity)}>{exceptionLabel(row.type)}</Badge>
      {row.escalatedAt && <Tag>Escalated</Tag>}
    </span>
  );
}

function When({ at, now, empty }: { at: Date | null; now: Date; empty: string }) {
  if (!at) return <span className="text-admin-muted">{empty}</span>;
  return (
    <>
      <div>{formatIstDateTime(at)}</div>
      <div className="text-xs text-admin-muted">{ago(at, now)}</div>
    </>
  );
}

function Estimate({ edd, terminal, now, inline }: { edd: Date | null; terminal: boolean; now: Date; inline?: boolean }) {
  if (!edd) return <span className="text-admin-muted">—</span>;
  const expired = !terminal && estimatePassed(edd, now);
  if (inline) return <span className={expired ? "text-tone-warn" : undefined}>{formatIstDate(edd)}{expired && " (expired)"}</span>;
  return (
    <>
      <div className={expired ? "text-tone-warn" : undefined}>{formatIstDate(edd)}</div>
      {expired && <div className="text-xs font-medium text-tone-warn">expired</div>}
    </>
  );
}

function openFor(r: Row, now: Date): string {
  const end = r.status === "RESOLVED" && r.resolvedAt ? r.resolvedAt : now;
  return formatSpan(end.getTime() - r.openedAt.getTime());
}

// ── Empty states ────────────────────────────────────────────────────────────

function ListEmpty({ state, filtered }: { state: ListState; filtered: boolean }) {
  if (filtered) {
    const clear = <ButtonLink href={listHref({ tab: state.tab })} size="sm">Clear search and filter</ButtonLink>;
    const title = state.q ? `No exceptions match “${state.q}”` : "No exceptions of this type";
    return <EmptyState icon={SearchX} title={title} description="Try a different search or show all types." action={clear} />;
  }
  if (state.tab === "open") {
    return <EmptyState icon={CircleCheck} title="No open exceptions" description="Every tracked shipment is moving as expected." />;
  }
  if (state.tab === "acknowledged") {
    return <EmptyState icon={Inbox} title="Nothing acknowledged" description="Exceptions someone is working on appear here." />;
  }
  return <EmptyState icon={Inbox} title="No resolved exceptions yet" description="Resolved and auto-cleared exceptions appear here." />;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** List URL; the default tab is omitted. */
function listHref(s: Partial<ListState>): string {
  const sp = new URLSearchParams();
  if (s.tab && s.tab !== "open") sp.set("tab", s.tab);
  if (s.type) sp.set("type", s.type);
  if (s.q) sp.set("q", s.q);
  const qs = sp.toString();
  return qs ? `/admin/support/exceptions?${qs}` : "/admin/support/exceptions";
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  const code = e?.code ?? e?.cause?.code;
  return code === "42P01" || code === "42703";
}

/** `raw` if it's one of `allowed`, else "" (unknown URL values are ignored). */
function pick<T extends string>(allowed: readonly T[], raw: string): T | "" {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : "";
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
