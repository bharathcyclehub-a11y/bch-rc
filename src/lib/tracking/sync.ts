/**
 * Tracking reconciliation worker.
 *
 * Webhooks can be late, lost or never configured, so this worker polls the
 * courier for every active shipment on its own schedule. It is driven by the
 * system cron (deploy/vps: every 15 min → /api/cron/sync-shipments), but WHICH
 * shipments are polled is decided here from shipment_tracking.next_sync_at, so
 * intervals are configuration, not crontab edits.
 *
 * Durability and concurrency follow the shipment_jobs pattern:
 *   - due rows are claimed with FOR UPDATE SKIP LOCKED and a 5-minute lease,
 *     so overlapping runs (cron + admin "resync all") never poll the same AWB;
 *   - a failed poll backs off exponentially with jitter, per shipment;
 *   - 401/403/429 from Shiprocket opens a store-wide circuit breaker for
 *     `circuitBreakMin`: no further courier calls until it closes. (The Sep-2026
 *     IP block came from retrying a refusing provider every few minutes.)
 *
 * A failed or skipped poll NEVER marks a shipment as freshly checked:
 * last_sync_success_at only moves on a parsed courier answer. Exception checks
 * (expired estimate, no movement, sync failing) run on every pass whether or
 * not the courier API is reachable, because they depend on time, not new data.
 */

import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  orders,
  shipmentTracking,
  trackingSyncRuns,
  webhooksInbound,
  type ShipmentTrackingRow,
} from "@/db/schema";
import { fetchShiprocketTracking, ShiprocketApiError } from "@/lib/shiprocket";
import { getSetting, setSetting } from "@/lib/settings";
import { alertOps } from "@/lib/alert";
import { logError, logWarn } from "@/lib/logger";
import { parseShiprocketTracking } from "./carrier";
import { DEFAULT_TRACKING_CONFIG, resolveTrackingConfig, type TrackingConfig } from "./config";
import { failureBackoffMinutes, nextSyncDelayMinutes, withJitter } from "./assess";
import { applyIngestEffects, ingestSnapshot, loadTrackingRow } from "./ingest";
import {
  assessRow,
  factsFromRow,
  loadOrderForEstimate,
  raiseException,
  reconcileExceptions,
} from "./exceptions";
import { processStoredWebhook } from "./webhook";

const LEASE_MINUTES = 5;
const CIRCUIT_KEY = "tracking.circuit";

/** A Date for a RAW sql template. Drizzle hands raw-template params to
 *  postgres-js untouched, and postgres-js rejects a bare Date there. */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

export async function loadTrackingConfig(): Promise<TrackingConfig> {
  return resolveTrackingConfig(await getSetting("tracking.config"));
}

type Circuit = { openUntil: string; reason: string; openedAt: string };

export async function circuitState(now: Date): Promise<Circuit | null> {
  const c = await getSetting<Circuit>(CIRCUIT_KEY);
  return c && new Date(c.openUntil) > now ? c : null;
}

async function openCircuit(now: Date, minutes: number, reason: string): Promise<void> {
  const until = new Date(now.getTime() + minutes * 60_000);
  await setSetting(CIRCUIT_KEY, { openUntil: until.toISOString(), reason, openedAt: now.toISOString() }, "system");
  await alertOps({
    scope: "tracking",
    message: `Courier tracking paused for ${minutes} min: ${reason}`,
    context: { until: until.toISOString() },
  });
}

/** Courier refused us outright (auth / IP block / rate limit). */
function isRefusal(err: unknown): err is ShiprocketApiError {
  return err instanceof ShiprocketApiError && (err.isAuth || err.status === 401 || err.status === 403 || err.status === 429);
}

function redact(msg: string): string {
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***").slice(0, 300);
}

/**
 * Create tracking rows for in-flight orders that don't have one yet, and keep
 * a FORWARD row's AWB in step with orders.awb_code (an operator can change it
 * by hand). Idempotent — ON CONFLICT covers both unique indexes.
 */
