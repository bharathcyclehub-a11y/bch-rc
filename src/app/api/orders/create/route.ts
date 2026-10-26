/**
 * POST /api/orders/create
 *
 * The critical-path endpoint. In one transaction:
 *   1. UPSERT customer by phone
 *   2. INSERT address
 *   3. Validate each cart line against the products catalog AND verify the
 *      chosen variant is in stock
 *   4. Compute totals SERVER-SIDE (never trust client `total`)
 *   5. Redeem coupon atomically (used_count++ under the same transaction)
 *   6. INSERT orders row keyed on idempotency_key — duplicate submits return
 *      the original order without side effects
 *   7. For prepaid: create Razorpay order, save razorpay_order_id
 *      For COD: trigger Shiprocket shipment in-process (admin-gated route is
 *      reserved for manual admin retry)
 *   8. ENQUEUE order confirmation email (outbox row)
 */

import { NextResponse, after, type NextRequest } from "next/server";
import { recordServerFunnelEvent } from "@/lib/funnel-server";
import { getOverrideMap, applyOverride } from "@/lib/product-overrides";
import { getBundleComponentSkuIds } from "@/lib/availability";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import {
  customers,
  addresses,
  orders,
  events,
  inventory,
  notificationsOutbox,
  checkoutLeads,
} from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { PRODUCTS } from "@/lib/products";
import {
  OFFERS,
  bundleDiscountInr,
  computeCodConfirmationFee,
  COD_CONFIRMATION_16_MAX_INR,
} from "@/lib/config";
import { razorpay } from "@/lib/razorpay";
import { INVENTORY_SITE_ID } from "@/lib/inventory";
import { generateOrderId } from "@/lib/order-id";
import { redeemCoupon, CouponError } from "@/lib/coupons";
import { sendOutboxRow } from "@/lib/notifications/drain";
import { notifyOrderEvent, whatsappEnabled } from "@/lib/notifications/notify";
import { verifyServiceabilityLive } from "@/lib/serviceability";
import { logError } from "@/lib/logger";
import { resolveOrderAttribution } from "@/lib/attribution";
import { VISITOR_COOKIE, SESSION_COOKIE } from "@/lib/analytics";
import { rateLimit } from "@/lib/rate-limit";

const PaymentMethod = z.enum(["UPI", "CARD", "NETBANKING", "WALLET", "COD"]);

const CartItemInput = z.object({
  skuId: z.string().min(1).max(80),
  variantSlug: z.string().max(40).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  qty: z.number().int().positive().max(20),
});

const AddressInput = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().regex(/^[0-9]{10}$/, "10-digit phone required"),
  email: z.string().email("Valid email required").max(160),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, "6-digit pincode required"),
});

const BodySchema = z.object({
  siteId: z.string().min(1).max(40).default("prc"),
  idempotencyKey: z.string().min(8).max(64),
  items: z.array(CartItemInput).min(1).max(20),
  address: AddressInput,
  paymentMethod: PaymentMethod,
  couponCode: z.string().max(40).optional(),
});

type OrderItemSnapshot = {
  skuId: string;
  variantSlug: string | null;
  name: string;
  image: string | null;
  unitPriceInr: number;
  qty: number;
  lineTotalInr: number;
};

class StockConflictError extends Error {
  skuId: string;
  variantSlug: string | null;
  availableQty: number;
  code: "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | "UNCONFIGURED";

  constructor(opts: {
    message: string;
    skuId: string;
    variantSlug: string | null;
    availableQty: number;
    code: "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | "UNCONFIGURED";
  }) {
    super(`STOCK:${opts.message}`);
    this.skuId = opts.skuId;
    this.variantSlug = opts.variantSlug;
    this.availableQty = opts.availableQty;
    this.code = opts.code;
  }
}

