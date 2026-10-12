/**
 * Reconciliation orchestrator — the surge safety net. Run frequently from the
 * cron. Each step is independent, idempotent, and concurrency-safe so two
 * overlapping cron invocations cannot double-act.
 *
 * Steps:
 *  1. sweepAbandonedOrders — PENDING prepaid orders that never paid (closed the
 *     Razorpay modal, lost network, timed out) are marked ABANDONED and their
 *     reserved inventory + coupon usage released. This is what stops the
 *     "inventory leak": stock reserved at checkout is always returned.
 *  2. drainShipmentJobs — durable fulfillment queue; also re-enqueues any PAID
 *     order missing a shipment and reaps stuck PROCESSING leases.
 *  3. drainNotificationsOutbox — retry any notification that failed inline.
 *  4. alert if permanently-failed shipment jobs exist.
 */

import { and, eq, inArray, lt, gte, isNotNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { events, orders } from "@/db/schema";
import { releaseOrderHolds, reacquireOrderHolds } from "@/lib/inventory/release";
import {
  drainShipmentJobs,
  countFailedShipmentJobs,
  enqueueShipmentJob,
  runShipmentJobOnce,
} from "@/lib/fulfillment/shipment-queue";
import { drainNotificationsOutbox } from "@/lib/notifications/drain";
import { notifyOrderEvent } from "@/lib/notifications/notify";
import { razorpay } from "@/lib/razorpay";
import { alertOps } from "@/lib/alert";
import { logError } from "@/lib/logger";

/** A prepaid order PENDING longer than this is considered abandoned. */
const ABANDON_AFTER_MINUTES = 30;

/**
 * Hours a COD order can sit unverified before the sweeper auto-rejects it.
 * Picked to give the operator + customer two waking windows (kid orders in
 * the evening get the morning + evening shift to resolve). Inventory is
 * released exactly like a customer-initiated cancel.
 */
const COD_VERIFY_TIMEOUT_HOURS = 48;

export async function sweepAbandonedOrders(
  olderThanMinutes = ABANDON_AFTER_MINUTES,
  limit = 200,
): Promise<{ swept: number; released: number }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  // Only prepaid orders sit at PENDING — COD is marked PAID at create. Claim a
  // batch by flipping PENDING → ABANDONED atomically (the conditional UPDATE is
  // the claim; a concurrent sweep gets the remaining rows, never the same one).
  const claimed = await db
    .update(orders)
    .set({ status: "ABANDONED", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(orders.status, "PENDING"),
        lt(orders.placedAt, cutoff),
        inArray(
          orders.id,
          db
            .select({ id: orders.id })
            .from(orders)
            .where(and(eq(orders.status, "PENDING"), lt(orders.placedAt, cutoff)))
            .limit(limit),
        ),
      ),
    )
    .returning({ id: orders.id });

  let released = 0;
  for (const o of claimed) {
    try {
      const r = await releaseOrderHolds(o.id, "ABANDONED");
      if (r.released) released++;
    } catch (err) {
      logError("reconcile:release", err, { orderId: o.id });
    }
  }

  return { swept: claimed.length, released };
}

/**
 * Auto-reject any COD orders that have been sitting unverified for too long.
 * Same flow as a manual /cod reject — atomic status flip, release inventory,
 * log an event. Customer is NOT notified (silent reject; see /cod actions).
 */
export async function sweepUnverifiedCodOrders(
  olderThanHours = COD_VERIFY_TIMEOUT_HOURS,
  limit = 200,
): Promise<{ swept: number; released: number }> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const claimed = await db
    .update(orders)
    .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(orders.status, "PENDING_COD_VERIFICATION"),
        lt(orders.placedAt, cutoff),
        inArray(
          orders.id,
          db
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                eq(orders.status, "PENDING_COD_VERIFICATION"),
                lt(orders.placedAt, cutoff),
              ),
            )
            .limit(limit),
        ),
      ),
    )
    .returning({
      id: orders.id,
      siteId: orders.siteId,
      customerId: orders.customerId,
    });

  let released = 0;
  for (const o of claimed) {
    try {
      const r = await releaseOrderHolds(o.id, "CANCELLED");
      if (r.released) released++;
    } catch (err) {
      logError("reconcile:cod-release", err, { orderId: o.id });
    }
    try {
      await db.insert(events).values({
        siteId: o.siteId,
        orderId: o.id,
        customerId: o.customerId,
        type: "COD_AUTO_REJECTED",
        payload: { reason: "verify-timeout", olderThanHours },
        source: "system",
      });
    } catch (err) {
      logError("reconcile:cod-event", err, { orderId: o.id });
    }
  }

  return { swept: claimed.length, released };
}

/**
 * Recover paid-but-not-recorded orders — the money-truth backstop.
 *
 * Razorpay is the source of truth for whether a customer paid. Any order still
 * in a non-paid state (PENDING / FAILED / ABANDONED) that actually HAS a
 * captured payment is a silently-dropped sale: the most common cause is a
 * Razorpay retry (failed attempt → order marked FAILED + stock released →
 * customer retries → succeeds, but the capture was ignored), plus any
 * payment.captured webhook we never received. We reconcile our state to
 * Razorpay so a paid order is NEVER lost and no manual daily verification is
 * needed.
 *
 * For each match: re-reserve stock if a prior failure released it, mark
 * PAID/CAPTURED, fire the shipment + customer confirmation — exactly what the
 * live capture path does.
 *
 * `withinMs` bounds how far back we look (default 7 days for the cron). Callers
 * that only need to catch a *just-completed* payment — e.g. the recovery page,
 * confirming nobody about to be nudged has actually paid — pass a short window
 * so the Razorpay round-trips stay to the handful of genuinely-recent orders.
 */
