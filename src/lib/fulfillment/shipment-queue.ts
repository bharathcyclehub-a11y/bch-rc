/**
 * Durable shipment job queue — exactly-once, concurrency-safe fulfillment.
 *
 * One job row per order (PK on order_id). Every trigger path —
 * /verify, the Razorpay webhook, COD order-create, and the admin retry —
 * calls `enqueueShipmentJob`, an INSERT ... ON CONFLICT DO NOTHING. So no
 * matter how many of them fire (verify racing the webhook), at most one job
 * exists.
 *
 * A worker claims a job with the atomic transition PENDING → PROCESSING (a
 * conditional UPDATE guarded on status). Only one worker can win that row, so
 * `createShipmentForOrder` runs once. The external Shiprocket call happens
 * AFTER the claim commits — we never hold a row lock across a network call.
 *
 * On failure the job backs off and stays retryable until `max_attempts`, after
 * which it is parked FAILED and an ops alert fires. The reconciliation cron
 * drains due jobs, reaps stuck PROCESSING leases, and enqueues any PAID order
 * that somehow has no job.
 */

import { and, eq, isNull, lte, sql, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { orders, shipmentJobs } from "@/db/schema";
import {
  createShipmentForOrder,
  NotShippableError,
  OrderNotFoundError,
  type ShipmentResult,
} from "@/lib/fulfillment/create-shipment";
import { alertOps } from "@/lib/alert";
import { logError } from "@/lib/logger";

/** Minutes a PROCESSING lease is honored before the job is considered stuck. */
const LEASE_MINUTES = 5;

/**
 * Minimum gap between two heal attempts on the same finished-but-shipmentless
 * job (step 2b in `drainShipmentJobs`). Keeps self-healing without turning a
 * persistent upstream failure into a retry storm.
 */
const HEAL_COOLDOWN_MINUTES = 60;

function backoffSeconds(attempt: number): number {
  // 1m, 2m, 4m, 8m, 16m, capped at 30m.
  return Math.min(60 * 2 ** Math.max(0, attempt - 1), 1800);
}

/**
 * Ensure a shipment job exists for this order. Idempotent — the PK + ON
 * CONFLICT DO NOTHING means concurrent callers collapse to one row.
 */
export async function enqueueShipmentJob(orderId: string): Promise<void> {
  await db
    .insert(shipmentJobs)
    .values({ orderId, status: "PENDING" })
    .onConflictDoNothing({ target: shipmentJobs.orderId });
}

type FinalizeOutcome =
  | { ok: true; result: ShipmentResult }
  | { ok: false; error: string; permanent: boolean };

async function finalize(
  orderId: string,
  attempts: number,
  maxAttempts: number,
  outcome: FinalizeOutcome,
): Promise<void> {
  if (outcome.ok) {
    await db
      .update(shipmentJobs)
      .set({ status: "DONE", lastError: null, lockedAt: null, updatedAt: new Date() })
      .where(eq(shipmentJobs.orderId, orderId));
    return;
  }

  const exhausted = outcome.permanent || attempts >= maxAttempts;
  if (exhausted) {
    await db
      .update(shipmentJobs)
      .set({
        status: "FAILED",
        lastError: outcome.error.slice(0, 500),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(shipmentJobs.orderId, orderId));

    // Only alert the FIRST time a job exhausts its budget. A healed job (step
    // 2b) keeps its attempt count, so without this an order stuck on a
    // persistent upstream failure re-alerts on every heal cycle forever.
    if (attempts > maxAttempts) return;

    const [o] = await db
      .select({ siteId: orders.siteId, customerId: orders.customerId, status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId));
    await alertOps({
      scope: "fulfillment",
      message: `Shipment creation FAILED permanently for ${orderId} after ${attempts} attempts`,
      siteId: o?.siteId,
      orderId,
      customerId: o?.customerId,
      context: { attempts, orderStatus: o?.status ?? "unknown", error: outcome.error.slice(0, 200) },
    });
    return;
  }

  await db
    .update(shipmentJobs)
    .set({
      status: "PENDING",
      lastError: outcome.error.slice(0, 500),
      lockedAt: null,
      nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
      updatedAt: new Date(),
    })
    .where(eq(shipmentJobs.orderId, orderId));
}

async function runClaimed(
  orderId: string,
  attempts: number,
  maxAttempts: number,
): Promise<{ ran: boolean; result?: ShipmentResult; error?: string }> {
  try {
    const result = await createShipmentForOrder(orderId);
    await finalize(orderId, attempts, maxAttempts, { ok: true, result });
    return { ran: true, result };
  } catch (err) {
    // NotShippable / OrderNotFound are permanent for this job — retrying won't
    // help (e.g. order CANCELLED). Everything else (Shiprocket 5xx, network)
    // is transient and should back off + retry.
    const permanent =
      err instanceof NotShippableError || err instanceof OrderNotFoundError;
    const error = err instanceof Error ? err.message : String(err);
    await finalize(orderId, attempts, maxAttempts, { ok: false, error, permanent });
    if (!permanent) logError("fulfillment:job", err, { orderId, attempts });
    return { ran: true, error };
  }
}

/**
 * Claim and run the job for a single order, right now. Used on the hot path
 * (after payment) for instant fulfillment and by the admin retry button.
 * Returns ran:false when another worker already holds/finished the job — in
 * which case the order's existing shipment (if any) is authoritative.
 */
export async function runShipmentJobOnce(
  orderId: string,
): Promise<{ ran: boolean; result?: ShipmentResult; error?: string; alreadyDone?: boolean }> {
  await enqueueShipmentJob(orderId);

  // Atomic claim: PENDING (and due) → PROCESSING. Conditional UPDATE = the lock.
  const claimed = await db
    .update(shipmentJobs)
    .set({
      status: "PROCESSING",
      lockedAt: new Date(),
      attempts: sql`${shipmentJobs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shipmentJobs.orderId, orderId),
        eq(shipmentJobs.status, "PENDING"),
        lte(shipmentJobs.nextAttemptAt, new Date()),
      ),
    )
    .returning({ attempts: shipmentJobs.attempts, maxAttempts: shipmentJobs.maxAttempts });

  if (claimed.length === 0) {
    const [job] = await db
      .select({ status: shipmentJobs.status })
      .from(shipmentJobs)
      .where(eq(shipmentJobs.orderId, orderId));
    return { ran: false, alreadyDone: job?.status === "DONE" };
  }

  return runClaimed(orderId, claimed[0].attempts, claimed[0].maxAttempts);
}

/**
 * Drain due jobs (reconciliation cron). Reaps stuck PROCESSING leases first,
 * enqueues any PAID order missing a job, then processes a batch. Each job is
 * claimed with the same atomic transition, so overlapping cron runs are safe.
 */
export async function drainShipmentJobs(
  batchSize = 50,
): Promise<{ enqueued: number; reaped: number; processed: number; done: number; failed: number }> {
  // 1. Reap stuck PROCESSING leases back to PENDING so they can be retried.
  const reapBefore = new Date(Date.now() - LEASE_MINUTES * 60 * 1000);
  const reaped = await db
    .update(shipmentJobs)
    .set({ status: "PENDING", lockedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(shipmentJobs.status, "PROCESSING"),
        lte(shipmentJobs.lockedAt, reapBefore),
      ),
    )
    .returning({ orderId: shipmentJobs.orderId });

  // A real Shiprocket order id is all-digits. NULL or the legacy "undefined"
  // (from the old String(undefined) bug) both mean "not actually created".
  const noRealShipment = or(
    isNull(orders.shiprocketOrderId),
    eq(orders.shiprocketOrderId, "undefined"),
    eq(orders.shiprocketOrderId, ""),
  );

  // 2. Safety net: any PAID/PACKED order with no real shipment + no job → enqueue.
  const orphans = await db
    .select({ id: orders.id })
    .from(orders)
    .leftJoin(shipmentJobs, eq(shipmentJobs.orderId, orders.id))
    .where(
      and(
        inArray(orders.status, ["PAID", "PACKED"]),
        noRealShipment,
        isNull(shipmentJobs.orderId),
      ),
    )
    .limit(batchSize);

  let enqueued = 0;
  for (const o of orphans) {
    await enqueueShipmentJob(o.id);
    enqueued++;
  }

  // 2b. Heal orders whose job already finished (DONE/FAILED) but which have NO
  // real shipment + no AWB — the exact silent-loss footprint of the old bug.
  // Reset the job to PENDING so it re-creates. Forward-path code now throws on
  // a missing id (never marks DONE with "undefined"), so this only catches
  // pre-fix rows + any future regression. Belt-and-suspenders.
  //
  // Rate-limited by HEAL_COOLDOWN_MINUTES: without it this resurrects a job
  // every single cron tick, which silently defeats max_attempts. During the
  // Sep-2026 Shiprocket IP block that meant ~290 auth attempts/day per stuck
  // order against a provider that was already refusing us, plus an ops alert
  // each time it re-exhausted (2,345 OPS_ALERT rows in 4 days). Healing hourly
  // still recovers every stuck order on its own once the cause clears.
  const stuck = await db
    .update(shipmentJobs)
    .set({
      status: "PENDING",
      lockedAt: null,
      nextAttemptAt: new Date(),
      lastError: "reset: order had no valid shiprocket id",
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(shipmentJobs.status, ["DONE", "FAILED"]),
        lte(
          shipmentJobs.updatedAt,
          new Date(Date.now() - HEAL_COOLDOWN_MINUTES * 60 * 1000),
        ),
        inArray(
          shipmentJobs.orderId,
          db
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                inArray(orders.status, ["PAID", "PACKED"]),
                isNull(orders.awbCode),
                or(
                  eq(orders.shiprocketOrderId, "undefined"),
                  eq(orders.shiprocketOrderId, ""),
                  isNull(orders.shiprocketOrderId),
                ),
              ),
            ),
        ),
      ),
    )
    .returning({ orderId: shipmentJobs.orderId });
  enqueued += stuck.length;

  // 3. Claim a batch of due PENDING jobs (SKIP LOCKED so parallel cron runs
  //    never contend), flip to PROCESSING, then process outside any lock.
  const claimed = await db.execute<{
    order_id: string;
    attempts: number;
    max_attempts: number;
  }>(sql`
    WITH due AS (
      SELECT order_id FROM shipment_jobs
      WHERE status = 'PENDING' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE shipment_jobs s
      SET status = 'PROCESSING', locked_at = now(),
          attempts = s.attempts + 1, updated_at = now()
      FROM due WHERE s.order_id = due.order_id
      RETURNING s.order_id, s.attempts, s.max_attempts
  `);

  const rows = (claimed as unknown as { order_id: string; attempts: number; max_attempts: number }[]) ?? [];
  let done = 0;
  let failed = 0;
  for (const r of rows) {
    const out = await runClaimed(r.order_id, r.attempts, r.max_attempts);
    if (out.result) done++;
    else if (out.error) failed++;
  }

  return { enqueued, reaped: reaped.length, processed: rows.length, done, failed };
}

/**
 * Count permanently-FAILED shipment jobs — surfaced by the cron for alerting
 * dashboards. (Kept small + dependency-free for the cron summary.)
 */
export async function countFailedShipmentJobs(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shipmentJobs)
    .where(eq(shipmentJobs.status, "FAILED"));
  return row?.n ?? 0;
}
