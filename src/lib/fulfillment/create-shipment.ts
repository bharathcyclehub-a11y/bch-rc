/**
 * Server-only fulfillment helper. Books an order with a courier provider
 * (Shiprocket, or Delhivery direct — src/lib/couriers) behind a single
 * in-process function so the HTTP route /api/orders/[id]/ship can be
 * admin-gated without breaking the internal post-payment trigger. Always run
 * through the shipment queue (src/lib/fulfillment/shipment-queue.ts), whose
 * atomic claim makes it the only booking in flight for an order.
 *
 * Which provider: src/lib/couriers/settings.ts decides the mode.
 *   off / shadow  Shiprocket, exactly as before (shadow also records what the
 *                 routing engine would have picked, and why)
 *   manual        Shiprocket when the engine picks it; otherwise the order is
 *                 HELD for staff to approve on the order page
 *   auto          the engine's pick; no eligible provider → HELD
 * A staff override (orders.courier_routing.override) wins over all of these.
 * An order already booked on Shiprocket stays there.
 *
 * Never a duplicate booking:
 *  - an order with a booking (shiprocket_order_id + awb_code, or a Delhivery
 *    waybill) returns the existing record (the courier has been charged);
 *  - a Delhivery attempt is recorded BEFORE the call. If its response is lost
 *    (timeout, 5xx) the next run looks the order up on Delhivery first and
 *    adopts the booking it finds — it never assumes a timeout means "failed";
 *  - when Delhivery definitively REFUSES (nothing was created) the configured
 *    fallback may book Shiprocket instead, and ops are alerted.
 *
 * Non-shippable states (PENDING / CANCELLED / FAILED / REFUNDED / ABANDONED)
 * throw NotShippableError; a deliberate wait throws ShipmentHeldError.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, events } from "@/db/schema";
import {
  asCourierProvider,
  COURIER_PROVIDER_LABEL,
  getCourierAdapter,
  hasCompletedBooking,
  isOnShiprocket,
  type CourierProvider,
} from "@/lib/couriers";
import { DelhiveryAmbiguousError, DelhiveryRejectedError } from "@/lib/couriers/delhivery";
import { evaluateRouting, type RoutingRecord } from "@/lib/couriers/routing";
import { readRoutingState, type CourierRoutingState } from "@/lib/couriers/routing-state";
import { loadCourierSettings, type CourierSettings } from "@/lib/couriers/settings";
import type { BookingInput, BookingResult } from "@/lib/couriers/types";
import { notifyOrderEvent } from "@/lib/notifications/notify";
import { alertOps } from "@/lib/alert";
import { logError } from "@/lib/logger";

type OrderItem = {
  skuId: string;
  variantSlug: string | null;
  name: string;
  image: string | null;
  unitPriceInr: number;
  qty: number;
  lineTotalInr: number;
};

type ShippingAddress = {
  fullName: string;
  phone: string;
  email?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
};

export class NotShippableError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "NotShippableError";
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

/**
 * The order is deliberately NOT booked yet — staff must choose a provider, or
 * a lost Delhivery response is waiting to be reconciled. Not a failure: the
 * queue re-checks it after `retryAfterMinutes` without spending an attempt or
 * alerting (the ops alert for a held order fires once, from here).
 */
export class ShipmentHeldError extends Error {
  constructor(
    public reason: string,
    public retryAfterMinutes: number,
  ) {
    super(`Held: ${reason}`);
    this.name = "ShipmentHeldError";
  }
}

export type ShipmentResult = {
  courierProvider: CourierProvider;
  /** Shiprocket's order id; null for a Delhivery booking. */
  shiprocketOrderId: string | null;
  shipmentId: string | null;
  awbCode: string | null;
  courierName: string | null;
  trackingUrl: string | null;
  idempotent: boolean;
};

/** Minutes after an unanswered Delhivery booking before we look it up — its
 *  order-id search lags a fresh booking, and a too-early "not found" would
 *  book the parcel twice. */
const RECONCILE_AFTER_MIN = 10;
/** How often a held order is re-evaluated (settings may have changed). */
const HELD_RECHECK_MIN = 60;

type OrderRow = typeof orders.$inferSelect;

async function saveRouting(orderId: string, state: CourierRoutingState): Promise<void> {
  await db.update(orders).set({ courierRouting: state, updatedAt: new Date() }).where(eq(orders.id, orderId));
}

