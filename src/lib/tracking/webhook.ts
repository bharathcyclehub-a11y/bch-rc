/**
 * Courier webhook processing, shared by /api/webhooks/courier (first attempt)
 * and the tracking worker (dead-letter retries of rows that failed).
 *
 * The inbound row is written BEFORE processing, so a crash or DB blip never
 * loses an event: the row stays processed=false with its error and attempt
 * count, and the worker retries it (max 5 attempts) — see retryFailedWebhooks.
 */

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, shipmentTracking, shipmentTrackingEvents, webhooksInbound } from "@/db/schema";
import { baseOrderId, parseShiprocketWebhook, type ShiprocketWebhook } from "./carrier";
import { normalizeCarrierStatus } from "./status";
import { applyIngestEffects, ingestSnapshot, loadTrackingRow } from "./ingest";
import { assessRow, loadOrderForEstimate, raiseException, reconcileExceptions } from "./exceptions";
import { ensureForwardTracking, loadTrackingConfig, repointTracking } from "./sync";

/**
 * Dedup key for an inbound webhook. Includes the courier timestamp and scan
 * count: the old key (order + status text) dropped every later "IN TRANSIT"
 * update for the same order as a duplicate, so a parcel's second, third…
 * in-transit scans never reached us.
 */
export function webhookExternalId(e: ShiprocketWebhook): string {
  const subject = e.awb ?? e.channel_order_id ?? e.order_id ?? "unknown";
  const key = [
    String(subject),
    e.current_status ?? e.shipment_status ?? "",
    String(e.current_status_id ?? ""),
    e.current_timestamp ?? "",
    String(Array.isArray(e.scans) ? e.scans.length : 0),
    e.etd ?? "",
  ].join("|");
  return `sr:${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

/** Statuses in which a FORWARD row may be moved to a re-ship's new AWB. */
const REPOINTABLE = new Set(["CANCELLED", "AWAITING_AWB", "AWAITING_PICKUP", "UNKNOWN"]);

async function findTrackingId(e: ShiprocketWebhook): Promise<string | null> {
  const awb = e.awb != null ? String(e.awb).trim() : "";
  if (awb) {
    const [t] = await db
      .select({ id: shipmentTracking.id })
      .from(shipmentTracking)
      .where(eq(shipmentTracking.awbCode, awb));
    if (t) return t.id;
  }

  // Match the order: OUR id (channel_order_id, or order_id in tests/legacy),
  // its base id when Shiprocket cloned it ("PRC-X-C"), then Shiprocket's
  // numeric id. Shiprocket sends the AWB as a JSON number, so every
  // comparison is String()-coerced.
  let orderId: string | null = null;
  let cloned = false;
  for (const [col, val, isClone] of [
    [orders.id, e.channel_order_id, false],
    [orders.id, e.order_id, false],
    [orders.id, baseOrderId(e.channel_order_id), true],
    [orders.id, baseOrderId(e.order_id != null ? String(e.order_id) : null), true],
    [orders.shiprocketOrderId, e.order_id, false],
    [orders.shiprocketOrderId, e.sr_order_id, false],
    [orders.awbCode, awb || undefined, false],
  ] as const) {
    if (val == null || String(val) === "") continue;
    const [o] = await db.select({ id: orders.id }).from(orders).where(eq(col, String(val)));
    if (o) {
      orderId = o.id;
      cloned = isClone;
      break;
    }
  }
  if (!orderId) return null;

  const [o] = await db.select({ siteId: orders.siteId }).from(orders).where(eq(orders.id, orderId));
  const idByAwb = async () => {
    const [t] = await db.select({ id: shipmentTracking.id }).from(shipmentTracking).where(eq(shipmentTracking.awbCode, awb));
    return t?.id ?? null;
  };

  if ((e.is_return === 1 || e.is_return === true) && awb) {
    // A reverse pickup we haven't seen yet — track it as its own shipment.
    await db
      .insert(shipmentTracking)
      .values({ siteId: o.siteId, orderId, kind: "RETURN", awbCode: awb, status: "AWAITING_PICKUP" })
      .onConflictDoNothing();
    return idByAwb();
  }

  const fwd = await ensureForwardTracking(orderId);
  if (!fwd) {
    // Order exists but has no shipment on our side: start a row from the
    // webhook's own AWB so the event is not lost.
    await db
      .insert(shipmentTracking)
      .values({ siteId: o.siteId, orderId, kind: "FORWARD", awbCode: awb || null, status: awb ? "UNKNOWN" : "AWAITING_AWB" })
      .onConflictDoNothing();
    const [t] = await db
      .select({ id: shipmentTracking.id })
      .from(shipmentTracking)
      .where(and(eq(shipmentTracking.orderId, orderId), eq(shipmentTracking.kind, "FORWARD")));
    return t?.id ?? null;
  }

  // A DIFFERENT AWB for an order we already track:
  //   - a superseded AWB (seen before on this order, or a cancellation)
  //     → the forward row, where ingest keeps it as history only;
  //   - the existing shipment never got going / was cancelled, or Shiprocket
  //     cloned the order → this is the re-ship: follow the new AWB;
  //   - otherwise → an extra parcel for the same order.
  if (awb && fwd.awbCode && fwd.awbCode !== awb) {
    const [seen] = await db
      .select({ id: shipmentTrackingEvents.id })
      .from(shipmentTrackingEvents)
      .where(and(eq(shipmentTrackingEvents.orderId, orderId), eq(shipmentTrackingEvents.awbCode, awb)))
      .limit(1);
    const isCancel = normalizeCarrierStatus(e.current_status ?? e.shipment_status) === "CANCELLED";
    if (seen || isCancel) return fwd.id;
    if (REPOINTABLE.has(fwd.status) || cloned) {
      await repointTracking(fwd.id, awb, cloned ? "Shiprocket clone (re-ship)" : "new AWB from courier webhook");
      return fwd.id;
    }
    await db
      .insert(shipmentTracking)
      .values({ siteId: o.siteId, orderId, kind: "REPLACEMENT", awbCode: awb, status: "UNKNOWN" })
      .onConflictDoNothing();
    return idByAwb();
  }
  return fwd.id;
}

/**
 * Process one stored webhook row. Never throws: failures are written to the
 * row (error + attempts) and left processed=false for the retry worker.
 */
export async function processStoredWebhook(
  rowId: string,
  externalId: string,
  payload: unknown,
  now: Date = new Date(),
  notify = true,
): Promise<{ matched: boolean; error?: string }> {
  try {
    const event = (payload ?? {}) as ShiprocketWebhook;
    const trackingId = await findTrackingId(event);
    if (!trackingId) {
      await db
        .update(webhooksInbound)
        .set({ processed: true, processedAt: now, error: "No matching order", attempts: sql`${webhooksInbound.attempts} + 1` })
        .where(eq(webhooksInbound.id, rowId));
      return { matched: false };
    }

    const snap = parseShiprocketWebhook(event);
    const outcome = await ingestSnapshot(trackingId, snap, "WEBHOOK", now);
    await applyIngestEffects(outcome, { notify, now });

    const cfg = await loadTrackingConfig();
    const fresh = await loadTrackingRow(trackingId);
    if (fresh) {
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
      const order = await loadOrderForEstimate(fresh.orderId);
      await reconcileExceptions(fresh, assessRow(fresh, order, now, cfg), { now, notify });
    }

    await db
      .update(webhooksInbound)
      .set({ processed: true, processedAt: now, error: null, attempts: sql`${webhooksInbound.attempts} + 1` })
      .where(eq(webhooksInbound.id, rowId));
    return { matched: true };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await db
      .update(webhooksInbound)
      .set({ error, attempts: sql`${webhooksInbound.attempts} + 1` })
      .where(eq(webhooksInbound.id, rowId))
      .catch(() => {});
    return { matched: false, error: `${externalId}: ${error}` };
  }
}
