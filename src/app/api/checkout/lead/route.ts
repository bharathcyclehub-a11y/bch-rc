/**
 * POST /api/checkout/lead — step-1 contact capture (pre-payment).
 *
 * Fired when a customer completes the DETAILS step of the 2-step checkout
 * (name + phone + address entered) and either advances to payment or leaves
 * the page. We UPSERT the customer (phone = global identity) and UPSERT one
 * OPEN lead row per customer so the team can call / WhatsApp people who entered
 * their details but never paid (surfaced on /admin/recovery).
 *
 * Intentionally lightweight and side-effect-free vs /api/orders/create:
 *   • NO stock decrement   — a half-filled lead must never hold inventory
 *   • NO coupon redemption — money math only happens at the real order
 *   • NO Razorpay order
 *
 * Best-effort: this is lead telemetry, so a failure is logged but returns 200
 * with { ok: false } — it must never block the buyer from reaching payment.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { customers, checkoutLeads } from "@/db/schema";
import { sql } from "drizzle-orm";
import { PRODUCTS } from "@/lib/products";
import { logError } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CartItemInput = z.object({
  skuId: z.string().min(1).max(80),
  variantSlug: z.string().max(40).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  qty: z.number().int().positive().max(20),
});

// Address fields beyond name + phone are best-effort — the lead is worth
// keeping even if the buyer bailed before completing the full address.
const BodySchema = z.object({
  siteId: z.string().min(1).max(40).default("prc"),
  address: z.object({
    fullName: z.string().min(2).max(120),
    phone: z.string().regex(/^[0-9]{10}$/, "10-digit phone required"),
    email: z.string().max(160).optional().or(z.literal("")),
    line1: z.string().max(200).optional().or(z.literal("")),
    line2: z.string().max(200).optional().or(z.literal("")),
    city: z.string().max(80).optional().or(z.literal("")),
    state: z.string().max(80).optional().or(z.literal("")),
    pincode: z.string().max(10).optional().or(z.literal("")),
  }),
  items: z.array(CartItemInput).max(20).default([]),
});

export async function POST(req: Request) {
  // Unauthenticated write that upserts the global customers table — cap per-IP
  // to stop record-tampering floods and recovery-queue spam. Kept generous:
  // the client now autosaves as the buyer fills the form (deduped, so only a
  // handful of saves per checkout), and many real buyers share one carrier IP
  // behind CGNAT — a tight cap would silently drop legitimate leads.
  const limited = rateLimit(req, { scope: "checkout:lead", limit: 60 });
  if (limited) return limited;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    // Not enough to be a useful lead (no valid name/phone) — quietly accept.
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // Resolve the cart snapshot + subtotal server-side from the catalog so the
  // recovery list shows accurate items/value and the client can't spoof them.
  const itemsSnapshot: {
    skuId: string;
    variantSlug: string | null;
    name: string;
    image: string | null;
    qty: number;
    unitPriceInr: number;
    lineTotalInr: number;
  }[] = [];
  let subtotalInr = 0;
  for (const item of body.items) {
    const sku = PRODUCTS.find((p) => p.id === item.skuId);
    if (!sku) continue;
    const variant = item.variantSlug
      ? sku.colors?.find((c) => c.slug === item.variantSlug)
      : undefined;
    const name = variant ? `${sku.name} · ${variant.name}` : sku.name;
    const image = variant?.image ?? sku.heroImage ?? null;
    const lineTotal = sku.retailINR * item.qty;
    subtotalInr += lineTotal;
    itemsSnapshot.push({
      skuId: sku.id,
      variantSlug: item.variantSlug ?? null,
      name,
      image,
      qty: item.qty,
      unitPriceInr: sku.retailINR,
      lineTotalInr: lineTotal,
    });
  }

  try {
    // UPSERT customer by phone — the contact also shows in /admin/customers,
    // and gives us the customerId the lead row links to.
    const [customer] = await db
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
      .returning({ id: customers.id });

    // UPSERT the lead — one OPEN row per customer, refreshed each time they
    // re-fill the details step. Re-open a previously CONVERTED lead: if they're
    // back in checkout they're a live lead again.
    await db
      .insert(checkoutLeads)
      .values({
        siteId: body.siteId,
        customerId: customer.id,
        fullName: body.address.fullName,
        phone: body.address.phone,
        email: body.address.email || null,
        line1: body.address.line1 || null,
        line2: body.address.line2 || null,
        city: body.address.city || null,
        state: body.address.state || null,
        pincode: body.address.pincode || null,
        items: itemsSnapshot,
        subtotalInr,
        status: "OPEN",
        convertedOrderId: null,
      })
      .onConflictDoUpdate({
        target: checkoutLeads.customerId,
        set: {
          siteId: body.siteId,
          fullName: body.address.fullName,
          phone: body.address.phone,
          email: body.address.email || null,
          line1: body.address.line1 || null,
          line2: body.address.line2 || null,
          city: body.address.city || null,
          state: body.address.state || null,
          pincode: body.address.pincode || null,
          items: itemsSnapshot,
          subtotalInr,
          status: "OPEN",
          convertedOrderId: null,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("checkout:lead", err, { phone: body.address.phone });
    // Never surface lead-capture failures to the buyer.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