async function hold(order: OrderRow, state: CourierRoutingState, reason: string, now: Date): Promise<never> {
  const alreadyAlerted = !!state.held?.alertedAt && state.held.reason === reason;
  const next: CourierRoutingState = {
    ...state,
    held: { reason, since: state.held?.since ?? now.toISOString(), alertedAt: state.held?.alertedAt ?? null },
  };
  if (!alreadyAlerted) {
    await alertOps({
      scope: "fulfillment",
      message: `${order.id} is waiting for a courier decision: ${reason}`,
      siteId: order.siteId,
      orderId: order.id,
      customerId: order.customerId,
      context: { mode: state.decision?.mode ?? null },
    });
    next.held!.alertedAt = now.toISOString();
    await db.insert(events).values({
      siteId: order.siteId,
      orderId: order.id,
      customerId: order.customerId,
      type: "SHIPMENT_HELD_FOR_STAFF",
      payload: { reason, recommended: state.decision?.recommended ?? null },
      source: "system",
    });
  }
  await saveRouting(order.id, next);
  throw new ShipmentHeldError(reason, HELD_RECHECK_MIN);
}

function eligibleIn(decision: RoutingRecord | undefined, p: CourierProvider): boolean {
  return !!decision?.eligibility.find((e) => e.provider === p)?.eligible;
}

/**
 * Delhivery refused (nothing was booked there). Returns when the configured
 * fallback lets Shiprocket book it instead (ops alerted); otherwise the order
 * is held for staff. A staff override is never switched silently.
 */
async function onDelhiveryRefused(
  order: OrderRow,
  state: CourierRoutingState,
  remark: string,
  via: string,
  settings: CourierSettings,
  now: Date,
): Promise<void> {
  await db.insert(events).values({
    siteId: order.siteId,
    orderId: order.id,
    customerId: order.customerId,
    type: "DELHIVERY_BOOKING_REFUSED",
    payload: { remark, via },
    source: "system",
  });
  const canFallBack =
    via === "routing" && settings.fallback === "other" && settings.shiprocketEnabled && eligibleIn(state.decision, "shiprocket");
  // A refused staff choice is dropped, so the hourly re-check doesn't keep
  // asking Delhivery for the same refused booking — staff choose again.
  const next = via === "override" ? { ...state, override: undefined } : state;
  if (!canFallBack) await hold(order, next, `Delhivery refused the booking: ${remark}`, now);
  await alertOps({
    scope: "fulfillment",
    message: `Delhivery refused ${order.id} (${remark}) — booked on Shiprocket instead`,
    siteId: order.siteId,
    orderId: order.id,
    customerId: order.customerId,
  });
}

/** Ask the routing engine; in shadow mode a failure must never block booking. */
async function evaluate(order: OrderRow, settings: CourierSettings, facts: Parameters<typeof evaluateRouting>[0], now: Date) {
  try {
    return await evaluateRouting(facts, settings, now);
  } catch (err) {
    logError("fulfillment:routing", err, { orderId: order.id });
    if (settings.mode === "shadow") return undefined;
    throw err;
  }
}

