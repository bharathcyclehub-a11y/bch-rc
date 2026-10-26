/**
 * POST /api/admin/orders/create
 *
 * Admin-only manual-order creation. Mirrors the safety properties of the
 * customer self-service flow at /api/orders/create with these differences:
 *
 *   • Auth via requireAdmin() — only signed-in admins reach this.
 *   • No coupon. Instead an optional discountPct (0–50) the operator applies
 *     when honouring a "you-called-direct" off-website discount (Sandeep's
 *     2026-06-05 voice 2 ask).
 *   • Payment is ALWAYS Razorpay Payment Link (no COD path here — call the
 *     /cod queue tools for that). Razorpay auto-sends SMS to the customer
 *     on link creation.
 *   • Order row is flagged created_via='ADMIN_MANUAL' + created_by_email
 *     so per-operator sales attribution works in the admin dashboard.
 *
 * Webhook `payment_link.paid` flips the order PAID and the same downstream
 * (Shiprocket shipment + ORDER_CONFIRMED email) runs unchanged.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  customers,
  addresses,
  orders,
  events,
  inventory,
} from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { PRODUCTS } from "@/lib/products";
import { INVENTORY_SITE_ID } from "@/lib/inventory";
import { OFFERS } from "@/lib/config";
import { THEME } from "@/lib/theme";
import { createPaymentLink } from "@/lib/razorpay";
import { generateOrderId } from "@/lib/order-id";
import { requireAdmin } from "@/lib/admin-auth";
import { logError } from "@/lib/logger";

const ItemInput = z.object({
  skuId: z.string().min(1).max(80),
  variantSlug: z.string().max(40).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  qty: z.number().int().positive().max(20),
});

const CustomerInput = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().regex(/^[0-9]{10}$/, "10-digit phone required"),
  email: z.string().email("Valid email required").max(160).optional().or(z.literal("")),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, "6-digit pincode required"),
});

const BodySchema = z.object({
  siteId: z.string().min(1).max(40).default("prc"),
  items: z.array(ItemInput).min(1).max(20),
  customer: CustomerInput,
  /** Custom discount percentage (0–50). Set by the operator when honouring a
   *  direct-call discount. Applied to subtotal AFTER shipping/COD-fee but
   *  before the Razorpay link is created. */
  discountPct: z.number().min(0).max(50).default(0),
  /** Free-text note the admin can drop on the order — e.g. "Customer
   *  WhatsApp'd, prefers blue, call before delivery". Visible in admin only. */
  notes: z.string().max(500).optional().or(z.literal("")),
});

const PAYMENT_LINK_EXPIRY_HOURS = 48;

type OrderItemSnapshot = {
  skuId: string;
  variantSlug: string | null;
  name: string;
  image: string | null;
  unitPriceInr: number;
  qty: number;
  lineTotalInr: number;
};

