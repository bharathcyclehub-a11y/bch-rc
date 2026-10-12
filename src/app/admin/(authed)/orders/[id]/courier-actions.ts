"use server";

/**
 * Courier actions on the admin order page (src/lib/couriers).
 *
 *   recheckCourierRoutingAction   re-run the routing engine now (read-only on
 *                                 the couriers) and show the fresh verdict
 *   bookWithProviderAction        staff choose the provider BEFORE an AWB
 *                                 exists. Moving a Shiprocket order (no AWB,
 *                                 so no courier yet) cancels it on Shiprocket
 *                                 first and stops if that cancel fails — a
 *                                 second live booking is never created. The
 *                                 booking itself runs through the shipment
 *                                 queue, whose claim keeps it single.
 *   courierLabelAction            fresh label link from the order's provider
 *   recordCourierBilledAction     the amount the provider actually billed
 *                                 (from its invoice), kept apart from quotes
 *
 * Every action re-checks the role and the order's site; every change writes
 * an audit event.
 */

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, shipmentJobs, shipmentTracking } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import {
  asCourierProvider,
  COURIER_PROVIDER_LABEL,
  COURIER_PROVIDERS,
  getCourierAdapter,
  isOnShiprocket,
  shipmentRefOf,
  type CourierProvider,
} from "@/lib/couriers";
import { evaluateRouting } from "@/lib/couriers/routing";
import { readRoutingState } from "@/lib/couriers/routing-state";
import { loadCourierSettings } from "@/lib/couriers/settings";
import { enqueueShipmentJob, runShipmentJobOnce } from "@/lib/fulfillment/shipment-queue";
import { logError } from "@/lib/logger";

export type CourierActionResult = { ok: true; message: string; url?: string } | { ok: false; error: string };

const no = (error: string): CourierActionResult => ({ ok: false, error });

type OrderRow = typeof orders.$inferSelect;

async function loadOrder(orderId: string, permission: "shipping.book" | "shipping.costs") {
  const ctx = await requireAdmin();
  if (!can(ctx.role, permission)) return { error: "Your role can't do this." } as const;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { error: "Order not found." } as const;
  if (!ctx.siteIds.includes(order.siteId)) return { error: "Forbidden." } as const;
  return { ctx, order } as const;
}

function facts(order: OrderRow) {
  const addr = order.shippingAddress as { pincode?: string };
  const cod = order.paymentMethod === "COD";
  const invoiceValueInr = cod && order.confirmationFeeInr > 0 ? order.totalInr - order.confirmationFeeInr : order.subtotalInr;
  return {
    pincode: String(addr.pincode ?? ""),
    paymentMethod: (cod ? "COD" : "Prepaid") as "COD" | "Prepaid",
    orderValueInr: order.totalInr,
    codAmountInr: cod ? invoiceValueInr : 0,
  };
}

function revalidate(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/pack");
}

