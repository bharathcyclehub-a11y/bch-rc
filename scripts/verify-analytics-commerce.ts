import assert from "node:assert/strict";
import { aggregatePaymentOutcomes, aggregateProductSales } from "../src/lib/analytics-commerce";
import { ALL_ORDER_STATUSES } from "../src/lib/order-status";

const sale = aggregateProductSales([
  { items: [{ skuId: "car", name: "Car", qty: 2, lineTotalInr: 1000 }] },
  { items: [{ skuId: "car", qty: "3", lineTotalInr: "1500" }] },
  { items: { skuId: "malformed" } },
  { items: [null, { skuId: "bad", qty: -1, lineTotalInr: 400 }, { skuId: "bad", qty: 1, lineTotalInr: null }] },
]);
assert.deepEqual(sale.products.get("car"), { name: "Car", qty: 5, revenue: 2500 });
assert.equal(sale.products.size, 1);
assert.equal(sale.invalidRecords, 4, "Malformed data must be counted, not crash or become revenue");
const outcomes = aggregatePaymentOutcomes([
  ...ALL_ORDER_STATUSES.map((status) => ({ method: "COD", status, count: 1 })),
  { method: "CARD", status: "FUTURE_STATUS", count: 3 },
]);
assert.equal(outcomes.find((m) => m.method === "COD")?.returned, 1);
assert.equal(outcomes.find((m) => m.method === "COD")?.refunded, 1);
assert.equal(outcomes.find((m) => m.method === "CARD")?.other, 3);
for (const { method, attempts, ...counts } of outcomes) {
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), attempts, `${method}: outcome categories reconcile with attempts`);
}
console.log("Commerce reporting checks passed: numeric item totals, malformed-record visibility, and complete payment outcome accounting.");
