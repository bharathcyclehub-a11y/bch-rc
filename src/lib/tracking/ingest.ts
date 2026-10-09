/**
 * Ingest one courier snapshot (webhook or poll) into a tracking row.
 *
 * In ONE transaction, with the tracking row locked FOR UPDATE so a webhook and
 * a poll for the same parcel serialise instead of racing:
 *   1. insert the snapshot's scans as immutable events (fingerprint dedup —
 *      a scan seen twice is stored once);
 *   2. rebuild the shipment state from ALL stored events, newest courier time
 *      wins — so duplicate and out-of-order deliveries cannot regress it;
 *   3. record a courier EDD only when it is plausible and actually changed,
 *      with an audit event holding the previous value;
 *   4. move the order forward (never backward) via canTrackingMoveOrder.
 * Side effects (customer messages, stock release) run after commit.
 */

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  orders,
  shipmentTracking,
  shipmentTrackingEvents,
  type ShipmentTrackingRow,
} from "@/db/schema";
import { istYmd } from "@/lib/tz";
import { notifyOrderEvent } from "@/lib/notifications/notify";
import { sendCustomerNotice } from "@/lib/notifications/customer-notice";
import { releaseOrderHoldsBestEffort } from "@/lib/inventory/release";
import { logError } from "@/lib/logger";
import { scanFingerprint, snapshotEvents, type CarrierSnapshot } from "./carrier";
import { deriveTrackingStatus } from "./derive";
import {
  MOVING_STATUSES,
  TERMINAL_STATUSES,
  canTrackingMoveOrder,
  isTrackingStatus,
  normalizeCarrierStatus,
  orderStatusFor,
  type OrderStatusFromTracking,
  type ShipmentKind,
  type TrackingStatus,
} from "./status";
import { formatIstDate, formatIstDateTime, hoursBetween } from "./time";

export type IngestSource = "WEBHOOK" | "POLL";

export type IngestOutcome = {
  trackingId: string;
  orderId: string;
  kind: ShipmentKind;
  newEvents: number;
  previousStatus: TrackingStatus;
  status: TrackingStatus;
  statusChanged: boolean;
  /** Timestamp of the event that set the current status, if any. */
  statusEventAt: Date | null;
  edd: { from: Date | null; to: Date } | null;
  newAttempt: boolean;
  deliveryAttempts: number;
  orderTransition: { from: string; to: OrderStatusFromTracking; deliveredAt: Date | null } | null;
  awbLanded: boolean;
  /** A baseline existed BEFORE this ingest → customer messages are allowed. */
  wasBaselined: boolean;
  /** Courier moved a final status back (e.g. delivered → undelivered). */
  correction: boolean;
};

const DAY_MS = 86_400_000;

function asStatus(s: string): TrackingStatus {
  return isTrackingStatus(s) ? s : "UNKNOWN";
}

