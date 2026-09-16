import { PAID_STATUSES } from "./order-status";

export function aggregateProductSales(rows: Array<{ items: unknown }>) {
  const products = new Map<string, { name: string; qty: number; revenue: number }>();
  let invalidRecords = 0;
  for (const row of rows) {
    if (!Array.isArray(row.items) || row.items.length === 0) { invalidRecords++; continue; }
    for (const value of row.items) {
      if (!value || typeof value !== "object") { invalidRecords++; continue; }
      const item = value as Record<string, unknown>;
      const integer = (value: unknown) => typeof value === "number" ? value
        : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
      const qty = integer(item.qty), revenue = integer(item.lineTotalInr);
      if (typeof item.skuId !== "string" || !item.skuId.trim() || !Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(revenue) || revenue < 0) {
        invalidRecords++; continue;
      }
      const previous = products.get(item.skuId) ?? { name: typeof item.name === "string" ? item.name : item.skuId, qty: 0, revenue: 0 };
      products.set(item.skuId, { ...previous, qty: previous.qty + qty, revenue: previous.revenue + revenue });
    }
  }
  return { products, invalidRecords };
}

export type PaymentOutcome = {
  method: string; attempts: number; paid: number; failed: number; abandoned: number;
  cancelled: number; pending: number; returned: number; refunded: number; other: number;
};

/** Every order belongs to one outcome, including reversals and future statuses. */
export function aggregatePaymentOutcomes(rows: Array<{ method: string; status: string; count: number }>): PaymentOutcome[] {
  const paid = new Set<string>(PAID_STATUSES);
  const methods = new Map<string, PaymentOutcome>();
  for (const row of rows) {
    const result = methods.get(row.method) ?? { method: row.method, attempts: 0, paid: 0, failed: 0, abandoned: 0, cancelled: 0, pending: 0, returned: 0, refunded: 0, other: 0 };
    result.attempts += row.count;
    if (paid.has(row.status)) result.paid += row.count;
    else if (row.status === "FAILED") result.failed += row.count;
    else if (row.status === "ABANDONED") result.abandoned += row.count;
    else if (row.status === "CANCELLED") result.cancelled += row.count;
    else if (row.status === "PENDING" || row.status === "PENDING_COD_VERIFICATION") result.pending += row.count;
    else if (row.status === "RETURNED") result.returned += row.count;
    else if (row.status === "REFUNDED") result.refunded += row.count;
    else result.other += row.count;
    methods.set(row.method, result);
  }
  return [...methods.values()].sort((a, b) => b.attempts - a.attempts);
}