async function buildIdempotentReplayResponse(o: typeof orders.$inferSelect) {
  // Legacy 0-fee COD needs no Razorpay order
  if (o.paymentMethod === "COD" && o.confirmationFeeInr <= 0) {
    return NextResponse.json({
      ok: true,
      orderId: o.id,
      paymentMethod: "COD",
      amountInr: o.totalInr,
      replayed: true,
    });
  }

  // Both full prepaid AND partial-prepaid COD (confirmationFeeInr > 0) require
  // a valid razorpayOrderId so the client opens the Razorpay modal rather than
  // skipping payment verification.
  const razorpayAmountInr =
    o.paymentMethod === "COD" ? o.confirmationFeeInr : o.totalInr;
  let razorpayOrderId = o.razorpayOrderId;
  if (!razorpayOrderId) {
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: razorpayAmountInr * 100,
        currency: "INR",
        receipt: o.id,
        notes: {
          site: o.siteId,
          customerId: o.customerId,
          phone: (o.shippingAddress as { phone: string }).phone,
          flow: o.paymentMethod === "COD" ? "cod_confirmation" : "prepaid",
          totalInr: o.totalInr,
          confirmationFeeInr: o.confirmationFeeInr,
          recoveredFor: "idempotency-replay",
        },
      });
      razorpayOrderId = rzpOrder.id;
      await db
        .update(orders)
        .set({ razorpayOrderId, updatedAt: new Date() })
        .where(eq(orders.id, o.id));
    } catch (err) {
      logError("order:create:replay-razorpay", err, { orderId: o.id });
      return NextResponse.json(
        { error: "Payment provider unavailable — retry in a minute." },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    orderId: o.id,
    paymentMethod: o.paymentMethod,
    razorpayOrderId,
    razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    amountInr: razorpayAmountInr,
    codBalanceInr:
      o.paymentMethod === "COD" ? o.totalInr - razorpayAmountInr : 0,
    confirmationFeeInr: o.confirmationFeeInr,
    totalInr: o.totalInr,
    customerName: (o.shippingAddress as { fullName: string }).fullName,
    customerEmail: (o.shippingAddress as { email?: string }).email,
    customerPhone: (o.shippingAddress as { phone: string }).phone,
    replayed: true,
  });
}