export async function ingestSnapshot(
  trackingId: string,
  snap: CarrierSnapshot,
  source: IngestSource,
  now: Date = new Date(),
): Promise<IngestOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(shipmentTracking)
      .where(eq(shipmentTracking.id, trackingId))
      .for("update");
    if (!row) throw new Error(`tracking row ${trackingId} not found`);
    const kind = row.kind as ShipmentKind;
    const previousStatus = asStatus(row.status);
    // The AWB this row follows now. A snapshot for any OTHER AWB (an old,
    // superseded shipment of a re-shipped order) is kept as history only —
    // its late "CANCELED" must not override the parcel that is moving.
    const currentAwb = row.awbCode ?? snap.awb;
    const foreign = !!snap.awb && !!row.awbCode && snap.awb !== row.awbCode;

    // 1. Immutable events.
    let newEvents = 0;
    const scans = snapshotEvents(snap);
    if (scans.length > 0) {
      const values = scans.map((e) => {
        const byLabel = normalizeCarrierStatus(e.label, kind);
        return {
          trackingId,
          orderId: row.orderId,
          awbCode: snap.awb ?? row.awbCode,
          source,
          eventAt: e.at,
          status: byLabel !== "UNKNOWN" ? byLabel : normalizeCarrierStatus(e.activity, kind),
          carrierStatusCode: e.code,
          carrierStatusLabel: e.label,
          activity: e.activity,
          location: e.location,
          fingerprint: scanFingerprint(e),
          raw: e.raw,
        };
      });
      const inserted = await tx
        .insert(shipmentTrackingEvents)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: shipmentTrackingEvents.id });
      newEvents = inserted.length;
    }

    if (foreign) {
      return {
        trackingId,
        orderId: row.orderId,
        kind,
        newEvents,
        previousStatus,
        status: previousStatus,
        statusChanged: false,
        statusEventAt: row.statusChangedAt,
        edd: null,
        newAttempt: false,
        deliveryAttempts: row.deliveryAttempts,
        orderTransition: null,
        awbLanded: false,
        wasBaselined: !!row.baselineAt,
        correction: false,
      };
    }

    // 2. Rebuild state from every stored event of the CURRENT AWB, newest
    //    courier time first.
    const stored = await tx
      .select({
        status: shipmentTrackingEvents.status,
        eventAt: shipmentTrackingEvents.eventAt,
        activity: shipmentTrackingEvents.activity,
        label: shipmentTrackingEvents.carrierStatusLabel,
        location: shipmentTrackingEvents.location,
      })
      .from(shipmentTrackingEvents)
      .where(
        and(
          eq(shipmentTrackingEvents.trackingId, trackingId),
          currentAwb
            ? or(eq(shipmentTrackingEvents.awbCode, currentAwb), isNull(shipmentTrackingEvents.awbCode))
            : undefined,
        ),
      )
      .orderBy(desc(shipmentTrackingEvents.eventAt), desc(shipmentTrackingEvents.receivedAt))
      .limit(300);

    const latestAny = stored[0] ?? null;
    const latestKnown = stored.find((e) => e.status !== "UNKNOWN") ?? null;
    const awb = currentAwb;

    // Shiprocket's summary status, timed: the webhook says when; a poll is
    // Shiprocket's view right now. See derive.ts for why it outranks scans.
    const current = normalizeCarrierStatus(snap.currentLabel, kind);
    const summaryAt = source === "POLL" ? now : snap.currentAt;
    const derived = deriveTrackingStatus({
      previous: {
        status: previousStatus,
        statusChangedAt: row.statusChangedAt,
        summary:
          row.summaryStatus && row.summaryAt ? { status: asStatus(row.summaryStatus), at: row.summaryAt } : null,
      },
      latestKnownScan: latestKnown ? { status: asStatus(latestKnown.status), at: latestKnown.eventAt } : null,
      snapshotSummary: current !== "UNKNOWN" && summaryAt ? { status: current, at: summaryAt } : null,
      hasAwb: !!awb,
    });
    const status = derived.status;
    const statusEventAt = status === "DELIVERED" ? (snap.deliveredAt ?? derived.statusAt) : derived.statusAt;
    const correction = derived.correction;
    const statusChanged = status !== previousStatus;

    const attemptDays = new Set(
      stored.filter((e) => e.status === "DELIVERY_ATTEMPTED").map((e) => istYmd(e.eventAt)),
    );
    const attempts = Math.max(attemptDays.size, status === "DELIVERY_ATTEMPTED" ? (snap.attemptCount ?? 0) : 0);
    const deliveryAttempts = Math.max(row.deliveryAttempts, attempts);
    const newAttempt = attempts > row.deliveryAttempts;

    const movingTimes = stored
      .filter((e) => MOVING_STATUSES.has(asStatus(e.status)) || e.status === "DELIVERED")
      .map((e) => e.eventAt.getTime());
    if (snap.pickedUpAt) movingTimes.push(snap.pickedUpAt.getTime());
    const pickedUpAt = movingTimes.length ? new Date(Math.min(...movingTimes)) : row.pickedUpAt;

    let deliveredAt = row.deliveredAt;
    if (status === "DELIVERED") {
      const ev = stored.find((e) => e.status === "DELIVERED");
      deliveredAt = ev?.eventAt ?? snap.deliveredAt ?? row.deliveredAt;
    }

    // 3. Courier EDD — plausible and different (IST calendar day) only.
    let edd: IngestOutcome["edd"] = null;
    if (snap.edd) {
      const floor = (pickedUpAt ?? row.createdAt).getTime() - 2 * DAY_MS;
      const ceiling = now.getTime() + 45 * DAY_MS;
      const plausible = snap.edd.getTime() >= floor && snap.edd.getTime() <= ceiling;
      if (plausible && (!row.eddAt || istYmd(row.eddAt) !== istYmd(snap.edd))) {
        edd = { from: row.eddAt, to: snap.edd };
      }
    }

    // Shiprocket's wording when its summary decided the status, else the scan's.
    const baseLabel =
      (current !== "UNKNOWN" && current === status ? snap.currentLabel : null) ??
      (latestKnown && asStatus(latestKnown.status) === status ? (latestKnown.label ?? latestKnown.activity) : null) ??
      (status === previousStatus ? row.statusLabel : null) ??
      latestKnown?.label ??
      snap.currentLabel;
    const withReason =
      snap.reason && (status === "DELIVERY_ATTEMPTED" || status === "EXCEPTION" || status === "AWAITING_PICKUP")
        ? `${baseLabel ?? "Update"} — ${snap.reason}`
        : baseLabel;
    const updates: Partial<typeof shipmentTracking.$inferInsert> = {
      status,
      statusLabel: withReason,
      lastEventAt: latestAny?.eventAt ?? row.lastEventAt,
      lastEventActivity: latestAny?.activity ?? latestAny?.label ?? row.lastEventActivity,
      lastEventLocation: latestAny?.location ?? row.lastEventLocation,
      pickedUpAt,
      deliveredAt,
      deliveryAttempts,
      summaryStatus: derived.summary?.status ?? row.summaryStatus,
      summaryAt: derived.summary?.at ?? row.summaryAt,
      baselineAt: row.baselineAt ?? now,
      updatedAt: now,
    };
    if (statusChanged) {
      updates.statusChangedAt = statusEventAt ?? now;
      updates.terminalAt = TERMINAL_STATUSES.has(status) ? now : null;
      // Any real change re-arms polling (a correction can revive a row that
      // had finished its final reconciliation).
      updates.active = true;
    }
    if (edd) {
      updates.eddAt = edd.to;
      updates.eddSource = "COURIER";
      updates.eddUpdatedAt = now;
      updates.firstEddAt = row.firstEddAt ?? edd.to;
    }
    const awbLanded = !!snap.awb && !row.awbCode;
    if (awbLanded) updates.awbCode = snap.awb;
    if (snap.courierName && !(row.courierName ?? "").trim()) updates.courierName = snap.courierName;
    if (snap.shipmentId && !row.shiprocketShipmentId) updates.shiprocketShipmentId = snap.shipmentId;
    if (source === "POLL") {
      updates.lastSyncSuccessAt = now;
      updates.consecutiveFailures = 0;
      updates.lastSyncError = null;
    } else {
      updates.lastWebhookAt = now;
    }
    await tx.update(shipmentTracking).set(updates).where(eq(shipmentTracking.id, trackingId));

    if (edd) {
      await tx.insert(events).values({
        siteId: row.siteId,
        orderId: row.orderId,
        type: "TRACKING_EDD_CHANGED",
        payload: {
          trackingId,
          awb,
          from: edd.from?.toISOString() ?? null,
          to: edd.to.toISOString(),
          source: "COURIER",
          via: source,
        },
        source: source === "WEBHOOK" ? "webhook" : "cron",
      });
    }

    // 4. Order status — forward only, FORWARD shipments only.
    let orderTransition: IngestOutcome["orderTransition"] = null;
    if (kind === "FORWARD") {
      const [order] = await tx
        .select({
          id: orders.id,
          status: orders.status,
          siteId: orders.siteId,
          customerId: orders.customerId,
          awbCode: orders.awbCode,
          courierName: orders.courierName,
          trackingUrl: orders.trackingUrl,
          packedAt: orders.packedAt,
          shippedAt: orders.shippedAt,
          deliveredAt: orders.deliveredAt,
          cancelledAt: orders.cancelledAt,
        })
        .from(orders)
        .where(eq(orders.id, row.orderId));
      if (order) {
        const set: Partial<typeof orders.$inferInsert> = {};
        const mapped = orderStatusFor(status);
        if (mapped && mapped !== order.status && canTrackingMoveOrder(order.status, mapped)) {
          set.status = mapped;
          if (mapped === "PACKED" && !order.packedAt) set.packedAt = now;
          if ((mapped === "SHIPPED" || mapped === "DELIVERED" || mapped === "RETURNED") && !order.shippedAt) {
            set.shippedAt = pickedUpAt ?? now;
          }
          if (mapped === "DELIVERED" && !order.deliveredAt) set.deliveredAt = deliveredAt ?? now;
          if (mapped === "CANCELLED" && !order.cancelledAt) set.cancelledAt = now;
        }
        if (awb && !order.awbCode) {
          set.awbCode = awb;
          set.trackingUrl = order.trackingUrl ?? `https://shiprocket.co/tracking/${awb}`;
        }
        if (snap.courierName && !(order.courierName ?? "").trim()) set.courierName = snap.courierName;

        if (Object.keys(set).length > 0) {
          set.updatedAt = now;
          // Conditional on the status we read: a concurrent manual change wins.
          const done = await tx
            .update(orders)
            .set(set)
            .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
            .returning({ id: orders.id });
          if (done.length > 0 && set.status) {
            orderTransition = {
              from: order.status,
              to: set.status as OrderStatusFromTracking,
              deliveredAt: (set.deliveredAt as Date | undefined) ?? order.deliveredAt,
            };
            await tx.insert(events).values({
              siteId: order.siteId,
              orderId: order.id,
              customerId: order.customerId,
              type: `${source === "WEBHOOK" ? "WEBHOOK" : "POLL"}_SHIPROCKET_${set.status}`,
              payload: {
                awb,
                statusText: updates.statusLabel ?? null,
                trackingStatus: status,
                from: order.status,
                to: set.status,
              },
              source: source === "WEBHOOK" ? "webhook" : "cron",
            });
          }
        }
      }
    }

    return {
      trackingId,
      orderId: row.orderId,
      kind,
      newEvents,
      previousStatus,
      status,
      statusChanged,
      statusEventAt,
      edd,
      newAttempt,
      deliveryAttempts,
      orderTransition,
      awbLanded,
      wasBaselined: !!row.baselineAt,
      correction,
    };
  });
}