export async function POST(req: Request) {
  const ctx = await requireAdmin();

  // Site-access guard. Owners get every site; managers + support only the
  // sites they're scoped to. Bail before we touch anything.
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "INVALID_BODY",
        details: err instanceof z.ZodError ? err.issues : String(err),
      },
      { status: 400 },
    );
  }
  if (!ctx.siteIds.includes(body.siteId)) {
    return NextResponse.json({ error: "FORBIDDEN_SITE" }, { status: 403 });
  }

  // ── 1. Validate cart against catalog + compute line totals ──────
  let subtotal = 0;
  const lineItems: OrderItemSnapshot[] = [];
  for (const item of body.items) {
    const sku = PRODUCTS.find((p) => p.id === item.skuId);
    if (!sku) {
      return NextResponse.json(
        { error: `Unknown SKU: ${item.skuId}` },
        { status: 400 },
      );
    }
    let variantName: string | null = null;
    let variantImage: string | null = null;
    if (sku.colors?.length) {
      if (!item.variantSlug) {
        return NextResponse.json(
          { error: `${sku.name} needs a colour selection` },
          { status: 400 },
        );
      }
      const variant = sku.colors.find((c) => c.slug === item.variantSlug);
      if (!variant) {
        return NextResponse.json(
          { error: `Colour ${item.variantSlug} not available for ${sku.name}` },
          { status: 400 },
        );
      }
      variantName = variant.name;
      variantImage = variant.image ?? null;
    }
    const displayName = variantName ? `${sku.name} · ${variantName}` : sku.name;
    const displayImage = variantImage ?? sku.heroImage ?? null;
    const lineTotal = sku.retailINR * item.qty;
    subtotal += lineTotal;
    lineItems.push({
      skuId: sku.id,
      variantSlug: item.variantSlug ?? null,
      name: displayName,
      image: displayImage,
      unitPriceInr: sku.retailINR,
      qty: item.qty,
      lineTotalInr: lineTotal,
    });
  }

  // ── 2. Fees + custom discount ──────────────────────────────────
  // Manual orders are ALWAYS online (Payment Link). They also bypass the
  // prepaid-discount path because the admin sets the discount % explicitly.
  const shipping = subtotal >= OFFERS.freeShippingMinINR ? 0 : 85;
  const grossBeforeDiscount = subtotal + shipping;
  const discountInr = Math.round((grossBeforeDiscount * body.discountPct) / 100);
  const total = grossBeforeDiscount - discountInr;
  if (total < 1) {
    return NextResponse.json(
      { error: "Total must be at least ₹1 after discount" },
      { status: 400 },
    );
  }

  // ── 3. Open transaction: stock decrement, customer upsert, address, order,
  //       event. Razorpay Payment Link call happens AFTER commit so a network
  //       hiccup with Razorpay leaves the order PENDING and reconcile can
  //       handle it, rather than leaving a half-written DB state.
  let orderId = generateOrderId("PRC");
  let attempts = 0;
  type TxnResult = {
    orderId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
  };

  let txnResult: TxnResult | null = null;

  while (attempts < 3 && !txnResult) {
    try {
      txnResult = await db.transaction(async (tx) => {
        // 3a. Atomic stock decrement (same gate as customer route).
        for (const item of body.items) {
          const variantKey = item.variantSlug ?? "";
          const sku = PRODUCTS.find((p) => p.id === item.skuId);
          if (!sku) continue;
          const decremented = await tx
            .update(inventory)
            .set({ stock: sql`${inventory.stock} - ${item.qty}`, updatedAt: new Date() })
            .where(
              and(
                eq(inventory.siteId, INVENTORY_SITE_ID),
                eq(inventory.skuId, item.skuId),
                eq(inventory.variantSlug, variantKey),
                sql`${inventory.stock} >= ${item.qty}`,
              ),
            )
            .returning({ stock: inventory.stock });
          if (decremented.length === 0) {
            const current = await tx
              .select({ stock: inventory.stock })
              .from(inventory)
              .where(
                and(
                  eq(inventory.siteId, INVENTORY_SITE_ID),
                  eq(inventory.skuId, item.skuId),
                  eq(inventory.variantSlug, variantKey),
                ),
              );
            if (current.length === 0) {
              throw new Error(
                `STOCK:Inventory not configured for ${sku.name}${variantKey ? ` (${variantKey})` : ""}`,
              );
            }
            const available = current[0].stock;
            if (available <= 0) {
              throw new Error(
                `STOCK:${sku.name}${variantKey ? ` (${variantKey})` : ""} is sold out`,
              );
            }
            throw new Error(
              `STOCK:Only ${available} ${sku.name}${variantKey ? ` (${variantKey})` : ""} left — reduce qty`,
            );
          }
        }

        // 3b. UPSERT customer by phone — manual orders often come from people
        //     who have NEVER been on the website, so a fresh row is common.
        //     `phone` is the unique key on the customers table (global across
        //     sites), so one phone collapses to one row regardless of which
        //     storefront they buy from.
        const upserted = await tx
          .insert(customers)
          .values({
            phone: body.customer.phone,
            email: body.customer.email || null,
            name: body.customer.fullName,
            firstSiteId: body.siteId,
          })
          .onConflictDoUpdate({
            target: customers.phone,
            set: {
              email: sql`coalesce(${customers.email}, excluded.email)`,
              name: sql`coalesce(${customers.name}, excluded.name)`,
              updatedAt: new Date(),
            },
          })
          .returning({
            id: customers.id,
            phone: customers.phone,
            email: customers.email,
            name: customers.name,
          });
        const customerRow = upserted[0];

        // 3c. INSERT address — stores the shipping target for Shiprocket.
        await tx.insert(addresses).values({
          customerId: customerRow.id,
          fullName: body.customer.fullName,
          phone: body.customer.phone,
          line1: body.customer.line1,
          line2: body.customer.line2 || null,
          city: body.customer.city,
          state: body.customer.state,
          pincode: body.customer.pincode,
        });

        // 3d. INSERT order. status=PENDING, payment_method=UPI as a default
        //     (Razorpay Payment Links accept all methods; we'll update the
        //     row to the actual method when payment captures via webhook).
        //     created_via + created_by_email mark this as a manual order.
        await tx.insert(orders).values({
          id: orderId,
          siteId: body.siteId,
          customerId: customerRow.id,
          items: lineItems,
          shippingAddress: {
            fullName: body.customer.fullName,
            phone: body.customer.phone,
            email: body.customer.email || null,
            line1: body.customer.line1,
            line2: body.customer.line2 || null,
            city: body.customer.city,
            state: body.customer.state,
            pincode: body.customer.pincode,
          },
          subtotalInr: subtotal,
          shippingInr: shipping,
          codFeeInr: 0,
          discountInr,
          totalInr: total,
          couponCode: null,
          paymentMethod: "UPI",
          status: "PENDING",
          createdVia: "ADMIN_MANUAL",
          createdByEmail: ctx.email,
          notes: body.notes || null,
          idempotencyKey: `manual:${orderId}`,
        });

        // 3e. Append audit event.
        await tx.insert(events).values({
          siteId: body.siteId,
          orderId,
          type: "ORDER_CREATED",
          payload: {
            via: "ADMIN_MANUAL",
            adminEmail: ctx.email,
            discountPct: body.discountPct,
            total,
          },
        });

        return {
          orderId,
          customerId: customerRow.id,
          customerName: customerRow.name ?? body.customer.fullName,
          customerPhone: customerRow.phone,
          customerEmail: customerRow.email ?? (body.customer.email || null),
        };
      });
    } catch (err) {
      // Order-id collision? Retry with a fresh id.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("orders_pkey") || msg.includes("duplicate key")) {
        orderId = generateOrderId("PRC");
        attempts++;
        continue;
      }
      // Stock / validation error — surface to caller.
      if (msg.startsWith("STOCK:")) {
        return NextResponse.json(
          { error: msg.slice("STOCK:".length) },
          { status: 409 },
        );
      }
      logError("admin.orders.create.transaction", err);
      return NextResponse.json(
        { error: "INTERNAL", detail: msg },
        { status: 500 },
      );
    }
  }

  if (!txnResult) {
    return NextResponse.json(
      { error: "Could not allocate a unique order id after 3 attempts" },
      { status: 500 },
    );
  }

  // ── 4. Razorpay Payment Link. Happens AFTER commit so a Razorpay outage
  //       doesn't leave us with a phantom row — the order sits PENDING and
  //       the admin can retry from the UI. Reconcile sweeps unpaid PENDINGs
  //       so stock is eventually released.
  const itemDesc = lineItems
    .slice(0, 2)
    .map((i) => `${i.name} × ${i.qty}`)
    .join(", ") + (lineItems.length > 2 ? `, +${lineItems.length - 2} more` : "");
  const expireBySec =
    Math.floor(Date.now() / 1000) + PAYMENT_LINK_EXPIRY_HOURS * 3600;

  let paymentLink: { id: string; shortUrl: string };
  try {
    const link = await createPaymentLink({
      amountPaise: total * 100,
      referenceId: txnResult.orderId,
      description: `PRC Cars — ${itemDesc}`,
      customer: {
        name: txnResult.customerName,
        contact: `+91${txnResult.customerPhone}`,
        email: txnResult.customerEmail ?? undefined,
      },
      callbackUrl: `https://${THEME.domain}/orders/${txnResult.orderId}`,
      expireBySec,
      notes: {
        order_id: txnResult.orderId,
        created_by: ctx.email,
        site_id: body.siteId,
      },
    });
    paymentLink = { id: link.id, shortUrl: link.shortUrl };
  } catch (err) {
    logError("admin.orders.create.payment_link", err);
    return NextResponse.json(
      {
        orderId: txnResult.orderId,
        error: "RAZORPAY_LINK_FAILED",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // 4b. Persist the payment-link id so the webhook can map it back.
  await db
    .update(orders)
    .set({
      razorpayPaymentLinkId: paymentLink.id,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, txnResult.orderId));

  // 4c. Audit the link creation so the operator (or auditors) can see when
  //     the link was sent and to whom.
  await db.insert(events).values({
    siteId: body.siteId,
    orderId: txnResult.orderId,
    type: "PAYMENT_LINK_CREATED",
    payload: {
      paymentLinkId: paymentLink.id,
      shortUrl: paymentLink.shortUrl,
      expireBySec,
    },
  });

  return NextResponse.json({
    ok: true,
    orderId: txnResult.orderId,
    paymentLink: paymentLink.shortUrl,
    paymentLinkId: paymentLink.id,
    total,
    customer: {
      name: txnResult.customerName,
      phone: txnResult.customerPhone,
      email: txnResult.customerEmail,
    },
  });
}