export async function POST(req: NextRequest) {
  // DoS backstop on the most expensive endpoint (DB txn + live Razorpay order
  // creation). Generous cap — idempotency already covers legitimate retries, so
  // a real buyer never trips this; a flood from one IP does.
  const limited = rateLimit(req, { scope: "orders:create", limit: 30 });
  if (limited) return limited;

  let body: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    body = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body", details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  // ── Idempotency short-circuit ────────────────────────────────────
  // If this idempotency key already has an order, return the original
  // without touching anything else.
  const existing = await db
    .select()
    .from(orders)
    .where(eq(orders.idempotencyKey, body.idempotencyKey))
    .limit(1);

  if (existing.length > 0) {
    return buildIdempotentReplayResponse(existing[0]);
  }

  // ── 0. Serviceability gate ───────────────────────────────────────
  const svc = await verifyServiceabilityLive(
    body.address.pincode,
    body.paymentMethod === "COD",
  );
  if (!svc.serviceable) {
    return NextResponse.json(
      { error: svc.reason ?? "We don't deliver to this pincode yet. WhatsApp us to check." },
      { status: 422 },
    );
  }
  if (body.paymentMethod === "COD" && !svc.codAvailable) {
    return NextResponse.json(
      {
        error:
          svc.reason ??
          "COD isn't available for this pincode — pay online to order (you save ₹100).",
      },
      { status: 422 },
    );
  }

  // ── 1. Validate every line item against catalog + overrides ──────
  const lineItems: OrderItemSnapshot[] = [];
  let subtotal = 0;

  // Admin price/visibility/status overrides are authoritative here.
  const overrides = await getOverrideMap();

  for (const item of body.items) {
    const base = PRODUCTS.find((p) => p.id === item.skuId);
    const sku = base ? applyOverride(base, overrides.get(item.skuId)) : undefined;
    if (!sku || sku.hidden) {
      return NextResponse.json(
        { error: `Product ${item.skuId} not available` },
        { status: 400 },
      );
    }
    if (sku.discontinued) {
      return NextResponse.json(
        { error: `${sku.name} has been discontinued and is no longer available for purchase.` },
        { status: 409 },
      );
    }
    if (sku.comingSoon && !sku.preorder) {
      return NextResponse.json(
        { error: `${sku.name} is coming soon and is not yet open for orders.` },
        { status: 409 },
      );
    }

    let variantName: string | null = null;
    let variantImage: string | null = null;
    if (sku.colors && sku.colors.length > 0) {
      // SKUs with colors REQUIRE a variant selection.
      if (!item.variantSlug) {
        return NextResponse.json(
          { error: `Pick a colour for ${sku.name}` },
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
      // NOTE: Do NOT gate on static `variant.stock` from products.ts — that value
      // is seed-only (e.g. pocket-thar Black has seed stock=1 while DB inventory
      // has 50). The DB transaction in Step 3a below is the single authoritative
      // stock gate.
      variantName = variant.name;
      variantImage = variant.image ?? null;
    }

    const displayName = variantName ? `${sku.name} · ${variantName}` : sku.name;
    const displayImage = variantImage ?? sku.heroImage ?? null;
    const lineTotal = sku.retailINR * item.qty;
    subtotal += lineTotal;
    lineItems.push({
      skuId: sku.id,
      variantSlug: sku.colors && sku.colors.length > 0 ? (item.variantSlug ?? null) : null,
      name: displayName,
      image: displayImage,
      unitPriceInr: sku.retailINR,
      qty: item.qty,
      lineTotalInr: lineTotal,
    });
  }

  // ── 2. Compute fees + total server-side ────────────────────────
  const shipping = subtotal >= OFFERS.freeShippingMinINR ? 0 : 85;
  const codFee =
    body.paymentMethod === "COD" && subtotal < OFFERS.codFeeAppliesBelowINR
      ? OFFERS.codFeeINR
      : 0;
  const prepaidDiscount =
    body.paymentMethod !== "COD" ? OFFERS.prepaidDiscountINR : 0;

  const is16Order =
    lineItems.length > 0 &&
    lineItems.every(
      (li) => PRODUCTS.find((p) => p.id === li.skuId)?.scale === "1:16",
    );
  const confirmationFee =
    body.paymentMethod === "COD"
      ? computeCodConfirmationFee(
          subtotal,
          is16Order ? COD_CONFIRMATION_16_MAX_INR : undefined,
        )
      : 0;
  const cartQty = body.items.reduce((n, i) => n + i.qty, 0);
  const bundleDiscount = bundleDiscountInr(cartQty, subtotal);

  // ── 2b. Resolve marketing attribution (first-touch) ────────────
  const cookieStore = await cookies();
  const attribution = await resolveOrderAttribution({
    visitorId: cookieStore.get(VISITOR_COOKIE)?.value,
    sessionId: cookieStore.get(SESSION_COOKIE)?.value,
    siteId: body.siteId,
  });

  // ── 3. Open transaction: atomic stock decrement (including bundle components),
  //       customer upsert, coupon redemption, address insert, order insert.
  let orderId = generateOrderId("PRC");
  let attempts = 0;
  type TxnResult = {
    orderId: string;
    customerId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    couponDiscountInr: number;
    appliedCouponCode: string | null;
    total: number;
    notificationId: string | null;
  };

  let txnResult: TxnResult | null = null;

  // Build deterministic list of inventory requirements (aggregating duplicate lines
  // and expanding bundle component SKUs) sorted by key to prevent row-lock deadlocks.
  type StockRequirement = {
    skuId: string;
    variantSlug: string;
    qty: number;
    label: string;
    parentSkuId: string;
    parentVariantSlug: string | null;
  };
  const reqMap = new Map<string, StockRequirement>();
  for (const item of body.items) {
    const base = PRODUCTS.find((p) => p.id === item.skuId);
    const sku = base ? applyOverride(base, overrides.get(item.skuId)) : undefined;
    if (!sku) continue;
    const variantKey = sku.colors && sku.colors.length > 0 ? (item.variantSlug ?? "") : "";
    const variantObj = sku.colors?.find((c) => c.slug === variantKey);
    const label = variantObj ? `${sku.name} (${variantObj.name})` : sku.name;
    const mapKey = `${sku.id}:${variantKey}`;
    const existingReq = reqMap.get(mapKey);
    if (existingReq) {
      existingReq.qty += item.qty;
    } else {
      reqMap.set(mapKey, {
        skuId: sku.id,
        variantSlug: variantKey,
        qty: item.qty,
        label,
        parentSkuId: sku.id,
        parentVariantSlug: variantKey || null,
      });
    }

    // Also require component SKUs for fixed-price bundles (e.g. construction-3pack)
    const compIds = getBundleComponentSkuIds(sku);
    for (const compId of compIds) {
      const compSku = PRODUCTS.find((p) => p.id === compId);
      const compKey = `${compId}:`;
      const compLabel = compSku
        ? `${sku.name} (${compSku.name})`
        : `${sku.name} (${compId})`;
      const existingComp = reqMap.get(compKey);
      if (existingComp) {
        existingComp.qty += item.qty;
      } else {
        reqMap.set(compKey, {
          skuId: compId,
          variantSlug: "",
          qty: item.qty,
          label: compLabel,
          parentSkuId: sku.id,
          parentVariantSlug: null,
        });
      }
    }
  }
  const sortedStockReqs = Array.from(reqMap.values()).sort((a, b) =>
    `${a.skuId}:${a.variantSlug}`.localeCompare(`${b.skuId}:${b.variantSlug}`),
  );

  while (attempts < 3 && !txnResult) {
    try {
      txnResult = await db.transaction(async (tx) => {
        // 3a. Atomic stock decrement in canonical key order.
        for (const reqItem of sortedStockReqs) {
          const decremented = await tx
            .update(inventory)
            .set({
              stock: sql`${inventory.stock} - ${reqItem.qty}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(inventory.siteId, INVENTORY_SITE_ID),
                eq(inventory.skuId, reqItem.skuId),
                eq(inventory.variantSlug, reqItem.variantSlug),
                sql`${inventory.stock} >= ${reqItem.qty}`,
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
                  eq(inventory.skuId, reqItem.skuId),
                  eq(inventory.variantSlug, reqItem.variantSlug),
                ),
              );
            if (current.length === 0) {
              throw new StockConflictError({
                message: `Inventory not configured for ${reqItem.label}`,
                skuId: reqItem.parentSkuId,
                variantSlug: reqItem.parentVariantSlug,
                availableQty: 0,
                code: "UNCONFIGURED",
              });
            }
            const available = Math.max(0, current[0].stock);
            if (available <= 0) {
              throw new StockConflictError({
                message: `${reqItem.label} just sold out`,
                skuId: reqItem.parentSkuId,
                variantSlug: reqItem.parentVariantSlug,
                availableQty: 0,
                code: "OUT_OF_STOCK",
              });
            }
            throw new StockConflictError({
              message: `Only ${available} ${reqItem.label} left in stock — please reduce quantity to ${available}`,
              skuId: reqItem.parentSkuId,
              variantSlug: reqItem.parentVariantSlug,
              availableQty: available,
              code: "INSUFFICIENT_STOCK",
            });
          }
        }

        // Auto-hide any non-internal SKU whose total remaining stock just hit 0.
        const touchedSkuIds = Array.from(new Set(sortedStockReqs.map((r) => r.skuId)));
        for (const skuId of touchedSkuIds) {
          if (skuId === "qa-1rs") continue;
          const skuRows = await tx
            .select({ stock: inventory.stock })
            .from(inventory)
            .where(
              and(
                eq(inventory.siteId, INVENTORY_SITE_ID),
                eq(inventory.skuId, skuId),
              ),
            );
          const totalSkuStock = skuRows.reduce((sum, r) => sum + Math.max(0, r.stock), 0);
          if (totalSkuStock <= 0) {
            await tx.execute(sql`
              insert into product_overrides (site_id, sku_id, hidden, coming_soon, updated_at, updated_by)
              values (${INVENTORY_SITE_ID}, ${skuId}, true, false, now(), 'auto-zero-stock')
              on conflict (site_id, sku_id)
              do update set hidden = true, updated_at = now(), updated_by = 'auto-zero-stock'
            `);
          }
        }

        // 3b. UPSERT customer by phone.
        const [customer] = await tx
          .insert(customers)
          .values({
            phone: body.address.phone,
            email: body.address.email || null,
            name: body.address.fullName,
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
          .returning();

        // 3c. INSERT the order row early with PENDING totals.
        const totalBeforeCoupon =
          subtotal + shipping + codFee - prepaidDiscount - bundleDiscount;
        if (totalBeforeCoupon <= 0) {
          throw new Error("BODY:Invalid total");
        }

        await tx.insert(orders).values({
          id: orderId,
          siteId: body.siteId,
          customerId: customer.id,
          idempotencyKey: body.idempotencyKey,
          status: "PENDING",
          items: lineItems,
          shippingAddress: body.address,
          subtotalInr: subtotal,
          shippingInr: shipping,
          codFeeInr: codFee,
          confirmationFeeInr: confirmationFee,
          discountInr: prepaidDiscount + bundleDiscount,
          totalInr: totalBeforeCoupon,
          couponCode: null,
          paymentMethod: body.paymentMethod,
          paymentStatus: "PENDING",
          source: attribution.source,
          utmSource: attribution.utmSource,
          utmMedium: attribution.utmMedium,
          utmCampaign: attribution.utmCampaign,
          utmContent: attribution.utmContent,
          referrerHost: attribution.referrerHost,
        });

        // 3d. Coupon — atomic redeem + per-customer-limit guard + ledger.
        let couponDiscountInr = 0;
        let appliedCouponCode: string | null = null;
        let couponIsBargain = false;
        if (body.couponCode && body.couponCode.trim()) {
          try {
            const result = await redeemCoupon({
              tx,
              code: body.couponCode,
              siteId: body.siteId,
              customerId: customer.id,
              orderId,
              subtotalInr: subtotal,
              shippingInr: shipping,
              cartSkuIds: lineItems.map((i) => i.skuId),
            });
            couponDiscountInr = result.discountInr;
            appliedCouponCode = result.code;
            couponIsBargain = result.isBargain;
          } catch (err) {
            if (err instanceof CouponError) {
              throw new Error(`COUPON:${err.reason}`);
            }
            throw err;
          }
        }

        // Bargain coupons represent a negotiated final price and do not stack with
        // prepaid/bundle discounts — EXCEPT they must never charge the customer MORE
        // than the standard auto-applied discounts (matching src/lib/pricing.ts).
        const standardDiscounts = prepaidDiscount + bundleDiscount;
        const bargainWins = couponIsBargain && couponDiscountInr >= standardDiscounts;
        const effPrepaidDiscount = bargainWins ? 0 : prepaidDiscount;
        const effBundleDiscount = bargainWins ? 0 : bundleDiscount;
        const effCouponDiscount =
          couponIsBargain && !bargainWins ? 0 : couponDiscountInr;
        const totalDiscountInr =
          effPrepaidDiscount + effBundleDiscount + effCouponDiscount;

        const total = Math.max(
          0,
          subtotal + shipping + codFee - totalDiscountInr,
        );
        if (total <= 0) {
          throw new Error("BODY:Invalid total");
        }

        // 3e. Apply the discounts onto the order row.
        if (couponDiscountInr > 0) {
          await tx
            .update(orders)
            .set({
              discountInr: totalDiscountInr,
              totalInr: total,
              couponCode: appliedCouponCode,
              updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));
        }

        await tx.insert(addresses).values({
          customerId: customer.id,
          fullName: body.address.fullName,
          phone: body.address.phone,
          line1: body.address.line1,
          line2: body.address.line2 || null,
          city: body.address.city,
          state: body.address.state,
          pincode: body.address.pincode,
        });

        await tx.insert(events).values({
          siteId: body.siteId,
          orderId,
          customerId: customer.id,
          type: "ORDER_CREATED",
          payload: {
            total,
            paymentMethod: body.paymentMethod,
            itemCount: lineItems.length,
            couponCode: appliedCouponCode,
            couponDiscountInr: effCouponDiscount,
          },
          source: "user",
        });

        let notificationId: string | null = null;
        if (body.paymentMethod === "COD" && confirmationFee === 0) {
          const [n] = await tx
            .insert(notificationsOutbox)
            .values({
              siteId: body.siteId,
              orderId,
              customerId: customer.id,
              channel: "email",
              template: "ORDER_RECEIVED",
              dedupKey: `${orderId}:ORDER_RECEIVED:email`,
              payload: {
                to: body.address.email,
                toPhone: body.address.phone,
                customerName: body.address.fullName,
                orderId,
                totalInr: total,
                paymentMethod: "COD",
                etaText: svc.etaText,
                items: lineItems.map((i) => ({
                  name: i.name,
                  qty: i.qty,
                  lineTotalInr: i.lineTotalInr,
                  image: i.image,
                })),
                subtotalInr: subtotal,
                shippingInr: shipping,
                codFeeInr: codFee,
                discountInr: totalDiscountInr,
                couponCode: appliedCouponCode,
                shippingAddress: {
                  fullName: body.address.fullName,
                  phone: body.address.phone,
                  line1: body.address.line1,
                  line2: body.address.line2 || null,
                  city: body.address.city,
                  state: body.address.state,
                  pincode: body.address.pincode,
                },
              },
            })
            .returning({ id: notificationsOutbox.id });
          notificationId = n?.id ?? null;
        }

        return {
          orderId,
          customerId: customer.id,
          customerName: body.address.fullName,
          customerEmail: body.address.email,
          customerPhone: body.address.phone,
          couponDiscountInr: effCouponDiscount,
          appliedCouponCode,
          total,
          notificationId,
        };
      });
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "23505"
      ) {
        const msg = (err as { detail?: string }).detail ?? "";
        if (msg.includes("idempotency_key")) {
          const replay = await db
            .select()
            .from(orders)
            .where(eq(orders.idempotencyKey, body.idempotencyKey))
            .limit(1);
          if (replay[0]) {
            return buildIdempotentReplayResponse(replay[0]);
          }
        }
        orderId = generateOrderId("PRC");
        attempts++;
        continue;
      }
      if (err instanceof StockConflictError) {
        const conflictMsg = err.message.slice(6);
        after(async () => {
          try {
            await db.insert(events).values({
              siteId: body.siteId,
              type: "ORDER_STOCK_FAILURE",
              payload: {
                skuId: err.skuId,
                variantSlug: err.variantSlug,
                availableQty: err.availableQty,
                code: err.code,
                message: conflictMsg,
                requestedItems: body.items.map((i) => ({
                  skuId: i.skuId,
                  variantSlug: i.variantSlug,
                  qty: i.qty,
                })),
              },
              source: "system",
            });
            await recordServerFunnelEvent(
              req,
              "checkout_stock_failure",
              {
                skuId: err.skuId,
                variantSlug: err.variantSlug ?? "",
                reason: err.code,
              },
              { path: "/checkout" },
            );
          } catch {
            // telemetry must never fail response
          }
        });
        return NextResponse.json(
          {
            error: conflictMsg,
            code: err.code,
            failedSkuId: err.skuId,
            failedVariantSlug: err.variantSlug,
            availableQty: err.availableQty,
          },
          { status: 409 },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("COUPON:")) {
        return NextResponse.json(
          { error: message.slice(7) },
          { status: 400 },
        );
      }
      if (message.startsWith("STOCK:")) {
        return NextResponse.json(
          { error: message.slice(6) },
          { status: 409 },
        );
      }
      if (message.startsWith("BODY:")) {
        return NextResponse.json({ error: message.slice(5) }, { status: 400 });
      }
      logError("order:create:txn", err, { orderId, idempotencyKey: body.idempotencyKey });
      return NextResponse.json(
        { error: "Order creation failed" },
        { status: 500 },
      );
    }
  }

  if (!txnResult) {
    return NextResponse.json(
      { error: "Order ID collision — please retry" },
      { status: 500 },
    );
  }

  const { customerId, customerName, customerEmail, customerPhone, total } = txnResult;
  orderId = txnResult.orderId;

  // Fire `order_submitted` from the SERVER — authoritative, so it captures 100%
  // of created orders (incl. COD, manual/admin, ad-blocked users, or tabs that
  // navigate away before the client beacon flushes). The client no longer fires
  // this event (would double-count). Best-effort + deferred past the response;
  // telemetry must never block an order. The path hint carries the store so a
  // 1:16 order attributes to prc16 in the funnel.
  {
    const submittedOrderId = orderId;
    after(() =>
      recordServerFunnelEvent(
        req,
        "order_submitted",
        {
          totalInr: total,
          paymentMethod: body.paymentMethod,
          pincode: body.address.pincode,
        },
        {
          path: body.siteId === "prc16" ? "/16/checkout" : "/checkout",
          orderId: submittedOrderId,
        },
      ),
    );
  }

  // This customer reached payment — close their open step-1 lead so the cart
  // recovery list never shows someone already represented by an order row.
  // Best-effort, past the response: lead bookkeeping must never fail an order.
  after(() =>
    db
      .update(checkoutLeads)
      .set({ status: "CONVERTED", convertedOrderId: orderId, updatedAt: new Date() })
      .where(
        and(
          eq(checkoutLeads.customerId, customerId),
          eq(checkoutLeads.status, "OPEN"),
        ),
      )
      .catch((err) => logError("order:create:lead-convert", err, { orderId })),
  );

  // ── 4. Create the Razorpay order ─────────────────────────────────
  //
  // Both prepaid and partial-prepaid COD go through Razorpay now. The
  // amount differs:
  //   • prepaid (UPI / CARD / NETBANKING / WALLET) → full total
  //   • partial-prepaid COD ("Pay X now and rest CoD") → confirmationFee
  //     (10 % of subtotal, clamped ₹100-300). The remaining balance is
  //     collected at the door by Shiprocket's courier.
  //
  // Legacy CoD (confirmationFee === 0) falls through to step 5 below.
  if (body.paymentMethod !== "COD" || confirmationFee > 0) {
    const razorpayAmountInr =
      body.paymentMethod === "COD" ? confirmationFee : total;
    let rzpOrder;
    try {
      rzpOrder = await razorpay.orders.create({
        amount: razorpayAmountInr * 100,
        currency: "INR",
        receipt: orderId,
        notes: {
          site: body.siteId,
          customerId,
          phone: body.address.phone,
          // Capture the intent so admins can tell from the Razorpay dashboard
          // whether a ₹150 payment was a full prepaid (impossible at PRC
          // pricing — confirms it's a CoD confirmation fee).
          flow: body.paymentMethod === "COD" ? "cod_confirmation" : "prepaid",
          totalInr: total,
          confirmationFeeInr: confirmationFee,
        },
      });
    } catch (err) {
      logError("order:create:razorpay", err, { orderId });
      await db.insert(events).values({
        siteId: body.siteId,
        orderId,
        customerId,
        type: "ORDER_RAZORPAY_FAILED",
        payload: { error: err instanceof Error ? err.message : String(err) },
        source: "system",
      }).catch(() => {});
      return NextResponse.json(
        { error: "Payment provider unavailable — retry in a minute." },
        { status: 503 },
      );
    }

    await db
      .update(orders)
      .set({ razorpayOrderId: rzpOrder.id, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    return NextResponse.json({
      ok: true,
      orderId,
      paymentMethod: body.paymentMethod,
      razorpayOrderId: rzpOrder.id,
      razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      // For prepaid: full total. For partial-prepaid CoD: just the
      // confirmation fee — what the customer pays NOW. Checkout.tsx reads
      // this to set the Razorpay modal amount.
      amountInr: razorpayAmountInr,
      // New: tell the client the door amount so the receipt can show
      // "₹150 paid · ₹1,249 on delivery" without re-computing client-side.
      codBalanceInr:
        body.paymentMethod === "COD" ? total - razorpayAmountInr : 0,
      confirmationFeeInr: confirmationFee,
      totalInr: total,
      customerName,
      customerEmail: customerEmail || undefined,
      customerPhone,
    });
  }

  // ── 5. Legacy CoD fallback: defensive only — code never reaches here ──
  //
  // With computeCodConfirmationFee floor of ₹100, every new CoD order goes
  // through step 4 above. This branch only runs if a misconfig (e.g.
  // codConfirmationMinINR set to 0) disables the partial-prepaid flow —
  // in which case we fall back to the original manual /cod verification.
  await db
    .update(orders)
    .set({
      status: "PENDING_COD_VERIFICATION",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  await db.insert(events).values({
    siteId: body.siteId,
    orderId,
    customerId,
    type: "COD_VERIFICATION_PENDING",
    payload: { total },
    source: "user",
  });

  // Outbox row was inserted INSIDE the order transaction (durable). Inline
  // send via `after()` so it runs past the response without the serverless
  // instance freezing it mid-flight; the reconcile cron drains any failure.
  const notificationId = txnResult.notificationId;
  if (notificationId) {
    after(() =>
      sendOutboxRow(notificationId).catch((err) =>
        logError("order:create:inline-send", err, { orderId }),
      ),
    );
  }

  // WhatsApp placeholder too (email above is the durable in-txn row). Only
  // when enabled; runs past the response so it never blocks checkout.
  if (whatsappEnabled()) {
    after(() => notifyOrderEvent(orderId, "ORDER_RECEIVED", ["whatsapp"]));
  }

  return NextResponse.json({
    ok: true,
    orderId,
    paymentMethod: "COD",
    amountInr: total,
  });
}
