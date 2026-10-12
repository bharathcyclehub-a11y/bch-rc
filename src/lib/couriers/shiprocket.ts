/**
 * Shiprocket adapter — the existing client (src/lib/shiprocket.ts) behind the
 * courier interface, behaviour unchanged:
 *   - a booking creates the Shiprocket order WITHOUT a courier; staff pick the
 *     courier and the AWB arrives later by webhook/poll (awbOnBooking: false);
 *   - label, manifest and pickup take Shiprocket shipment ids; cancel takes
 *     Shiprocket's order id.
 *
 * Quotes: the price of the courier staff would most likely pick — the cheapest
 * SURFACE option when one exists (air only where surface is unavailable), as
 * getCheapestSurfaceCourierId has always done — or the cheapest of all when
 * `shiprocketSurfacePreferred` is off. Shiprocket's `rate` is freight + COD +
 * other charges, and is what it bills (billed freight equals the quote). The
 * API doesn't say whether GST is on top, so the quote is "partial" (never
 * decides on cost) until ops set `shiprocketRatesGst`: "included" makes it a
 * full quote as-is, "excluded" adds 18% GST first.
 */

import {
  cancelShiprocketOrder,
  createShipment,
  fetchShiprocketTracking,
  generateManifest,
  generateShippingLabel,
  getShiprocketCourierOptions,
  getShiprocketServiceability,
  schedulePickup,
} from "@/lib/shiprocket";
import { parseShiprocketTracking } from "@/lib/tracking/carrier";
import { loadCourierSettings } from "./settings";
import {
  CourierUnsupportedError,
  type CourierAdapter,
  type CourierQuote,
  type ShipmentRef,
} from "./types";
import { envStr } from "@/lib/env";

const paise = (inr: unknown): number | null => {
  const n = Number(inr);
  return Number.isFinite(n) && inr !== null && inr !== undefined ? Math.round(n * 100) : null;
};

function shipmentIds(refs: ShipmentRef[]): string[] {
  return refs.map((r) => r.shipmentId).filter((id): id is string => !!id && /^\d+$/.test(id));
}