export async function recheckCourierRoutingAction(orderId: string): Promise<CourierActionResult> {
  const r = await loadOrder(orderId, "shipping.book");
  if ("error" in r) return no(r.error!);
  const { order } = r;
  try {
    const settings = await loadCourierSettings();
    const check = await evaluateRouting(facts(order), settings);
    const state = readRoutingState(order.courierRouting);
    await db
      .update(orders)
      .set({ courierRouting: { ...state, recheck: check }, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    revalidate(orderId);
    const pick = check.recommended ? COURIER_PROVIDER_LABEL[check.recommended] : "staff review";
    return { ok: true, message: `${pick}: ${check.reason}` };
  } catch (err) {
    logError("admin:courier-recheck", err, { orderId });
    return no("Couldn't reach the couriers — try again.");
  }
}

export async function bookWithProviderAction(orderId: string, provider: string): Promise<CourierActionResult> {
  if (!(COURIER_PROVIDERS as readonly string[]).includes(provider)) return no("Unknown courier provider.");
  const target = provider as CourierProvider;
  const r = await loadOrder(orderId, "shipping.book");
  if ("error" in r) return no(r.error!);
  const { ctx, order } = r;
  const label = COURIER_PROVIDER_LABEL[target];

  if (order.status !== "PAID" && order.status !== "PACKED") return no(`Order is ${order.status} — it can't be booked.`);
  if (order.awbCode) {
    return no(
      "This order already has an AWB. To change courier, cancel that booking first (from /pack) — a second shipment is never created next to a live one.",
    );
  }
  const settings = await loadCourierSettings();
  if (settings.mode === "off") return no("Courier routing is off in settings — orders book on Shiprocket as before.");
  if (target === "delhivery" && !settings.delhiveryEnabled) return no("Delhivery booking is switched off in settings.");
  if (target === "shiprocket" && !settings.shiprocketEnabled) return no("Shiprocket booking is switched off in settings.");
  if (target === "shiprocket" && isOnShiprocket(order)) {
    return no("Already booked on Shiprocket — pick its courier in the Shiprocket dashboard.");
  }

  const [job] = await db.select({ status: shipmentJobs.status }).from(shipmentJobs).where(eq(shipmentJobs.orderId, orderId));
  if (job?.status === "PROCESSING") return no("A booking for this order is running right now — try again in a minute.");

  // Eligible right now? Cost policy (cap / cheaper-only) doesn't bind a staff choice.
  const now = new Date();
  let check;
  try {
    check = await evaluateRouting(facts(order), { ...settings, mode: "manual", maxRateInr: null, requireCheaper: false }, now);
  } catch (err) {
    logError("admin:courier-book-check", err, { orderId });
    return no("Couldn't reach the couriers to confirm eligibility — try again.");
  }
  const e = check.eligibility.find((x) => x.provider === target);
  if (!e?.eligible) return no(`${label} can't take this order: ${e?.reason ?? "not eligible"}.`);

  let state = readRoutingState(order.courierRouting);
  if (isOnShiprocket(order)) {
    const cancelled = await getCourierAdapter("shiprocket").cancel(shipmentRefOf(order));
    if (!cancelled.ok) {
      return no(`Couldn't cancel Shiprocket order ${order.shiprocketOrderId}: ${cancelled.message}. Nothing was changed.`);
    }
    state = {
      ...state,
      history: [
        ...(state.history ?? []),
        { at: now.toISOString(), by: ctx.email, detail: `Cancelled Shiprocket order ${order.shiprocketOrderId} (no AWB) to book ${label}` },
      ],
    };
    await db
      .update(orders)
      .set({ shiprocketOrderId: null, shiprocketShipmentId: null, updatedAt: now })
      .where(eq(orders.id, orderId));
    // The tracking row followed the Shiprocket shipment; point it at the new
    // provider so the worker doesn't poll a cancelled Shiprocket booking.
    await db
      .update(shipmentTracking)
      .set({ shiprocketShipmentId: null, courierProvider: target, status: "AWAITING_AWB", updatedAt: now })
      .where(and(eq(shipmentTracking.orderId, orderId), eq(shipmentTracking.kind, "FORWARD")));
    await db.insert(events).values({
      siteId: order.siteId,
      orderId,
      customerId: order.customerId,
      type: "COURIER_PROVIDER_SWITCHED",
      payload: { from: "shiprocket", to: target, shiprocketOrderId: order.shiprocketOrderId, by: ctx.email },
      source: "operator",
    });
  }

  state = { ...state, override: { provider: target, by: ctx.email, at: now.toISOString() }, recheck: check, held: undefined };
  await db.update(orders).set({ courierRouting: state, updatedAt: now }).where(eq(orders.id, orderId));
  await db.insert(events).values({
    siteId: order.siteId,
    orderId,
    customerId: order.customerId,
    type: "STAFF_COURIER_OVERRIDE",
    payload: { provider: target, recommended: check.recommended, by: ctx.email },
    source: "operator",
  });

  // Re-arm the job and run it now. The queue's atomic claim makes this the
  // only booking in flight, whoever (cron, heal, this click) gets there first.
  await enqueueShipmentJob(orderId);
  await db
    .update(shipmentJobs)
    .set({ status: "PENDING", attempts: 0, nextAttemptAt: now, lockedAt: null, lastError: `staff chose ${target}`, updatedAt: now })
    .where(and(eq(shipmentJobs.orderId, orderId), inArray(shipmentJobs.status, ["PENDING", "DONE", "FAILED"])));
  const res = await runShipmentJobOnce(orderId);
  revalidate(orderId);
  if (res.error) return no(res.error);
  if (!res.ran) return { ok: true, message: `Queued for ${label} — refresh in a moment.` };
  return { ok: true, message: res.result?.awbCode ? `Booked on ${label} — AWB ${res.result.awbCode}` : `Booked on ${label}` };
}

export async function courierLabelAction(orderId: string): Promise<CourierActionResult> {
  const r = await loadOrder(orderId, "shipping.book");
  if ("error" in r) return no(r.error!);
  const { order } = r;
  const provider = asCourierProvider(order.courierProvider);
  const ref = shipmentRefOf(order);
  if (provider === "delhivery" ? !ref.awb : !ref.shipmentId) return no("No AWB yet — nothing to print.");
  try {
    const { url } = await getCourierAdapter(provider).label(ref);
    return url ? { ok: true, message: "Label ready", url } : no(`${COURIER_PROVIDER_LABEL[provider]} didn't return a label — try again.`);
  } catch (err) {
    logError("admin:courier-label", err, { orderId });
    return no("Label generation failed — try again.");
  }
}

export async function recordCourierBilledAction(orderId: string, amountInr: number): Promise<CourierActionResult> {
  const r = await loadOrder(orderId, "shipping.costs");
  if ("error" in r) return no(r.error!);
  const { ctx, order } = r;
  if (!Number.isFinite(amountInr) || amountInr <= 0 || amountInr > 10_000) return no("Enter the billed amount in ₹ (0–10,000).");
  const paise = Math.round(amountInr * 100);
  await db.update(orders).set({ courierBilledPaise: paise, updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.insert(events).values({
    siteId: order.siteId,
    orderId,
    customerId: order.customerId,
    type: "COURIER_COST_RECORDED",
    payload: { provider: order.courierProvider, billedPaise: paise, previousPaise: order.courierBilledPaise, by: ctx.email },
    source: "operator",
  });
  revalidate(orderId);
  return { ok: true, message: `Billed cost saved: ₹${amountInr.toFixed(2)}` };
}
