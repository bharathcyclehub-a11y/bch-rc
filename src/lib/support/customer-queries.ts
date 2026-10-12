/**
 * Read helpers for the CUSTOMER side of the Support Centre (/support/*).
 *
 * Every order read here is scoped to the verified customer id — callers pass
 * the id from getSupportSession(), never one from the request. Shipping data
 * is returned already masked (first name, city, state, PIN, masked phone):
 * the support pages never need a street address.
 */

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { helpArticles, orders, supportTicketAttachments, supportTickets, type Order } from "@/db/schema";
import { getProductById } from "@/lib/products";
import { maskPhone } from "./session";

export type OrderItemView = {
  key: string;
  skuId: string;
  variantSlug: string | null;
  variantName: string | null;
  name: string;
  image: string | null;
  qty: number;
  unitPriceInr: number;
  lineTotalInr: number;
};

type RawItem = {
  skuId?: unknown;
  variantSlug?: unknown;
  name?: unknown;
  image?: unknown;
  unitPriceInr?: unknown;
  qty?: unknown;
  lineTotalInr?: unknown;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The order's line-item snapshot, parsed defensively, with colour names resolved. */
export function orderItems(o: Pick<Order, "items">): OrderItemView[] {
  const raw = Array.isArray(o.items) ? (o.items as RawItem[]) : [];
  return raw
    .filter((it): it is RawItem => !!it && typeof it === "object" && typeof it.skuId === "string")
    .map((it, i) => {
      const skuId = it.skuId as string;
      const variantSlug = str(it.variantSlug);
      const product = getProductById(skuId);
      const variantName = variantSlug ? (product?.colors?.find((c) => c.slug === variantSlug)?.name ?? null) : null;
      return {
        key: `${skuId}::${variantSlug ?? ""}::${i}`,
        skuId,
        variantSlug,
        variantName,
        name: str(it.name) ?? product?.name ?? "Item",
        image: str(it.image),
        qty: int(it.qty) || 1,
        unitPriceInr: int(it.unitPriceInr),
        lineTotalInr: int(it.lineTotalInr),
      };
    });
}

/** Item picker value: "<skuId>::<variantSlug>" (variant may be empty). */
export const itemValue = (it: Pick<OrderItemView, "skuId" | "variantSlug">) => `${it.skuId}::${it.variantSlug ?? ""}`;

export type MaskedShipping = {
  firstName: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
};

export function maskedShipping(o: Pick<Order, "shippingAddress">): MaskedShipping {
  const a = (o.shippingAddress ?? {}) as Record<string, unknown>;
  const fullName = str(a.fullName);
  const phone = str(a.phone);
  return {
    firstName: fullName ? fullName.trim().split(/\s+/)[0] : null,
    city: str(a.city),
    state: str(a.state),
    pincode: str(a.pincode),
    phone: phone ? maskPhone(phone) : null,
  };
}

/** The order — only if it belongs to the verified customer. */
export async function getOwnedOrder(orderId: string, customerId: string): Promise<Order | null> {
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)));
  return o ?? null;
}

export type CustomerOrderSummary = {
  id: string;
  placedAt: string;
  status: string;
  statusLabel: string;
  totalInr: number;
  itemCount: number;
  firstItemName: string | null;
};

/** The verified customer's recent orders (abandoned checkouts excluded). */
export async function listCustomerOrders(customerId: string, limit = 10): Promise<CustomerOrderSummary[]> {
  const rows = await db
    .select({ id: orders.id, placedAt: orders.placedAt, status: orders.status, totalInr: orders.totalInr, items: orders.items })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), ne(orders.status, "ABANDONED")))
    .orderBy(desc(orders.placedAt))
    .limit(limit);
  return rows.map((r) => {
    const items = orderItems(r);
    return {
      id: r.id,
      placedAt: r.placedAt.toISOString(),
      status: r.status,
      statusLabel: ORDER_STATUS_CUSTOMER[r.status] ?? r.status,
      totalInr: r.totalInr,
      itemCount: items.reduce((n, it) => n + it.qty, 0),
      firstItemName: items[0]?.name ?? null,
    };
  });
}

