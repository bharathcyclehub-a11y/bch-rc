/**
 * Delivery exceptions — open, update, escalate and auto-resolve.
 *
 * One OPEN/ACKNOWLEDGED row per (order, shipment, type), enforced by a partial
 * unique index, so repeated worker runs update the same row instead of piling
 * up duplicates. Automatic types (AUTO_EXCEPTION_TYPES) are resolved by the
 * worker when the condition clears; CUSTOMER_REPORTED and CARRIER_CORRECTION
 * are only ever resolved by a person.
 *
 * Escalation (ops alert) happens once per exception row, the first time the
 * assessment marks it `escalate`.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliveryExceptions, orders, type ShipmentTrackingRow } from "@/db/schema";
import { alertOps } from "@/lib/alert";
import { sendCustomerNotice } from "@/lib/notifications/customer-notice";
import { resolveServiceability } from "@/lib/serviceability";
import { istYmd } from "@/lib/tz";
import { logError } from "@/lib/logger";
import {
  AUTO_EXCEPTION_TYPES,
  EXCEPTION_LABEL,
  assessTracking,
  maxSeverity,
  type AssessedException,
  type Assessment,
  type ExceptionType,
  type Severity,
  type TrackingFacts,
} from "./assess";
import type { TrackingConfig } from "./config";
import { isTrackingStatus, type ShipmentKind } from "./status";
import { formatIstDate, formatIstDateTime } from "./time";

const DAY_MS = 86_400_000;

export type OrderForEstimate = {
  id: string;
  siteId: string;
  customerId: string;
  status: string;
  placedAt: Date;
  paidAt: Date | null;
  shippingAddress: unknown;
};

/**
 * PRC's own delivery estimate, used ONLY while the courier has given none.
 * Documented rule (the same one checkout and the order page use): the
 * pincode's serviceability window from src/lib/serviceability.ts — metro 2–3
 * days, elsewhere 3–5 — counted from courier pickup, or from payment /
 * placement before pickup. Always labelled "PRC estimate" to the customer.
 */
export function storeEstimateFor(order: OrderForEstimate, pickedUpAt: Date | null): Date | null {
  const pincode = (order.shippingAddress as { pincode?: string } | null)?.pincode;
  if (!pincode) return null;
  const anchor = pickedUpAt ?? order.paidAt ?? order.placedAt;
  const s = resolveServiceability(pincode, anchor);
  if (!s.serviceable || !s.etaMaxDays) return null;
  return new Date(anchor.getTime() + s.etaMaxDays * DAY_MS);
}

export function factsFromRow(row: ShipmentTrackingRow): TrackingFacts {
  return {
    kind: row.kind as ShipmentKind,
    status: isTrackingStatus(row.status) ? row.status : "UNKNOWN",
    statusLabel: row.statusLabel,
    statusChangedAt: row.statusChangedAt,
    awbCode: row.awbCode,
    createdAt: row.createdAt,
    lastEventAt: row.lastEventAt,
    eddAt: row.eddAt,
    eddSource: row.eddSource,
    deliveredAt: row.deliveredAt,
    terminalAt: row.terminalAt,
    deliveryAttempts: row.deliveryAttempts,
    lastSyncSuccessAt: row.lastSyncSuccessAt,
    lastWebhookAt: row.lastWebhookAt,
    consecutiveFailures: row.consecutiveFailures,
  };
}

export async function loadOrderForEstimate(orderId: string): Promise<OrderForEstimate | null> {
  const [o] = await db
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
    .where(eq(orders.id, orderId));
  return o ?? null;
}

export function assessRow(row: ShipmentTrackingRow, order: OrderForEstimate | null, now: Date, config: TrackingConfig): Assessment {
  const storeEstimate = order && row.kind === "FORWARD" ? storeEstimateFor(order, row.pickedUpAt) : null;
  return assessTracking(factsFromRow(row), { now, config, storeEstimate, orderStatus: order?.status ?? null });
}