export async function createShipmentForOrder(orderId: string, now: Date = new Date()): Promise<ShipmentResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new OrderNotFoundError();

  // Idempotency: already booked → return the existing record. A REAL
  // Shiprocket order id is all-digits; the `/^\d+$/` guard makes sure the
  // legacy String(undefined) bug value ("undefined") is never mistaken for a
  // real shipment, so such an order is re-created instead of skipped.
  if (hasCompletedBooking(order)) {
    return {
      courierProvider: asCourierProvider(order.courierProvider),
      shiprocketOrderId: order.shiprocketOrderId,
      shipmentId: order.shiprocketShipmentId,
      awbCode: order.awbCode,
      courierName: order.courierName,
      trackingUrl: order.trackingUrl,
      idempotent: true,
    };
  }

  if (order.status === "PENDING") {
    throw new NotShippableError("Order not yet paid");
  }
  if (
    ["CANCELLED", "REFUNDED", "FAILED", "ABANDONED"].includes(order.status)
  ) {
    throw new NotShippableError(`Order in ${order.status} state`);
  }
  // Defense in depth — prepaid orders MUST have a captured payment before
  // a courier is booked. status==="PAID" is normally sufficient, but this
  // guards against any future code path that transitions status without
  // setting paymentStatus (e.g. an admin override, a bad migration). COD is
  // exempt: the order is "paid" at create time and the money arrives at
  // delivery, so paymentStatus stays "PENDING" until the COD remittance.
  if (order.paymentMethod !== "COD" && order.paymentStatus !== "CAPTURED") {
    throw new NotShippableError(
      `Prepaid order has paymentStatus=${order.paymentStatus}, expected CAPTURED`,
    );
  }

  const items = order.items as OrderItem[];
  const addr = order.shippingAddress as ShippingAddress;
  const cod = order.paymentMethod === "COD";
  // For partial-prepaid COD ("Pay X now and rest Cash on Delivery"), the
  // courier collects (totalInr − confirmationFeeInr) at the door — what's
  // actually owed after the Razorpay-captured upfront amount. Using
  // `totalInr` (not `subtotalInr`) is deliberate: the door-due amount must
  // include shipping + any CoD surcharge, otherwise PRC under-collects. For
  // pure prepaid + legacy full-CoD orders the existing `subtotalInr` invoice
  // value is preserved. Identical for every provider.
  const invoiceValueInr = cod && order.confirmationFeeInr > 0 ? order.totalInr - order.confirmationFeeInr : order.subtotalInr;
  const settings = await loadCourierSettings();
  let state = readRoutingState(order.courierRouting);

  const input: BookingInput = {
    orderId: order.id,
    orderPlacedAt: order.placedAt,
    customer: {
      name: addr.fullName,
      phone: addr.phone,
      email: addr.email,
      line1: addr.line1,
      line2: addr.line2,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
    },
    items: items.map((i) => ({
      // The snapshot `name` already reads "Pocket BMW · Blue" — the order
      // create handler resolves variant name into the line name. The
      // picker-facing label is unambiguous without the slug suffix.
      name: i.name,
      sku: i.variantSlug ? `${i.skuId}-${i.variantSlug}` : i.skuId,
      units: i.qty,
      unitPriceInr: i.unitPriceInr,
    })),
    invoiceValueInr,
    codAmountInr: cod ? invoiceValueInr : 0,
    paymentMethod: cod ? "COD" : "Prepaid",
    parcel: settings.parcel,
  };

  // 1. A Delhivery booking whose answer we never got: find out before anything else.
  if (state.booking?.provider === "delhivery" && state.booking.state === "attempting") {
    const waitedMin = (now.getTime() - new Date(state.booking.at).getTime()) / 60_000;
    if (waitedMin < RECONCILE_AFTER_MIN) {
      throw new ShipmentHeldError(
        "Delhivery hasn't confirmed an earlier booking attempt yet — checking before booking again",
        Math.max(1, Math.ceil(RECONCILE_AFTER_MIN - waitedMin)),
      );
    }
    const found = await getCourierAdapter("delhivery").findBooking(order.id); // throws → transient retry
    if (found) {
      const booking: BookingResult = {
        provider: "delhivery",
        providerOrderId: null,
        shipmentId: null,
        awb: found.awb,
        courierName: "Delhivery",
        trackingUrl: null,
        requestId: state.booking.requestId ?? null,
      };
      return saveBooking(order, booking, state, now, "reconciled");
    }
    const attempt = state.booking;
    state = { ...state, booking: { ...attempt, state: "not_found", at: now.toISOString() } };
    await saveRouting(order.id, state);
    // Delhivery had given a reason ("insufficient balance… might have been
    // partially saved"): now that nothing was saved, it was a refusal.
    if (attempt.remark) {
      await onDelhiveryRefused(order, state, attempt.remark, attempt.via ?? "routing", settings, now);
      const booking = await getCourierAdapter("shiprocket").book(input);
      return saveBooking(order, booking, state, now, attempt.via ?? "routing");
    }
  }

  // 2. Which provider.
  const facts = {
    pincode: addr.pincode,
    paymentMethod: input.paymentMethod,
    orderValueInr: order.totalInr,
    codAmountInr: input.codAmountInr,
  };
  let provider: CourierProvider;
  let via: "existing" | "override" | "routing";
  if (isOnShiprocket(order)) {
    // Never move an existing booking implicitly — staff do that from the order page.
    provider = "shiprocket";
    via = "existing";
  } else if (state.override) {
    provider = state.override.provider;
    via = "override";
    if (provider === "delhivery" && !settings.delhiveryEnabled) {
      return hold(order, state, "staff chose Delhivery but Delhivery booking is switched off in settings", now);
    }
  } else {
    via = "routing";
    if (settings.mode === "off") {
      provider = "shiprocket";
    } else {
      const decision = await evaluate(order, settings, facts, now);
      state = { ...state, decision };
      if (settings.mode === "shadow") {
        provider = "shiprocket";
      } else if (!decision?.recommended) {
        return hold(order, state, decision?.reason ?? "routing could not decide", now);
      } else if (settings.mode === "manual" && decision.recommended !== "shiprocket") {
        return hold(order, state, `${COURIER_PROVIDER_LABEL[decision.recommended]} recommended — ${decision.reason}`, now);
      } else {
        provider = decision.recommended;
      }
    }
  }

  // 3. Book.
  if (provider === "delhivery") {
    state = { ...state, booking: { provider: "delhivery", state: "attempting", at: now.toISOString(), via } };
    await saveRouting(order.id, state);
    try {
      const booking = await getCourierAdapter("delhivery").book(input);
      return saveBooking(order, booking, state, now, via);
    } catch (err) {
      if (err instanceof DelhiveryAmbiguousError) {
        // It may exist anyway: keep "attempting" (+ the reason) — the next
        // run looks it up before booking anything.
        await saveRouting(order.id, { ...state, booking: { ...state.booking!, remark: err.remark } });
        throw err;
      }
      if (!(err instanceof DelhiveryRejectedError)) throw err; // timeout / 5xx → reconciled next run
      state = { ...state, booking: { provider: "delhivery", state: "refused", at: now.toISOString(), remark: err.remark, via } };
      await onDelhiveryRefused(order, state, err.remark, via, settings, now);
      provider = "shiprocket";
    }
  }

  if (via === "override" && provider === "shiprocket" && !settings.shiprocketEnabled) {
    return hold(order, state, "staff chose Shiprocket but Shiprocket booking is switched off in settings", now);
  }
  const booking = await getCourierAdapter("shiprocket").book(input);
  return saveBooking(order, booking, state, now, via);
}