export async function bootstrapTrackingRows(now: Date): Promise<number> {
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO shipment_tracking
      (site_id, order_id, kind, shiprocket_shipment_id, awb_code, courier_name, status, next_sync_at, created_at, updated_at)
    SELECT o.site_id, o.id, 'FORWARD',
           NULLIF(NULLIF(o.shiprocket_shipment_id, ''), 'undefined'),
           NULLIF(o.awb_code, ''),
           NULLIF(o.courier_name, ''),
           CASE WHEN COALESCE(o.awb_code, '') <> '' THEN 'UNKNOWN' ELSE 'AWAITING_AWB' END,
           ${ts(now)}, ${ts(now)}, ${ts(now)}
    FROM orders o
    WHERE o.status IN ('PAID', 'PACKED', 'SHIPPED')
      AND (COALESCE(o.awb_code, '') <> ''
           OR COALESCE(NULLIF(o.shiprocket_shipment_id, 'undefined'), '') <> '')
      AND NOT EXISTS (SELECT 1 FROM shipment_tracking t WHERE t.order_id = o.id AND t.kind = 'FORWARD')
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  try {
    const moved = (await db.execute(sql`
      SELECT t.id, o.awb_code AS awb
        FROM shipment_tracking t JOIN orders o ON o.id = t.order_id
       WHERE t.kind = 'FORWARD'
         AND COALESCE(o.awb_code, '') <> ''
         AND t.awb_code IS DISTINCT FROM o.awb_code
         AND NOT EXISTS (SELECT 1 FROM shipment_tracking x WHERE x.awb_code = o.awb_code)
    `)) as unknown as Array<{ id: string; awb: string }>;
    for (const m of moved) await repointTracking(m.id, m.awb, "order AWB changed", now);
  } catch (err) {
    logError("tracking:bootstrap-awb", err);
  }
  return (inserted as unknown as unknown[]).length;
}

/**
 * Point a tracking row at a NEW AWB (the order was re-shipped: a Shiprocket
 * "-C" clone, or an operator changed the AWB). Courier facts from the old AWB
 * are cleared from the row — its events stay in history but no longer drive
 * the status — and the row is polled straight away.
 */
export async function repointTracking(trackingId: string, newAwb: string, reason: string, now: Date = new Date()): Promise<void> {
  const [row] = await db
    .update(shipmentTracking)
    .set({
      awbCode: newAwb,
      courierName: null,
      status: "UNKNOWN",
      statusLabel: null,
      statusChangedAt: null,
      summaryStatus: null,
      summaryAt: null,
      lastEventAt: null,
      lastEventActivity: null,
      lastEventLocation: null,
      eddAt: null,
      eddSource: null,
      eddUpdatedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      terminalAt: null,
      deliveryAttempts: 0,
      active: true,
      nextSyncAt: now,
      updatedAt: now,
    })
    .where(eq(shipmentTracking.id, trackingId))
    .returning({ orderId: shipmentTracking.orderId, siteId: shipmentTracking.siteId });
  if (!row) return;
  await db.insert(events).values({
    siteId: row.siteId,
    orderId: row.orderId,
    type: "TRACKING_AWB_CHANGED",
    payload: { trackingId, to: newAwb, reason },
    source: "system",
  });
}

export type SyncOneResult =
  | { ok: true; changed: boolean; newEvents: number; status: string }
  | { ok: false; error: string; refused: boolean };