export async function recoverCapturedPayments(
  limit = 100,
  withinMs = 7 * 24 * 60 * 60 * 1000,
): Promise<{ checked: number; recovered: number }> {
  const candidates = await db
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, [
          "PENDING",
          "FAILED",
          "ABANDONED",
          "PENDING_COD_VERIFICATION",
        ]),
        isNotNull(orders.razorpayOrderId),
        gte(orders.placedAt, new Date(Date.now() - withinMs)),
      ),
    )
    .orderBy(desc(orders.placedAt))
    .limit(limit);

  let recovered = 0;
  for (const o of candidates) {
    if (o.paymentStatus === "CAPTURED") continue;
    try {
      const pays = await razorpay.orders.fetchPayments(o.razorpayOrderId!);
      const cap = (pays.items as { id: string; status: string; amount: number }[]).find(
        (p) => p.status === "captured",
      );
      if (!cap) continue;

      // Amount must match what we expect (full total for prepaid, confirmation
      // fee for partial-prepaid COD) — guards against a stray payment on a
      // reused order id.
      const isPartialCod = o.paymentMethod === "COD" && o.confirmationFeeInr > 0;
      const expectedPaise = (isPartialCod ? o.confirmationFeeInr : o.totalInr) * 100;
      if (Number(cap.amount) !== expectedPaise) {
        await db
          .insert(events)
          .values({
            siteId: o.siteId,
            orderId: o.id,
            customerId: o.customerId,
            type: "PAYMENT_RECOVER_AMOUNT_MISMATCH",
            payload: { paymentId: cap.id, paid: cap.amount, expected: expectedPaise, status: o.status },
            source: "system",
          })
          .catch(() => {});
        continue;
      }

      if (o.holdsReleased) await reacquireOrderHolds(o.id);
      await db
        .update(orders)
        .set({
          status: "PAID",
          paymentStatus: "CAPTURED",
          razorpayPaymentId: cap.id,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, o.id));
      await db.insert(events).values({
        siteId: o.siteId,
        orderId: o.id,
        customerId: o.customerId,
        type: "PAYMENT_RECOVERED_RECONCILE",
        payload: { paymentId: cap.id, amount: cap.amount, priorStatus: o.status },
        source: "system",
      });

      await enqueueShipmentJob(o.id);
      await runShipmentJobOnce(o.id).catch(() => {});
      await notifyOrderEvent(o.id, "PAYMENT_CAPTURED").catch(() => {});
      recovered++;
    } catch (err) {
      logError("reconcile:recover-captured", err, { orderId: o.id });
    }
  }
  return { checked: candidates.length, recovered };
}

export type ReconcileSummary = {
  recoveredPayments: { checked: number; recovered: number };
  abandoned: { swept: number; released: number };
  codAutoRejected: { swept: number; released: number };
  shipments: Awaited<ReturnType<typeof drainShipmentJobs>>;
  notifications: Awaited<ReturnType<typeof drainNotificationsOutbox>>;
  failedShipmentJobs: number;
};

export async function reconcileAll(): Promise<ReconcileSummary> {
  // Money-truth first: recover any paid-but-dropped order BEFORE the abandon
  // sweep, so a captured order is never mistakenly swept to ABANDONED.
  const recoveredPayments = await recoverCapturedPayments().catch((err) => {
    logError("reconcile:recover-captured-all", err);
    return { checked: 0, recovered: 0 };
  });
  if (recoveredPayments.recovered > 0) {
    await alertOps({
      scope: "reconcile",
      message: `Recovered ${recoveredPayments.recovered} paid-but-dropped order(s) from Razorpay`,
      context: recoveredPayments,
    }).catch(() => {});
  }

  const abandoned = await sweepAbandonedOrders().catch((err) => {
    logError("reconcile:sweep", err);
    return { swept: 0, released: 0 };
  });

  const codAutoRejected = await sweepUnverifiedCodOrders().catch((err) => {
    logError("reconcile:cod-sweep", err);
    return { swept: 0, released: 0 };
  });

  const shipments = await drainShipmentJobs(50).catch((err) => {
    logError("reconcile:shipments", err);
    return { enqueued: 0, reaped: 0, processed: 0, done: 0, failed: 0, held: 0 };
  });

  const notifications = await drainNotificationsOutbox(200).catch((err) => {
    logError("reconcile:notifications", err);
    return { drained: 0, sent: 0, failed: 0, exhausted: 0 };
  });

  const failedShipmentJobs = await countFailedShipmentJobs().catch(() => 0);
  if (failedShipmentJobs > 0) {
    await alertOps({
      scope: "reconcile",
      message: `${failedShipmentJobs} shipment job(s) parked FAILED and need manual attention`,
      context: { failedShipmentJobs },
    });
  }

  return {
    recoveredPayments,
    abandoned,
    codAutoRejected,
    shipments,
    notifications,
    failedShipmentJobs,
  };
}