/** Contact details for customer messages about an order. */
export async function orderContact(orderId: string) {
  const [o] = await db
    .select({
      id: orders.id,
      siteId: orders.siteId,
      customerId: orders.customerId,
      paymentMethod: orders.paymentMethod,
      totalInr: orders.totalInr,
      confirmationFeeInr: orders.confirmationFeeInr,
      shippingAddress: orders.shippingAddress,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o) return null;
  const addr = (o.shippingAddress ?? {}) as { email?: string | null; phone?: string | null; fullName?: string };
  return {
    ...o,
    email: addr.email?.trim() || null,
    phone: addr.phone?.trim() || null,
    firstName: (addr.fullName ?? "").trim().split(/\s+/)[0] || "there",
  };
}

const trackUrl = (orderId: string) => `https://pocketrccars.com/support/track?id=${encodeURIComponent(orderId)}`;

/**
 * Post-commit effects of an ingest. `notify` is false for backfills and for
 * admin resyncs that ops asked to run silently.
 */
export async function applyIngestEffects(
  o: IngestOutcome,
  opts: { notify: boolean; now: Date },
): Promise<void> {
  const { now } = opts;
  try {
    const t = o.orderTransition;
    if (t?.to === "RETURNED") await releaseOrderHoldsBestEffort(o.orderId, "RTO");
    if (t?.to === "CANCELLED") await releaseOrderHoldsBestEffort(o.orderId, "CANCELLED");
    if (!opts.notify) return;

    // Order-lifecycle emails keep their existing semantics (notify.ts decides
    // which are actually sent). Never for a delivery older than a week —
    // catching up on a backlog must not message old customers.
    if (t?.to === "DELIVERED" && (!t.deliveredAt || hoursBetween(t.deliveredAt, now) < 7 * 24)) {
      await notifyOrderEvent(o.orderId, "DELIVERED");
    }
    if (t?.to === "PACKED" && o.awbLanded) await notifyOrderEvent(o.orderId, "SHIPMENT_CREATED");

    // Tracking notices: only after a baseline, and only for recent events.
    if (!o.wasBaselined || o.kind !== "FORWARD") return;
    const recent = (d: Date | null) => !!d && hoursBetween(d, now) < 48;
    const c = await orderContact(o.orderId);
    if (!c) return;
    const base = {
      siteId: c.siteId,
      orderId: c.id,
      customerId: c.customerId,
      email: c.email,
      phone: c.phone,
      now,
      cta: { label: "Track your order", url: trackUrl(c.id) },
    };

    if (o.statusChanged && o.status === "OUT_FOR_DELIVERY" && recent(o.statusEventAt)) {
      const due = c.paymentMethod === "COD" ? c.totalInr - c.confirmationFeeInr : 0;
      await sendCustomerNotice({
        ...base,
        kind: "OUT_FOR_DELIVERY",
        dedupKey: `${c.id}:OFD:${istYmd(o.statusEventAt!)}`,
        subject: `Order ${c.id} is out for delivery`,
        lines: [
          `Hi ${c.firstName}, the courier marked your order out for delivery at ${formatIstDateTime(o.statusEventAt!)}.`,
          ...(due > 0 ? [`Please keep ₹${due.toLocaleString("en-IN")} ready for cash on delivery.`] : []),
        ],
      });
    }
    if (o.newAttempt && o.status === "DELIVERY_ATTEMPTED" && recent(o.statusEventAt)) {
      await sendCustomerNotice({
        ...base,
        kind: "DELIVERY_ATTEMPT_FAILED",
        dedupKey: `${c.id}:ATTEMPT:${o.deliveryAttempts}`,
        subject: `Delivery attempt for ${c.id} was not completed`,
        lines: [
          `Hi ${c.firstName}, the courier tried to deliver your order on ${formatIstDateTime(o.statusEventAt!)} but could not complete it.`,
          "Couriers usually try again on the next working day. If your address or phone needs a correction, tell us from the tracking page so we can pass it on.",
        ],
      });
    }
    if (o.edd && o.edd.from) {
      await sendCustomerNotice({
        ...base,
        kind: "DELIVERY_ESTIMATE_UPDATED",
        dedupKey: `${c.id}:EDD:${istYmd(o.edd.to)}`,
        subject: `New delivery date for ${c.id}`,
        lines: [`Hi ${c.firstName}, the courier now expects to deliver your order by ${formatIstDate(o.edd.to)}.`],
      });
    }
  } catch (err) {
    logError("tracking:effects", err, { orderId: o.orderId, trackingId: o.trackingId });
  }
}

/** The row as the assessment and views need it. */
export async function loadTrackingRow(trackingId: string): Promise<ShipmentTrackingRow | null> {
  const [row] = await db.select().from(shipmentTracking).where(eq(shipmentTracking.id, trackingId));
  return row ?? null;
}
