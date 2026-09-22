/**
 * GET /api/orders/[id]
 *
 * Public-safe order summary for /track and the success page. Returns ONLY
 * timeline + status + items + courier — no PII beyond a masked phone.
 * Anyone with the order ID can hit this; we don't require auth because
 * order IDs are nanoid-random and effectively unguessable.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { orderEtaText } from "@/lib/serviceability";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Order IDs are random nanoids, but this is public + unauthenticated, so cap
  // per-IP to blunt ID enumeration / scraping of order contents.
  const limited = rateLimit(req, { scope: "orders:get", limit: 60 });
  if (limited) return limited;

  const { id } = await params;

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Mask phone in shippingAddress for the public response.
  const addr = order.shippingAddress as { phone?: string; pincode?: string } & Record<
    string,
    unknown
  >;
  const maskedPhone = addr?.phone
    ? `••••• ${String(addr.phone).slice(-4)}`
    : null;

  // Delivery expectation — only meaningful before it's actually delivered.
  const etaText =
    order.status !== "DELIVERED" ? orderEtaText(addr?.pincode, order) : null;

  return NextResponse.json({
    id: order.id,
    siteId: order.siteId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    items: order.items,
    totalInr: order.totalInr,
    subtotalInr: order.subtotalInr,
    shippingInr: order.shippingInr,
    codFeeInr: order.codFeeInr,
    discountInr: order.discountInr,
    courierName: order.courierName,
    trackingUrl: order.trackingUrl,
    awbCode: order.awbCode,
    // Payment receipt reference (Razorpay payment id) — lets the buyer reconcile
    // against their bank statement. Safe to expose; it's not a secret/credential.
    paymentReference: order.razorpayPaymentId ?? null,
    etaText,
    shippingCity: (addr as { city?: string })?.city ?? null,
    shippingPincode: (addr as { pincode?: string })?.pincode ?? null,
    maskedPhone,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    packedAt: order.packedAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
  });
}