export const shiprocketAdapter: CourierAdapter = {
  provider: "shiprocket",
  capabilities: {
    serviceability: true,
    rateQuote: true,
    awbOnBooking: false,
    findBooking: false,
    label: true,
    manifest: true,
    pickup: true,
    tracking: true,
    cancel: true,
    webhook: true,
  },

  isConfigured() {
    return !!envStr("SHIPROCKET_EMAIL") && !!envStr("SHIPROCKET_PASSWORD") && !!envStr("SHIPROCKET_PICKUP_LOCATION");
  },

  async serviceability(pincode) {
    const s = await getShiprocketServiceability(pincode, false);
    return s ? { serviceable: s.serviceable, codAvailable: s.codAvailable } : null;
  },

  async quote(q): Promise<CourierQuote | null> {
    const settings = await loadCourierSettings();
    const options = (
      await getShiprocketCourierOptions({
        originPincode: q.originPincode,
        deliveryPincode: q.pincode,
        weightKg: q.parcel.weightGrams / 1000,
        cod: q.cod,
        declaredValueInr: q.declaredValueInr,
      })
    ).filter((c) => Number.isFinite(Number(c.rate)) && !c.blocked && (!q.cod || c.cod === 1));
    if (options.length === 0) return null;
    const isSurface = (c: (typeof options)[number]) =>
      c.is_surface === true || c.is_surface === 1 || !/air/i.test(c.courier_name ?? "air");
    const surface = options.filter(isSurface);
    const pool = settings.shiprocketSurfacePreferred && surface.length > 0 ? surface : options;
    const pick = [...pool].sort((a, b) => Number(a.rate) - Number(b.rate))[0];
    const other = (paise(pick.coverage_charges) ?? 0) + (paise(pick.other_charges) ?? 0);
    const rate = paise(pick.rate)!;
    const gst = settings.shiprocketRatesGst;
    const total = gst === "excluded" ? Math.round(rate * 1.18) : rate;
    return {
      provider: "shiprocket",
      totalPaise: total,
      taxIncluded: gst === "unknown" ? null : true,
      confidence: gst === "unknown" ? "partial" : "full",
      components: {
        freightPaise: paise(pick.freight_charge),
        codPaise: paise(pick.cod_charges),
        fuelPaise: null,
        remoteAreaPaise: null,
        otherPaise: other || null,
        taxPaise: gst === "excluded" ? total - rate : null,
      },
      courierName: pick.courier_name?.trim() || null,
      mode: isSurface(pick) ? "surface" : "air",
      chargedWeightGrams: Number.isFinite(Number(pick.charge_weight)) ? Math.round(Number(pick.charge_weight) * 1000) : null,
      zone: pick.zone ?? null,
      source: "shiprocket:serviceability",
      quotedAt: new Date().toISOString(),
    };
  },

  async book(input) {
    const r = await createShipment({
      orderId: input.orderId,
      orderPlacedAt: input.orderPlacedAt,
      // Courier auto-assignment is OFF for EVERY order (both stores). The order is
      // created on Shiprocket automatically, but the operator selects the courier
      // and schedules pickup MANUALLY in the Shiprocket dashboard. Our
      // sync-shipments cron + courier webhook pull the AWB/tracking back once it's
      // assigned, so the customer still gets a tracking notification after.
      autoAssignAwb: false,
      customer: input.customer,
      items: input.items.map((i) => ({ name: i.name, sku: i.sku, units: i.units, selling_price: i.unitPriceInr })),
      subtotalInr: input.invoiceValueInr,
      paymentMethod: input.paymentMethod,
    });
    return {
      provider: "shiprocket",
      providerOrderId: r.shiprocketOrderId,
      shipmentId: r.shipmentId,
      awb: r.awbCode,
      courierName: r.courierName,
      trackingUrl: r.trackingUrl,
      requestId: null,
    };
  },

  async findBooking() {
    throw new CourierUnsupportedError("shiprocket", "booking lookup by order id");
  },

  async label(ref) {
    if (!ref.shipmentId) return { url: null };
    const { labelUrl } = await generateShippingLabel([ref.shipmentId]);
    return { url: labelUrl };
  },

  async manifest(refs) {
    const ids = shipmentIds(refs);
    if (ids.length === 0) return { url: null };
    const { manifestUrl } = await generateManifest(ids);
    return { url: manifestUrl };
  },

  async schedulePickup(refs) {
    const ids = shipmentIds(refs);
    if (ids.length === 0) {
      return { ok: false, scheduledFor: null, pickupId: null, alreadyScheduled: false, message: "no Shiprocket shipments" };
    }
    const r = await schedulePickup(ids);
    // Shiprocket returns "Invalid Status" when pickup is already scheduled
    // (premium couriers like Blue Dart Air auto-schedule). Treat that as a soft
    // success — the pickup IS scheduled, just not by us.
    const alreadyScheduled = !r.ok && /invalid status|already/i.test(r.message);
    return {
      ok: r.ok || alreadyScheduled,
      scheduledFor: r.pickupScheduledDate,
      pickupId: null,
      alreadyScheduled,
      message: r.message,
    };
  },

  async cancel(ref) {
    if (!ref.providerOrderId) return { ok: false, message: "no Shiprocket order id" };
    return cancelShiprocketOrder(ref.providerOrderId);
  },

  async track(ref) {
    const body = await fetchShiprocketTracking({ awb: ref.awb, shipmentId: ref.shipmentId });
    const snap = parseShiprocketTracking(body);
    if (!snap) throw new Error(`Unrecognised tracking response: ${JSON.stringify(body).slice(0, 160)}`);
    return snap;
  },
};
