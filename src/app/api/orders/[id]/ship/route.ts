/**
 * POST /api/orders/[id]/ship  (ADMIN ONLY)
 *
 * Manual admin retry of courier shipment creation. Routes through the same
 * durable job queue as the auto-trigger, so an admin clicking "retry" can never
 * race the post-payment path into a duplicate shipment — both contend for the
 * single job row and exactly one wins the atomic claim. The queue books on the
 * provider the routing engine picks (src/lib/couriers/routing.ts).
 *
 * Idempotent: if the order already has a booking (a Shiprocket order id or a
 * Delhivery waybill), or the job is already DONE, we return the existing record
 * without recreating.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { asCourierProvider, courierBookingRef } from "@/lib/couriers";
import { runShipmentJobOnce } from "@/lib/fulfillment/shipment-queue";
import { logError } from "@/lib/logger";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin();
  const { id } = await params;

  // Site authorization: confirm this admin can act on this order's site.
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!ctx.siteIds.includes(order.siteId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const out = await runShipmentJobOnce(id);

    if (out.result) {
      return NextResponse.json({ ok: true, ...out.result });
    }

    // Job already claimed/finished by another worker (the auto-trigger).
    // Re-read the order; if a booking exists, return it idempotently.
    if (!out.ran || out.alreadyDone) {
      const [fresh] = await db.select().from(orders).where(eq(orders.id, id));
      if (fresh && courierBookingRef(fresh)) {
        return NextResponse.json({
          ok: true,
          idempotent: true,
          courierProvider: asCourierProvider(fresh.courierProvider),
          shiprocketOrderId: fresh.shiprocketOrderId,
          shipmentId: fresh.shiprocketShipmentId,
          awbCode: fresh.awbCode,
          courierName: fresh.courierName,
          trackingUrl: fresh.trackingUrl,
        });
      }
      return NextResponse.json(
        { ok: true, pending: true, message: "Shipment is being processed — refresh shortly." },
        { status: 202 },
      );
    }

    // The job ran but failed (transient or permanent). Surface the reason; the
    // queue has already scheduled a retry (or parked + alerted on exhaustion).
    return NextResponse.json(
      { error: out.error ?? "Shipment creation failed", retrying: true },
      { status: 422 },
    );
  } catch (err) {
    logError("ship:route", err, { orderId: id, adminEmail: ctx.email });
    return NextResponse.json(
      { error: "Shipment creation failed" },
      { status: 500 },
    );
  }
}
