/**
 * Admin status vocabulary — the ONE place that maps every status the admin
 * shows (order, payment, product, stock, customer segment) to a label and a
 * tone. Tones mean the same thing on every page (docs/admin-redesign/DESIGN.md):
 *   positive  = done / good          attention = needs someone to act
 *   negative  = problem / failed     info      = in progress / upcoming
 *   neutral   = inactive / parked
 * Pure and dependency-free, so client components can import it.
 */

import type { OrderStatus } from "@/lib/order-status";
import { LOW_STOCK_THRESHOLD } from "@/lib/stock-threshold";

export type Tone = "positive" | "attention" | "negative" | "info" | "neutral";

export const TONE_CLASS: Record<Tone, string> = {
  positive: "bg-tone-pos-bg text-tone-pos",
  attention: "bg-tone-warn-bg text-tone-warn",
  negative: "bg-tone-neg-bg text-tone-neg",
  info: "bg-tone-info-bg text-tone-info",
  neutral: "bg-tone-neutral-bg text-tone-neutral",
};

export const TONE_TEXT: Record<Tone, string> = {
  positive: "text-tone-pos",
  attention: "text-tone-warn",
  negative: "text-tone-neg",
  info: "text-tone-info",
  neutral: "text-tone-neutral",
};

export const TONE_DOT: Record<Tone, string> = {
  positive: "bg-tone-pos",
  attention: "bg-tone-warn",
  negative: "bg-tone-neg",
  info: "bg-tone-info",
  neutral: "bg-tone-neutral",
};

export type StatusMeta = { label: string; tone: Tone };

// ── Orders ─────────────────────────────────────────────────────────────────

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  PENDING: { label: "Payment pending", tone: "attention" },
  PENDING_COD_VERIFICATION: { label: "COD verify", tone: "attention" },
  PAID: { label: "Paid", tone: "positive" },
  PACKED: { label: "Packed", tone: "info" },
  SHIPPED: { label: "Shipped", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "positive" },
  CANCELLED: { label: "Cancelled", tone: "negative" },
  RETURNED: { label: "Returned", tone: "negative" },
  REFUNDED: { label: "Refunded", tone: "negative" },
  FAILED: { label: "Failed", tone: "negative" },
  ABANDONED: { label: "Abandoned", tone: "neutral" },
};

/** Unknown/future statuses degrade to a neutral pill with the raw value. */
export function orderStatusMeta(status: string): StatusMeta {
  return ORDER_STATUS_META[status as OrderStatus] ?? { label: status, tone: "neutral" };
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  UPI: "UPI",
  CARD: "Card",
  NETBANKING: "Netbanking",
  WALLET: "Wallet",
  COD: "COD",
};

const PAYMENT_STATUS_META: Record<string, StatusMeta> = {
  PENDING: { label: "Pending", tone: "attention" },
  CAPTURED: { label: "Captured", tone: "positive" },
  FAILED: { label: "Failed", tone: "negative" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "attention" },
};

/** Payment state as an operator reads it: COD that isn't captured is "to collect". */
export function paymentStateMeta(method: string, status: string): StatusMeta {
  if (method === "COD" && status === "PENDING") return { label: "Collect on delivery", tone: "neutral" };
  return PAYMENT_STATUS_META[status] ?? { label: status, tone: "neutral" };
}

// ── Products ───────────────────────────────────────────────────────────────

export type ProductStatus = "active" | "coming" | "hidden" | "draft" | "archived";

export const PRODUCT_STATUS_META: Record<ProductStatus, StatusMeta & { hint: string }> = {
  active: { label: "Active", tone: "positive", hint: "Visible and purchasable" },
  coming: { label: "Coming soon", tone: "info", hint: "Teaser tile, no buy button" },
  hidden: { label: "Hidden", tone: "neutral", hint: "Unreachable on the storefront (404)" },
  draft: { label: "Draft", tone: "neutral", hint: "Admin only — not on the storefront yet" },
  archived: { label: "Archived", tone: "neutral", hint: "Retired, kept for order history" },
};

export type StockState = "in" | "low" | "out" | "untracked";

export const STOCK_META: Record<StockState, StatusMeta> = {
  in: { label: "In stock", tone: "positive" },
  low: { label: "Low stock", tone: "attention" },
  out: { label: "Out of stock", tone: "negative" },
  untracked: { label: "No stock data", tone: "neutral" },
};

/** `null` stock means no inventory row exists — honest "no data", not zero. */
export function stockStateOf(stock: number | null, threshold = LOW_STOCK_THRESHOLD): StockState {
  if (stock === null) return "untracked";
  if (stock <= 0) return "out";
  if (stock <= threshold) return "low";
  return "in";
}

// ── Customers ──────────────────────────────────────────────────────────────

/** Lifetime value (paid orders) at or above which a customer is "high value". */
export const HIGH_VALUE_INR = 10_000;
/** No order for this many days → inactive. */
export const INACTIVE_DAYS = 90;
/** Joined within this many days → new. */
export const NEW_CUSTOMER_DAYS = 30;

export type CustomerSegment = "repeat" | "one-time" | "inactive" | "no-orders";

export const SEGMENT_META: Record<CustomerSegment, StatusMeta> = {
  repeat: { label: "Repeat", tone: "positive" },
  "one-time": { label: "One-time", tone: "neutral" },
  inactive: { label: "Inactive", tone: "attention" },
  "no-orders": { label: "No orders", tone: "neutral" },
};

export function customerSegmentOf(
  orderCount: number,
  lastOrderAt: Date | string | null,
  now: number,
): CustomerSegment {
  if (orderCount === 0 || !lastOrderAt) return "no-orders";
  const idleDays = (now - new Date(lastOrderAt).getTime()) / 86_400_000;
  if (idleDays > INACTIVE_DAYS) return "inactive";
  return orderCount >= 2 ? "repeat" : "one-time";
}
