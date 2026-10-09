"use server";

/**
 * Shipment-exception server actions — shared by /admin/support/exceptions and
 * the order detail tracking panel.
 *
 * Every action re-checks its permission here (hiding a button is never the
 * control) and scopes the row to the operator's sites:
 *   resyncAllDue        tracking.resync    one bounded worker pass (ADMIN_BULK)
 *   resyncShipment      tracking.resync    poll one shipment now
 *   acknowledgeException exceptions.manage OPEN → ACKNOWLEDGED
 *   resolveException    exceptions.manage  → RESOLVED, with a required note
 *
 * The tracking tables come from a manual migration; a missing table returns a
 * setup message instead of a 500.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveryExceptions, orders, shipmentTracking } from "@/db/schema";
import { requireAdmin, type AdminContext } from "@/lib/admin-auth";
import { can, type AdminPermission } from "@/lib/admin/permissions";
import { logError } from "@/lib/logger";
import { acknowledgeExceptionRow, resolveExceptionRow } from "@/lib/tracking/exceptions";
import { CUSTOMER_STATUS_LABEL, isTrackingStatus } from "@/lib/tracking/status";
import { ensureForwardTracking, runTrackingSync, syncTrackingNow, type SyncSummary } from "@/lib/tracking/sync";

export type ExceptionActionResult =
  | { ok: true; message: string; partial?: boolean }
  | { ok: false; error: string };

const LIST_PATH = "/admin/support/exceptions";
const MAX_RESOLUTION = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_MIGRATED =
  "Shipment tracking isn't set up yet — apply src/db/migrations/manual/2026-10-09_shipment_tracking.sql.";

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

function failure(scope: string, err: unknown, fallback: string): ExceptionActionResult {
  const code = pgCode(err);
  if (code === "42P01" || code === "42703") return { ok: false, error: NOT_MIGRATED };
  logError(scope, err);
  return { ok: false, error: fallback };
}

async function authorize(permission: AdminPermission): Promise<AdminContext | null> {
  const ctx = await requireAdmin();
  return can(ctx.role, permission) ? ctx : null;
}

function revalidate(orderId?: string) {
  revalidatePath(LIST_PATH);
  if (orderId) revalidatePath(`/admin/orders/${orderId}`);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summaryText(s: SyncSummary): { message: string; partial: boolean } {
  const parts = [`${plural(s.claimed, "due shipment")} checked`];
  if (s.changed) parts.push(`${s.changed} updated`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.exceptionsOpened) parts.push(plural(s.exceptionsOpened, "new exception"));
  if (s.bootstrapped) parts.push(`${s.bootstrapped} newly tracked`);
  const message = parts.join(" · ");
  return s.skippedReason
    ? { message: `${message}. Courier not polled: ${s.skippedReason}`, partial: true }
    : { message, partial: s.failed > 0 };
}

/** One bounded worker pass over shipments that are due (same leases as cron). */
export async function resyncAllDue(): Promise<ExceptionActionResult> {
  const ctx = await authorize("tracking.resync");
  if (!ctx) return { ok: false, error: "You don't have permission to resync tracking." };
  try {
    const summary = await runTrackingSync({ trigger: "ADMIN_BULK", limit: 40 });
    revalidate();
    return { ok: true, ...summaryText(summary) };
  } catch (err) {
    return failure("admin:tracking-resync-all", err, "Couldn't run the tracking sync — try again.");
  }
}

/**
 * Poll one shipment now. With a trackingId it syncs that row (a RETURN or
 * REPLACEMENT shipment); without one it makes sure the order's FORWARD row
 * exists first.
 */
export async function resyncShipment(input: {
  orderId: string;
  trackingId?: string | null;
}): Promise<ExceptionActionResult> {
  const ctx = await authorize("tracking.resync");
  if (!ctx) return { ok: false, error: "You don't have permission to resync tracking." };
  const orderId = typeof input?.orderId === "string" ? input.orderId.trim() : "";
  if (!orderId || orderId.length > 64) return { ok: false, error: "Order not found." };

  try {
    const [order] = await db
      .select({ id: orders.id, siteId: orders.siteId })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order || !ctx.siteIds.includes(order.siteId)) return { ok: false, error: "Order not found." };

    let trackingId: string;
    if (input.trackingId) {
      if (!UUID.test(input.trackingId)) return { ok: false, error: "Shipment not found." };
      const [row] = await db
        .select({ id: shipmentTracking.id })
        .from(shipmentTracking)
        .where(and(eq(shipmentTracking.id, input.trackingId), eq(shipmentTracking.orderId, orderId)));
      if (!row) return { ok: false, error: "Shipment not found." };
      trackingId = row.id;
    } else {
      const row = await ensureForwardTracking(orderId);
      if (!row) return { ok: false, error: "No courier shipment yet — create the shipment first." };
      trackingId = row.id;
    }

    const r = await syncTrackingNow(trackingId);
    revalidate(orderId);
    if (!r.ok) return { ok: false, error: r.error };
    const label = isTrackingStatus(r.status) ? CUSTOMER_STATUS_LABEL[r.status] : r.status;
    return {
      ok: true,
      message: r.changed
        ? `Updated: ${label}${r.newEvents ? ` · ${plural(r.newEvents, "new courier scan")}` : ""}.`
        : `Checked: no new courier updates (${label}).`,
    };
  } catch (err) {
    return failure("admin:tracking-resync", err, "Couldn't reach courier tracking — try again.");
  }
}

async function loadException(id: string, ctx: AdminContext) {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const [row] = await db
    .select({
      id: deliveryExceptions.id,
      siteId: deliveryExceptions.siteId,
      orderId: deliveryExceptions.orderId,
      status: deliveryExceptions.status,
    })
    .from(deliveryExceptions)
    .where(eq(deliveryExceptions.id, id));
  return row && ctx.siteIds.includes(row.siteId) ? row : null;
}

export async function acknowledgeException(id: string): Promise<ExceptionActionResult> {
  const ctx = await authorize("exceptions.manage");
  if (!ctx) return { ok: false, error: "You don't have permission to manage exceptions." };
  try {
    const row = await loadException(id, ctx);
    if (!row) return { ok: false, error: "Exception not found." };
    if (row.status !== "OPEN") return { ok: false, error: `This exception is already ${row.status.toLowerCase()}.` };
    await acknowledgeExceptionRow(row.id, ctx.email);
    revalidate(row.orderId);
    return { ok: true, message: "Exception acknowledged." };
  } catch (err) {
    return failure("admin:exception-ack", err, "Couldn't acknowledge the exception — try again.");
  }
}

export async function resolveException(id: string, resolution: string): Promise<ExceptionActionResult> {
  const ctx = await authorize("exceptions.manage");
  if (!ctx) return { ok: false, error: "You don't have permission to manage exceptions." };
  const note = (typeof resolution === "string" ? resolution : "").trim().slice(0, MAX_RESOLUTION);
  if (note.length < 3) return { ok: false, error: "Add a short note saying how it was resolved." };
  try {
    const row = await loadException(id, ctx);
    if (!row) return { ok: false, error: "Exception not found." };
    if (row.status === "RESOLVED") return { ok: false, error: "This exception is already resolved." };
    await resolveExceptionRow(row.id, ctx.email, note);
    revalidate(row.orderId);
    return { ok: true, message: "Exception resolved." };
  } catch (err) {
    return failure("admin:exception-resolve", err, "Couldn't resolve the exception — try again.");
  }
}