/** Poll + ingest + evaluate one already-claimed row, then release its lease. */
async function syncClaimed(
  row: ShipmentTrackingRow,
  cfg: TrackingConfig,
  now: Date,
  notify: boolean,
): Promise<SyncOneResult> {
  if (!row.awbCode && !row.shiprocketShipmentId) {
    await db
      .update(shipmentTracking)
      .set({
        syncLockedUntil: null,
        nextSyncAt: new Date(now.getTime() + cfg.awaitingIntervalMin * 60_000),
        lastSyncError: "No AWB or Shiprocket shipment id to track",
        updatedAt: now,
      })
      .where(eq(shipmentTracking.id, row.id));
    return { ok: false, error: "no AWB or shipment id", refused: false };
  }

  try {
    const body = await fetchShiprocketTracking({ awb: row.awbCode, shipmentId: row.shiprocketShipmentId });
    const snap = parseShiprocketTracking(body);
    if (!snap) throw new Error(`Unrecognised tracking response: ${JSON.stringify(body).slice(0, 160)}`);

    const outcome = await ingestSnapshot(row.id, snap, "POLL", now);
    await applyIngestEffects(outcome, { notify, now });

    const fresh = (await loadTrackingRow(row.id))!;
    const order = await loadOrderForEstimate(fresh.orderId);
    const a = assessRow(fresh, order, now, cfg);
    if (outcome.correction) {
      await raiseException({
        siteId: fresh.siteId,
        orderId: fresh.orderId,
        trackingId: fresh.id,
        type: "CARRIER_CORRECTION",
        severity: "HIGH",
        detail: `Courier changed a final status from ${outcome.previousStatus} to ${outcome.status}.`,
        now,
      });
    }
    await reconcileExceptions(fresh, a, { now, notify });

    const delay = nextSyncDelayMinutes(factsFromRow(fresh), a, cfg, now);
    await db
      .update(shipmentTracking)
      .set({
        syncLockedUntil: null,
        active: delay !== null,
        nextSyncAt: new Date(now.getTime() + withJitter(delay ?? cfg.movingIntervalMin) * 60_000),
        updatedAt: now,
      })
      .where(eq(shipmentTracking.id, row.id));
    return {
      ok: true,
      changed: outcome.statusChanged || outcome.newEvents > 0 || !!outcome.edd,
      newEvents: outcome.newEvents,
      status: outcome.status,
    };
  } catch (err) {
    const refused = isRefusal(err);
    const failures = row.consecutiveFailures + 1;
    const message = redact(err instanceof Error ? err.message : String(err));
    await db
      .update(shipmentTracking)
      .set({
        syncLockedUntil: null,
        consecutiveFailures: failures,
        lastSyncError: message,
        nextSyncAt: new Date(now.getTime() + failureBackoffMinutes(failures, cfg) * 60_000),
        updatedAt: now,
      })
      .where(eq(shipmentTracking.id, row.id));
    if (!refused) logWarn("tracking:sync", message, { orderId: row.orderId, failures });
    return { ok: false, error: message, refused };
  }
}

/** Re-assess every active shipment and reconcile its exceptions. */
async function evaluateAll(cfg: TrackingConfig, now: Date, notify: boolean): Promise<number> {
  const rows = await db.select().from(shipmentTracking).where(eq(shipmentTracking.active, true));
  if (rows.length === 0) return 0;
  const orderRows = await db
    .select({
      id: orders.id,
      siteId: orders.siteId,
      customerId: orders.customerId,
      status: orders.status,
      placedAt: orders.placedAt,
      paidAt: orders.paidAt,
      shippingAddress: orders.shippingAddress,
    })
    .from(orders)
    .where(inArray(orders.id, [...new Set(rows.map((r) => r.orderId))]));
  const byId = new Map(orderRows.map((o) => [o.id, o]));
  let n = 0;
  for (const row of rows) {
    try {
      const a = assessRow(row, byId.get(row.orderId) ?? null, now, cfg);
      const r = await reconcileExceptions(row, a, { now, notify });
      n += r.opened.length;
      // An expired estimate or stalled parcel: ask the courier sooner.
      if (r.opened.length > 0 && row.nextSyncAt > now) {
        await db
          .update(shipmentTracking)
          .set({ nextSyncAt: now })
          .where(and(eq(shipmentTracking.id, row.id), sql`${shipmentTracking.syncLockedUntil} IS NULL`));
      }
    } catch (err) {
      logError("tracking:evaluate", err, { orderId: row.orderId });
    }
  }
  return n;
}

/**
 * One store-wide alert when shipments have gone without a successful update
 * for twice the stale threshold — at most every 6 hours, so an outage produces
 * a handful of alerts, not one per parcel per run.
 */