/** Open (or refresh) one exception. Returns its id and whether it is new. */
export async function raiseException(input: {
  siteId: string;
  orderId: string;
  trackingId: string | null;
  type: ExceptionType;
  severity: Severity;
  detail: string;
  context?: Record<string, unknown>;
  ticketId?: string | null;
  now?: Date;
}): Promise<{ id: string; created: boolean }> {
  const now = input.now ?? new Date();
  const inserted = await db
    .insert(deliveryExceptions)
    .values({
      siteId: input.siteId,
      orderId: input.orderId,
      trackingId: input.trackingId,
      type: input.type,
      severity: input.severity,
      detail: input.detail,
      context: input.context ?? {},
      ticketId: input.ticketId ?? null,
      openedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: deliveryExceptions.id });
  if (inserted.length > 0) return { id: inserted[0].id, created: true };

  const [existing] = await db
    .select({ id: deliveryExceptions.id, severity: deliveryExceptions.severity })
    .from(deliveryExceptions)
    .where(
      and(
        eq(deliveryExceptions.orderId, input.orderId),
        eq(deliveryExceptions.type, input.type),
        ne(deliveryExceptions.status, "RESOLVED"),
        input.trackingId
          ? eq(deliveryExceptions.trackingId, input.trackingId)
          : sql`${deliveryExceptions.trackingId} IS NULL`,
      ),
    )
    .limit(1);
  if (!existing) throw new Error(`exception ${input.type} for ${input.orderId} neither inserted nor found`);
  await db
    .update(deliveryExceptions)
    .set({
      lastSeenAt: now,
      detail: input.detail,
      severity: maxSeverity(existing.severity as Severity, input.severity),
      ticketId: input.ticketId ?? undefined,
      updatedAt: now,
    })
    .where(eq(deliveryExceptions.id, existing.id));
  return { id: existing.id, created: false };
}

export async function resolveExceptionRow(id: string, by: string, resolution: string, now = new Date()) {
  await db
    .update(deliveryExceptions)
    .set({ status: "RESOLVED", resolvedAt: now, resolvedBy: by, resolution, updatedAt: now })
    .where(and(eq(deliveryExceptions.id, id), ne(deliveryExceptions.status, "RESOLVED")));
}

export async function acknowledgeExceptionRow(id: string, by: string, now = new Date()) {
  await db
    .update(deliveryExceptions)
    .set({ status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedBy: by, updatedAt: now })
    .where(and(eq(deliveryExceptions.id, id), eq(deliveryExceptions.status, "OPEN")));
}

const trackUrl = (orderId: string) => `https://pocketrccars.com/support/track?id=${encodeURIComponent(orderId)}`;

async function noticeFor(
  row: ShipmentTrackingRow,
  e: AssessedException,
  a: Assessment,
  now: Date,
): Promise<boolean> {
  const [o] = await db
    .select({ id: orders.id, siteId: orders.siteId, customerId: orders.customerId, shippingAddress: orders.shippingAddress })
    .from(orders)
    .where(eq(orders.id, row.orderId));
  if (!o) return false;
  const addr = (o.shippingAddress ?? {}) as { email?: string | null; phone?: string | null; fullName?: string };
  const firstName = (addr.fullName ?? "").trim().split(/\s+/)[0] || "there";
  const base = {
    siteId: o.siteId,
    orderId: o.id,
    customerId: o.customerId,
    email: addr.email?.trim() || null,
    phone: addr.phone?.trim() || null,
    now,
    cta: { label: "See live tracking", url: trackUrl(o.id) },
  };
  const lastScan = a.lastCourierUpdateAt
    ? `Last courier update: ${row.lastEventActivity ?? "scan"}${row.lastEventLocation ? `, ${row.lastEventLocation}` : ""} — ${formatIstDateTime(a.lastCourierUpdateAt)}.`
    : "The courier has not shared a scan yet.";

  if (e.type === "EDD_EXPIRED" && a.estimate.expiredDate) {
    return sendCustomerNotice({
      ...base,
      kind: "DELIVERY_DELAYED",
      dedupKey: `${o.id}:DELAYED:${istYmd(a.estimate.expiredDate)}`,
      subject: `Your order ${o.id} is running late`,
      lines: [
        `Hi ${firstName}, your order was expected by ${formatIstDate(a.estimate.expiredDate)} and hasn't been delivered yet. The courier hasn't given a new date.`,
        lastScan,
        "We've asked the courier for an update and keep checking automatically. You don't need to do anything — we'll email you if anything changes.",
      ],
    });
  }
  if (e.type === "CARRIER_EXCEPTION") {
    return sendCustomerNotice({
      ...base,
      kind: "DELIVERY_EXCEPTION",
      dedupKey: `${o.id}:EXCEPTION:${(row.statusLabel ?? "x").toUpperCase().replace(/[^A-Z]+/g, "-")}`,
      subject: `An update on your order ${o.id}`,
      lines: [
        `Hi ${firstName}, the courier has reported a problem with your parcel: "${row.statusLabel ?? "exception"}".`,
        "Our team is following up with the courier and will contact you with next steps.",
      ],
    });
  }
  return false;
}