async function saveBooking(
  order: OrderRow,
  b: BookingResult,
  state: CourierRoutingState,
  now: Date,
  via: string,
): Promise<ShipmentResult> {
  const awb = b.awb?.trim() || null;
  const quote = state.decision?.assessments.find((a) => a.provider === b.provider)?.quote ?? null;
  const trackingUrl =
    b.trackingUrl ?? (awb && b.provider === "delhivery" ? `https://www.delhivery.com/track-v2/package/${encodeURIComponent(awb)}` : null);
  const nextState: CourierRoutingState = {
    ...state,
    held: undefined,
    booking: { provider: b.provider, state: "booked", at: now.toISOString(), requestId: b.requestId },
  };

  await db
    .update(orders)
    .set({
      courierProvider: b.provider,
      shiprocketOrderId: b.providerOrderId,
      shiprocketShipmentId: b.shipmentId,
      awbCode: awb,
      // Shiprocket's create response sends courier_name: "" for manual-AWB
      // orders — store NULL, not "", so `?? fallback` renders and IS NULL
      // audits work. The sync cron backfills the real courier later.
      courierName: (b.courierName ?? "").trim() || null,
      trackingUrl,
      courierRouting: nextState,
      courierQuotedPaise: quote?.totalPaise ?? null,
      status: awb ? "PACKED" : order.status,
      packedAt: awb ? now : order.packedAt,
      updatedAt: now,
    })
    .where(eq(orders.id, order.id));

  await db.insert(events).values({
    siteId: order.siteId,
    orderId: order.id,
    customerId: order.customerId,
    type: awb ? "SHIPMENT_CREATED" : "SHIPMENT_PENDING_AWB",
    payload: {
      courierProvider: b.provider,
      via,
      shiprocketOrderId: b.providerOrderId,
      shipmentId: b.shipmentId,
      awbCode: awb,
      courierName: b.courierName,
      requestId: b.requestId,
      routing: state.decision
        ? { mode: state.decision.mode, recommended: state.decision.recommended, reason: state.decision.reason }
        : null,
    },
    source: "system",
  });

  // Notify the customer their order has shipped — only once an AWB exists so
  // the email/WhatsApp carries a real tracking number. Idempotent: the early
  // return above means a re-run for an already-shipped order never gets here.
  if (awb) {
    await notifyOrderEvent(order.id, "SHIPMENT_CREATED");
  }

  return {
    courierProvider: b.provider,
    shiprocketOrderId: b.providerOrderId,
    shipmentId: b.shipmentId,
    awbCode: awb,
    courierName: b.courierName,
    trackingUrl,
    idempotent: false,
  };
}

/**
 * Fire-and-forget wrapper for the post-payment auto-trigger. Errors are
 * persisted to the events table and swallowed — admin retry path via
 * /api/orders/[id]/ship handles recovery.
 */
export async function triggerShipmentBackground(orderId: string): Promise<void> {
  try {
    await createShipmentForOrder(orderId);
  } catch (err) {
    logError("fulfillment:auto-trigger", err, { orderId });
    // Persist failure so admin can see it without trawling Vercel logs.
    try {
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (order) {
        await db.insert(events).values({
          siteId: order.siteId,
          orderId,
          customerId: order.customerId,
          type: "SHIPMENT_AUTO_TRIGGER_FAILED",
          payload: { error: err instanceof Error ? err.message : String(err) },
          source: "system",
        });
      }
    } catch (eventErr) {
      logError("fulfillment:event-log", eventErr, { orderId });
    }
  }
}
