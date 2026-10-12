import type { ReactNode } from "react";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { deliveryExceptions, orders, shipmentTracking, shipmentTrackingEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { requestTime } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { logError } from "@/lib/logger";
import type { Assessment } from "@/lib/tracking/assess";
import { DEFAULT_TRACKING_CONFIG } from "@/lib/tracking/config";
import { assessRow, loadOrderForEstimate } from "@/lib/tracking/exceptions";
import { loadTrackingConfig } from "@/lib/tracking/sync";
import { formatIstDate, formatIstDateTime } from "@/lib/tracking/time";
import { Badge, Tag } from "@/components/admin/Badge";
import { KeyValue, Panel, PanelBody, PanelHeader } from "@/components/admin/Panel";
import { ExceptionActions } from "../../support/exceptions/ExceptionActions";
import {
  ago,
  exceptionLabel,
  exceptionTone,
  lastCheckOf,
  redactSyncError,
  trackingStatusMeta,
} from "../../support/exceptions/format";
import { ResyncButton } from "./ResyncButton";

const TIMELINE_MAX = 30;
const TIMELINE_VISIBLE = 5;

/**
 * Courier tracking for one order: the FORWARD shipment's four facts (status,
 * last courier event + its own time, last successful check, estimate) kept
 * separate, sync health, open exceptions and the courier timeline. RETURN /
 * REPLACEMENT shipments are listed compactly. Never takes the order page down:
 * any load failure renders a one-line notice instead.
 */
export async function TrackingPanel({ orderId }: { orderId: string }) {
  const ctx = await requireAdmin();
  const now = new Date(requestTime());
  const canResync = can(ctx.role, "tracking.resync");
  const canManage = can(ctx.role, "exceptions.manage");

  let data: Awaited<ReturnType<typeof loadTracking>>;
  try {
    data = await loadTracking(orderId, now);
  } catch (err) {
    const missing = isMissingTable(err);
    if (!missing) logError("admin:tracking-panel", err, { orderId });
    return (
      <Panel>
        <PanelHeader title="Courier tracking" />
        <PanelBody>
          <p className="text-[13px] text-admin-muted">
            {missing
              ? "Shipment tracking isn't set up yet — apply the 2026-10-09_shipment_tracking.sql migration."
              : "Couldn't load courier tracking right now. Reload to try again."}
          </p>
        </PanelBody>
      </Panel>
    );
  }

  const { forward, others, events, exceptions, assessment, hasShipment } = data;
  const resync = canResync && (forward || hasShipment) ? <ResyncButton orderId={orderId} /> : undefined;
  const courier = forward?.courierName ?? data.orderCourier;

  return (
    <Panel>
      <PanelHeader
        title="Courier tracking"
        description={forward ? `Forward shipment${courier ? ` · ${courier}` : ""}` : undefined}
        actions={resync}
      />

      {!forward && (
        <PanelBody>
          <p className="text-[13px] text-admin-muted">
            {hasShipment
              ? "Not tracked yet. Resync now to start tracking this shipment."
              : "No courier shipment yet."}
          </p>
        </PanelBody>
      )}

      {forward && assessment && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 sm:px-5">
            <StatusBadge status={forward.status} />
            {forward.statusLabel && (
              <span className="min-w-0 truncate text-xs text-admin-muted" title={forward.statusLabel}>
                Courier: “{forward.statusLabel}”
              </span>
            )}
            {assessment.estimate.arrivingToday && <Tag>Arriving today</Tag>}
            {!forward.active && <Tag>Tracking closed</Tag>}
          </div>
          <div className="mt-2">
            <KeyValue
              items={[
                {
                  label: "Courier / AWB",
                  value: (
                    <>
                      {courier ?? "—"} · <span className="font-mono text-xs">{forward.awbCode ?? "No AWB"}</span>
                    </>
                  ),
                },
                { label: "Last courier update", value: <LastUpdate row={forward} now={now} /> },
                { label: "Last check", value: <Moment at={lastCheckOf(forward.lastSyncSuccessAt, forward.lastWebhookAt)} now={now} empty="Never" /> },
                { label: "Estimate", value: <EstimateValue estimate={assessment.estimate} /> },
                {
                  label: "Sync health",
                  value: (
                    <SyncHealth
                      failures={forward.consecutiveFailures}
                      error={redactSyncError(forward.lastSyncError)}
                      healthy={assessment.sync.healthy}
                      failingSince={assessment.sync.failingSince}
                      now={now}
                    />
                  ),
                },
              ]}
            />
          </div>
        </>
      )}

      {exceptions.length > 0 && (
        <section className="border-t border-admin-line">
          <h3 className="px-4 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted sm:px-5">
            Open exceptions
          </h3>
          <ul className="divide-y divide-admin-line">
            {exceptions.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={exceptionTone(e.status, e.severity)}>{exceptionLabel(e.type)}</Badge>
                    {e.status === "ACKNOWLEDGED" && <Tag>Acknowledged</Tag>}
                    {e.escalatedAt && <Tag>Escalated</Tag>}
                  </div>
                  {e.detail && <p className="mt-1 text-xs leading-4 text-brand-ink-soft">{e.detail}</p>}
                  <p className="mt-0.5 text-xs tabular-nums text-admin-muted">
                    Opened {formatIstDateTime(e.openedAt)} · {ago(e.openedAt, now)}
                  </p>
                </div>
                <ExceptionActions
                  layout="inline"
                  id={e.id}
                  orderId={orderId}
                  trackingId={e.trackingId}
                  status={e.status}
                  awb={null}
                  canResync={false}
                  canManage={canManage}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {events.length > 0 && (
        <section className="border-t border-admin-line px-4 py-3.5 sm:px-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">
            Courier timeline
            <span className="ml-1.5 font-normal normal-case tracking-normal">
              · {events.length === TIMELINE_MAX ? `latest ${TIMELINE_MAX}` : events.length} scans
            </span>
          </h3>
          <ol className="mt-3 space-y-3">
            {events.slice(0, TIMELINE_VISIBLE).map((ev, i) => (
              <TimelineItem key={ev.id} event={ev} latest={i === 0} />
            ))}
          </ol>
          {events.length > TIMELINE_VISIBLE && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none text-xs font-semibold text-brand-ink-soft hover:text-brand-ink">
                <span className="group-open:hidden">Show {events.length - TIMELINE_VISIBLE} earlier scans</span>
                <span className="hidden group-open:inline">Hide earlier scans</span>
              </summary>
              <ol className="mt-3 space-y-3">
                {events.slice(TIMELINE_VISIBLE).map((ev) => (
                  <TimelineItem key={ev.id} event={ev} />
                ))}
              </ol>
            </details>
          )}
        </section>
      )}

      {others.length > 0 && (
        <section className="border-t border-admin-line px-4 py-3.5 sm:px-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">Other shipments</h3>
          <ul className="mt-1 divide-y divide-admin-line">
            {others.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-[13px]">
                <Tag>{r.kind === "RETURN" ? "Return" : r.kind === "REPLACEMENT" ? "Replacement" : r.kind}</Tag>
                <StatusBadge status={r.status} receivedByUs={r.kind === "RETURN"} />
                <span className="min-w-0 truncate text-brand-ink-soft">
                  {r.courierName ?? "—"} · <span className="font-mono text-xs">{r.awbCode ?? "No AWB"}</span>
                </span>
                <span className="ml-auto text-xs tabular-nums text-admin-muted">
                  {r.lastEventAt ? `Scan ${formatIstDateTime(r.lastEventAt)}` : "No scan yet"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Panel>
  );
}

// ── Data ────────────────────────────────────────────────────────────────────

async function loadTracking(orderId: string, now: Date) {
  const [[order], rows] = await Promise.all([
    db
      .select({ awbCode: orders.awbCode, shipmentId: orders.shiprocketShipmentId, courierName: orders.courierName })
      .from(orders)
      .where(eq(orders.id, orderId)),
    db.select().from(shipmentTracking).where(eq(shipmentTracking.orderId, orderId)).orderBy(asc(shipmentTracking.createdAt)),
  ]);
  const forward = rows.find((r) => r.kind === "FORWARD") ?? null;

  const [events, exceptions, cfg, estimateOrder] = await Promise.all([
    forward
      ? db
          .select({
            id: shipmentTrackingEvents.id,
            eventAt: shipmentTrackingEvents.eventAt,
            status: shipmentTrackingEvents.status,
            carrierStatusLabel: shipmentTrackingEvents.carrierStatusLabel,
            activity: shipmentTrackingEvents.activity,
            location: shipmentTrackingEvents.location,
          })
          .from(shipmentTrackingEvents)
          .where(eq(shipmentTrackingEvents.trackingId, forward.id))
          .orderBy(desc(shipmentTrackingEvents.eventAt), desc(shipmentTrackingEvents.receivedAt))
          .limit(TIMELINE_MAX)
      : Promise.resolve([]),
    db
      .select({
        id: deliveryExceptions.id,
        type: deliveryExceptions.type,
        status: deliveryExceptions.status,
        severity: deliveryExceptions.severity,
        detail: deliveryExceptions.detail,
        openedAt: deliveryExceptions.openedAt,
        escalatedAt: deliveryExceptions.escalatedAt,
        trackingId: deliveryExceptions.trackingId,
      })
      .from(deliveryExceptions)
      .where(and(eq(deliveryExceptions.orderId, orderId), ne(deliveryExceptions.status, "RESOLVED")))
      .orderBy(asc(deliveryExceptions.openedAt)),
    loadTrackingConfig().catch(() => DEFAULT_TRACKING_CONFIG),
    forward ? loadOrderForEstimate(orderId) : Promise.resolve(null),
  ]);

  const shipmentId = order?.shipmentId && order.shipmentId !== "undefined" ? order.shipmentId : null;
  return {
    forward,
    others: rows.filter((r) => r.kind !== "FORWARD"),
    events,
    exceptions,
    assessment: forward ? assessRow(forward, estimateOrder, now, cfg) : null,
    hasShipment: !!(order?.awbCode || shipmentId),
    orderCourier: order?.courierName?.trim() || null,
  };
}

type TrackingData = Awaited<ReturnType<typeof loadTracking>>;
type ForwardRow = NonNullable<TrackingData["forward"]>;
type TimelineEvent = TrackingData["events"][number];

// ── Pieces ──────────────────────────────────────────────────────────────────

function StatusBadge({ status, receivedByUs }: { status: string; receivedByUs?: boolean }) {
  const m = trackingStatusMeta(status);
  return <Badge tone={m.tone}>{receivedByUs && status === "DELIVERED" ? "Received by PRC" : m.label}</Badge>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-normal tabular-nums text-admin-muted">{children}</span>;
}

function Moment({ at, now, empty }: { at: Date | null; now: Date; empty: string }) {
  if (!at) return <span className="font-normal text-admin-muted">{empty}</span>;
  return (
    <>
      <span className="tabular-nums">{formatIstDateTime(at)}</span>
      <Muted>{ago(at, now)}</Muted>
    </>
  );
}

function LastUpdate({ row, now }: { row: ForwardRow; now: Date }) {
  if (!row.lastEventAt) return <span className="font-normal text-admin-muted">No courier scan yet</span>;
  const what = [row.lastEventActivity, row.lastEventLocation].filter(Boolean).join(" · ");
  return (
    <>
      <span className="block break-words">{what || "Courier scan"}</span>
      <Muted>
        {formatIstDateTime(row.lastEventAt)} · {ago(row.lastEventAt, now)}
      </Muted>
    </>
  );
}

function EstimateValue({ estimate: e }: { estimate: Assessment["estimate"] }) {
  const source = e.source === "COURIER" ? "courier" : "PRC estimate";
  switch (e.state) {
    case "COURIER":
    case "STORE_ESTIMATE":
      return (
        <>
          <span className="tabular-nums">{e.date ? formatIstDate(e.date) : "—"}</span>
          <Muted>{source}</Muted>
        </>
      );
    case "EXPIRED":
      return (
        <>
          <span className="tabular-nums text-tone-warn">{e.expiredDate ? formatIstDate(e.expiredDate) : "—"}</span>
          <span className="block text-xs font-medium text-tone-warn">expired · {source}</span>
        </>
      );
    case "DELIVERED":
      return <span className="text-tone-pos">{e.date ? `Delivered ${formatIstDate(e.date)}` : "Delivered"}</span>;
    case "UNAVAILABLE":
      return <span className="font-normal text-admin-muted">No estimate from the courier yet</span>;
    default:
      return <span className="font-normal text-admin-muted">—</span>;
  }
}

function SyncHealth({
  failures,
  error,
  healthy,
  failingSince,
  now,
}: {
  failures: number;
  error: string | null;
  healthy: boolean;
  failingSince: Date | null;
  now: Date;
}) {
  return (
    <>
      {failures > 0 ? (
        <span className="text-tone-neg">
          {failures} failed {failures === 1 ? "check" : "checks"} in a row
        </span>
      ) : healthy ? (
        <span className="text-tone-pos">Healthy</span>
      ) : (
        <span className="text-tone-warn">Stale</span>
      )}
      {!healthy && failingSince && <Muted>No successful check for {ago(failingSince, now).replace(/ ago$/, "")}</Muted>}
      {failures > 0 && error && (
        <span className="ml-auto block max-w-72 break-words text-xs font-normal text-admin-muted">{error}</span>
      )}
    </>
  );
}

function TimelineItem({ event: ev, latest }: { event: TimelineEvent; latest?: boolean }) {
  const label = ev.carrierStatusLabel?.trim() || trackingStatusMeta(ev.status).label;
  return (
    <li className={`border-l-2 pl-3 ${latest ? "border-brand-ink" : "border-admin-line"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[13px] font-medium text-brand-ink">{label}</span>
        <span className="text-xs tabular-nums text-admin-muted">{formatIstDateTime(ev.eventAt)}</span>
      </div>
      {ev.activity && ev.activity.trim() !== label && <p className="text-xs leading-4 text-brand-ink-soft">{ev.activity}</p>}
      {ev.location && <p className="text-xs leading-4 text-admin-muted">{ev.location}</p>}
    </li>
  );
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  const code = e?.code ?? e?.cause?.code;
  return code === "42P01" || code === "42703";
}