/** Tickets raised about one order by its (verified) owner. */
export async function listOrderTickets(orderId: string, customerId: string) {
  return db
    .select({
      number: supportTickets.number,
      subject: supportTickets.subject,
      status: supportTickets.status,
      createdAt: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.orderId, orderId), eq(supportTickets.customerId, customerId)))
    .orderBy(desc(supportTickets.createdAt))
    .limit(20);
}

/** Attachment + the ticket it belongs to, for the evidence route's access check. */
export async function getAttachmentAccess(id: string) {
  const [row] = await db
    .select({
      storagePath: supportTicketAttachments.storagePath,
      mimeType: supportTicketAttachments.mimeType,
      ticketId: supportTickets.id,
      ticketNumber: supportTickets.number,
      ticketCustomerId: supportTickets.customerId,
    })
    .from(supportTicketAttachments)
    .innerJoin(supportTickets, eq(supportTickets.id, supportTicketAttachments.ticketId))
    .where(eq(supportTicketAttachments.id, id));
  return row ?? null;
}

/** Published articles by slug, in the order given (missing / draft ones dropped). */
export async function getPublishedArticlesBySlugs(slugs: string[]) {
  const wanted = slugs.filter((s) => /^[a-z0-9-]{1,80}$/.test(s)).slice(0, 8);
  if (!wanted.length) return [];
  const rows = await db
    .select({ slug: helpArticles.slug, title: helpArticles.title, summary: helpArticles.summary })
    .from(helpArticles)
    .where(and(inArray(helpArticles.slug, wanted), eq(helpArticles.status, "PUBLISHED")));
  return wanted.map((s) => rows.find((r) => r.slug === s)).filter((r): r is (typeof rows)[number] => !!r);
}

// ---------------------------------------------------------------------------
// Customer wording
// ---------------------------------------------------------------------------

export const ORDER_STATUS_CUSTOMER: Record<string, string> = {
  PENDING: "Awaiting payment",
  PENDING_COD_VERIFICATION: "Awaiting confirmation call",
  PAID: "Confirmed — being packed",
  PACKED: "Packed — waiting for courier pickup",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
  FAILED: "Payment failed",
  ABANDONED: "Not completed",
};

const METHOD_LABEL: Record<string, string> = {
  UPI: "UPI",
  CARD: "Card",
  NETBANKING: "Net banking",
  WALLET: "Wallet",
  COD: "Cash on delivery",
};

/** One plain line about the money side of the order. */
export function paymentSummary(
  o: Pick<Order, "paymentMethod" | "paymentStatus" | "confirmationFeeInr" | "totalInr" | "status">,
): { label: string; detail: string | null } {
  const method = METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod;
  if (o.paymentStatus === "REFUNDED") return { label: "Refunded", detail: `Paid by ${method}` };
  if (o.paymentStatus === "PARTIALLY_REFUNDED") return { label: "Partly refunded", detail: `Paid by ${method}` };
  if (o.paymentMethod === "COD") {
    const balance = Math.max(0, o.totalInr - o.confirmationFeeInr);
    if (o.status === "DELIVERED") return { label: "Cash on delivery", detail: null };
    return o.confirmationFeeInr > 0
      ? { label: "Part paid online", detail: `Balance ₹${balance.toLocaleString("en-IN")} payable on delivery` }
      : { label: "Cash on delivery", detail: `₹${balance.toLocaleString("en-IN")} payable on delivery` };
  }
  if (o.paymentStatus === "CAPTURED") return { label: "Paid", detail: method };
  if (o.paymentStatus === "FAILED") return { label: "Payment failed", detail: method };
  return { label: "Payment pending", detail: method };
}