/**
 * Bring delivery_exceptions in line with an assessment. `notify` gates the
 * customer notice (never for backfills or before the row has a baseline).
 */
export async function reconcileExceptions(
  row: ShipmentTrackingRow,
  a: Assessment,
  ctx: { now: Date; notify: boolean },
): Promise<{ opened: ExceptionType[]; resolved: ExceptionType[]; escalated: ExceptionType[] }> {
  const { now } = ctx;
  const opened: ExceptionType[] = [];
  const resolved: ExceptionType[] = [];
  const escalated: ExceptionType[] = [];

  const current = await db
    .select()
    .from(deliveryExceptions)
    .where(and(eq(deliveryExceptions.trackingId, row.id), ne(deliveryExceptions.status, "RESOLVED")));

  for (const e of a.exceptions) {
    try {
      const { id, created } = await raiseException({
        siteId: row.siteId,
        orderId: row.orderId,
        trackingId: row.id,
        type: e.type,
        severity: e.severity,
        detail: e.detail,
        context: {
          status: a.status,
          lastCourierUpdateAt: a.lastCourierUpdateAt?.toISOString() ?? null,
          lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null,
          awb: row.awbCode,
        },
        now,
      });
      if (created) opened.push(e.type);
      const prior = current.find((x) => x.id === id);

      if (e.escalate && !prior?.escalatedAt) {
        const claimed = await db
          .update(deliveryExceptions)
          .set({ escalatedAt: now, updatedAt: now })
          .where(and(eq(deliveryExceptions.id, id), sql`${deliveryExceptions.escalatedAt} IS NULL`))
          .returning({ id: deliveryExceptions.id });
        if (claimed.length > 0) {
          escalated.push(e.type);
          await alertOps({
            scope: "tracking",
            message: `${EXCEPTION_LABEL[e.type]} on ${row.orderId}: ${e.detail}`,
            siteId: row.siteId,
            orderId: row.orderId,
            context: { awb: row.awbCode, severity: e.severity, type: e.type },
          });
        }
      }

      if (ctx.notify && row.baselineAt && !prior?.customerNotifiedAt && e.customerVisible) {
        if (await noticeFor(row, e, a, now)) {
          await db
            .update(deliveryExceptions)
            .set({ customerNotifiedAt: now })
            .where(eq(deliveryExceptions.id, id));
        }
      }
    } catch (err) {
      logError("tracking:exception", err, { orderId: row.orderId, type: e.type });
    }
  }

  const stillTrue = new Set(a.exceptions.map((e) => e.type));
  const clear = current.filter(
    (x) => AUTO_EXCEPTION_TYPES.has(x.type as ExceptionType) && !stillTrue.has(x.type as ExceptionType),
  );
  if (clear.length > 0) {
    await db
      .update(deliveryExceptions)
      .set({
        status: "RESOLVED",
        resolvedAt: now,
        resolvedBy: "system",
        resolution: `Cleared automatically — shipment now ${a.customerLabel.toLowerCase()}.`,
        updatedAt: now,
      })
      .where(inArray(deliveryExceptions.id, clear.map((x) => x.id)));
    resolved.push(...clear.map((x) => x.type as ExceptionType));
  }

  return { opened, resolved, escalated };
}