async function alertOnStaleSync(cfg: TrackingConfig, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - cfg.syncStaleHours * 2 * 3_600_000);
  const [row] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM shipment_tracking
     WHERE active AND terminal_at IS NULL AND created_at < ${ts(cutoff)}
       AND GREATEST(COALESCE(last_sync_success_at, 'epoch'::timestamptz), COALESCE(last_webhook_at, 'epoch'::timestamptz)) < ${ts(cutoff)}
  `)) as unknown as Array<{ n: number }>;
  if (!row?.n) return;
  const last = await getSetting<{ at: string }>("tracking.staleAlertAt");
  if (last && now.getTime() - new Date(last.at).getTime() < 6 * 3_600_000) return;
  await setSetting("tracking.staleAlertAt", { at: now.toISOString() }, "system");
  await alertOps({
    scope: "tracking",
    message: `${row.n} active shipment(s) have had no successful tracking update for over ${cfg.syncStaleHours * 2}h`,
    context: { count: row.n },
  });
}

async function retryFailedWebhooks(now: Date, notify: boolean): Promise<number> {
  const due = await db
    .select()
    .from(webhooksInbound)
    .where(
      and(
        eq(webhooksInbound.source, "shiprocket"),
        eq(webhooksInbound.processed, false),
        lt(webhooksInbound.attempts, 5),
        lt(webhooksInbound.createdAt, new Date(now.getTime() - 2 * 60_000)),
        // Only recent failures: never replay months-old events (or message
        // customers about them) when this worker first goes live.
        gt(webhooksInbound.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
      ),
    )
    .limit(20);
  for (const w of due) {
    await processStoredWebhook(w.id, w.externalId, w.payload, now, notify).catch((err) =>
      logError("tracking:webhook-retry", err, { webhookId: w.id }),
    );
  }
  return due.length;
}

export type SyncSummary = {
  runId: string | null;
  bootstrapped: number;
  claimed: number;
  succeeded: number;
  failed: number;
  changed: number;
  webhooksRetried: number;
  exceptionsOpened: number;
  skippedReason: string | null;
};

export async function runTrackingSync(opts: {
  trigger: "CRON" | "ADMIN_BULK";
  notify?: boolean;
  now?: Date;
  limit?: number;
}): Promise<SyncSummary> {
  const now = opts.now ?? new Date();
  const notify = opts.notify ?? true;
  const cfg = await loadTrackingConfig().catch(() => DEFAULT_TRACKING_CONFIG);
  const summary: SyncSummary = {
    runId: null,
    bootstrapped: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    changed: 0,
    webhooksRetried: 0,
    exceptionsOpened: 0,
    skippedReason: null,
  };
  const errors: Array<{ orderId: string; error: string }> = [];

  const [run] = await db
    .insert(trackingSyncRuns)
    .values({ trigger: opts.trigger, startedAt: now })
    .returning({ id: trackingSyncRuns.id });
  summary.runId = run.id;

  try {
    summary.bootstrapped = await bootstrapTrackingRows(now);
    summary.webhooksRetried = await retryFailedWebhooks(now, notify);

    const circuit = await circuitState(now);
    if (circuit) {
      summary.skippedReason = `circuit open until ${circuit.openUntil}: ${circuit.reason}`;
    } else {
      const limit = opts.limit ?? cfg.maxPerRun;
      const claimed = (await db.execute(sql`
        WITH due AS (
          SELECT id FROM shipment_tracking
           WHERE active AND next_sync_at <= ${ts(now)}
             AND (sync_locked_until IS NULL OR sync_locked_until < ${ts(now)})
           ORDER BY next_sync_at
           LIMIT ${limit}
           FOR UPDATE SKIP LOCKED
        )
        UPDATE shipment_tracking t
           SET sync_locked_until = ${ts(new Date(now.getTime() + LEASE_MINUTES * 60_000))},
               last_sync_attempt_at = ${ts(now)}
          FROM due WHERE t.id = due.id
        RETURNING t.id
      `)) as unknown as Array<{ id: string }>;
      summary.claimed = claimed.length;

      for (const [i, { id }] of claimed.entries()) {
        const row = await loadTrackingRow(id);
        if (!row) continue;
        const r = await syncClaimed(row, cfg, now, notify);
        if (r.ok) {
          summary.succeeded++;
          if (r.changed) summary.changed++;
        } else {
          summary.failed++;
          errors.push({ orderId: row.orderId, error: r.error });
          if (r.refused) {
            await openCircuit(now, cfg.circuitBreakMin, r.error.slice(0, 120));
            // Release the leases we still hold; they stay due.
            const rest = claimed.slice(i + 1).map((c) => c.id);
            if (rest.length) {
              await db
                .update(shipmentTracking)
                .set({ syncLockedUntil: null })
                .where(inArray(shipmentTracking.id, rest));
            }
            summary.skippedReason = `courier refused: ${r.error.slice(0, 120)}`;
            break;
          }
        }
        if (cfg.callSpacingMs > 0 && i < claimed.length - 1) {
          await new Promise((res) => setTimeout(res, cfg.callSpacingMs));
        }
      }
    }

    summary.exceptionsOpened = await evaluateAll(cfg, now, notify);
    await alertOnStaleSync(cfg, now);
  } finally {
    await db
      .update(trackingSyncRuns)
      .set({
        finishedAt: new Date(),
        claimed: summary.claimed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        changed: summary.changed,
        webhooksRetried: summary.webhooksRetried,
        skippedReason: summary.skippedReason,
        errors: errors.slice(0, 20),
      })
      .where(eq(trackingSyncRuns.id, run.id))
      .catch((err) => logError("tracking:run-log", err));
  }
  return summary;
}

/**
 * Sync one shipment right now (admin "Resync"). Ignores the schedule but not
 * the lease or the circuit breaker. Notifications stay on: a resync that
 * finds a real new event should behave like the scheduled worker.
 */
export async function syncTrackingNow(
  trackingId: string,
  now: Date = new Date(),
): Promise<SyncOneResult | { ok: false; error: string; refused: boolean }> {
  const cfg = await loadTrackingConfig();
  const circuit = await circuitState(now);
  if (circuit) return { ok: false, error: `Courier tracking is paused until ${circuit.openUntil}: ${circuit.reason}`, refused: true };
  const claimed = await db
    .update(shipmentTracking)
    .set({ syncLockedUntil: new Date(now.getTime() + LEASE_MINUTES * 60_000), lastSyncAttemptAt: now })
    .where(
      and(
        eq(shipmentTracking.id, trackingId),
        sql`(${shipmentTracking.syncLockedUntil} IS NULL OR ${shipmentTracking.syncLockedUntil} < ${ts(now)})`,
      ),
    )
    .returning();
  if (claimed.length === 0) return { ok: false, error: "A sync for this shipment is already running.", refused: false };
  const r = await syncClaimed(claimed[0], cfg, now, true);
  if (!r.ok && r.refused) await openCircuit(now, cfg.circuitBreakMin, r.error.slice(0, 120));
  return r;
}

/** Ensure an order has a FORWARD tracking row (used by admin resync and support). */
export async function ensureForwardTracking(orderId: string, now: Date = new Date()): Promise<ShipmentTrackingRow | null> {
  const [existing] = await db
    .select()
    .from(shipmentTracking)
    .where(and(eq(shipmentTracking.orderId, orderId), eq(shipmentTracking.kind, "FORWARD")));
  if (existing) return existing;
  const [o] = await db
    .select({
      id: orders.id,
      siteId: orders.siteId,
      awbCode: orders.awbCode,
      shipmentId: orders.shiprocketShipmentId,
      courierName: orders.courierName,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  const shipmentId = o?.shipmentId && o.shipmentId !== "undefined" ? o.shipmentId : null;
  if (!o || (!o.awbCode && !shipmentId)) return null;
  await db
    .insert(shipmentTracking)
    .values({
      siteId: o.siteId,
      orderId: o.id,
      kind: "FORWARD",
      shiprocketShipmentId: shipmentId,
      awbCode: o.awbCode || null,
      courierName: (o.courierName ?? "").trim() || null,
      status: o.awbCode ? "UNKNOWN" : "AWAITING_AWB",
      nextSyncAt: now,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(shipmentTracking)
    .where(and(eq(shipmentTracking.orderId, orderId), eq(shipmentTracking.kind, "FORWARD")));
  return row ?? null;
}
