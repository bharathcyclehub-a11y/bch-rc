/**
 * READ-ONLY 3-way check: Razorpay captured payments → DB order → Shiprocket order.
 *
 * For every CAPTURED Razorpay payment in the window, confirms the order row
 * exists in the DB in a paid state, and that the order exists in Shiprocket
 * (by the shiprocket_order_id stored on the row). Makes NO changes.
 *   Run: npx tsx --env-file=.env.prod scripts/verify-rzp-db-shiprocket.ts [days]
 */
import { db } from "../src/db";
import { orders } from "../src/db/schema";
import { razorpay } from "../src/lib/razorpay";
import { inArray } from "drizzle-orm";

type Pay = {
  id: string;
  order_id: string | null;
  status: string;
  amount: number;
  created_at: number;
  method?: string | null;
  contact?: string | null;
};

const DAYS = Number(process.argv[2] || 14);
const to = Math.floor(Date.now() / 1000);
const from = to - DAYS * 86400;
const SR = "https://apiv2.shiprocket.in/v1/external";

async function fetchAllPayments(): Promise<Pay[]> {
  const all: Pay[] = [];
  for (let skip = 0; ; skip += 100) {
    const page = (await razorpay.payments.all({ from, to, count: 100, skip })) as { items: Pay[] };
    all.push(...(page.items ?? []));
    if ((page.items ?? []).length < 100) break;
  }
  return all;
}

async function srToken(): Promise<string> {
  const res = await fetch(`${SR}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Shiprocket login failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

async function srOrder(token: string, id: string) {
  const res = await fetch(`${SR}/orders/show/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { found: false, detail: `HTTP ${res.status}` };
  const d = ((await res.json()) as { data?: Record<string, unknown> }).data;
  if (!d) return { found: false, detail: "no data" };
  const ship = (d.shipments as { awb?: string; courier?: string } | undefined) ?? {};
  return {
    found: true,
    detail: `${d.status ?? "?"} | channel=${d.channel_order_id ?? "?"} | awb=${ship.awb || "-"} ${ship.courier ?? ""}`.trim(),
  };
}

const PAID_OK = new Set(["PAID", "PACKED", "SHIPPED", "DELIVERED", "PENDING_COD_VERIFICATION"]);

async function main() {
  const payments = await fetchAllPayments();
  const captured = payments.filter((p) => p.status === "captured");
  console.log(`Razorpay, last ${DAYS} days: ${payments.length} payments, ${captured.length} captured\n`);

  const rzpIds = [...new Set(captured.map((p) => p.order_id).filter(Boolean))] as string[];
  const rows = rzpIds.length
    ? await db
        .select({
          id: orders.id,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          paymentMethod: orders.paymentMethod,
          totalInr: orders.totalInr,
          confirmationFeeInr: orders.confirmationFeeInr,
          razorpayOrderId: orders.razorpayOrderId,
          shiprocketOrderId: orders.shiprocketOrderId,
          awbCode: orders.awbCode,
        })
        .from(orders)
        .where(inArray(orders.razorpayOrderId, rzpIds))
    : [];
  const byRzp = new Map(rows.map((r) => [r.razorpayOrderId!, r]));
  const token = await srToken();

  const issues: string[] = [];
  let allGood = 0;
  for (const p of captured.sort((a, b) => b.created_at - a.created_at)) {
    const when = new Date(p.created_at * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const amt = `₹${(p.amount / 100).toFixed(0)}`;
    const o = p.order_id ? byRzp.get(p.order_id) : undefined;
    if (!o) {
      console.log(`✗ ${when} ${p.id} ${amt} ${p.contact ?? ""} → NOT IN DB (rzpOrder=${p.order_id})`);
      issues.push(`${p.id}: captured but no DB order`);
      continue;
    }
    const expected =
      o.paymentMethod === "COD" && (o.confirmationFeeInr ?? 0) > 0 ? o.confirmationFeeInr : o.totalInr;
    const probs: string[] = [];
    if (!PAID_OK.has(o.status)) probs.push(`DB status ${o.status}/${o.paymentStatus}`);
    if (p.amount !== expected * 100) probs.push(`amount paid ${amt} ≠ expected ₹${expected}`);
    let sr = "no shiprocket_order_id";
    if (o.shiprocketOrderId) {
      const r = await srOrder(token, o.shiprocketOrderId);
      sr = r.detail;
      if (!r.found) probs.push(`Shiprocket order ${o.shiprocketOrderId} not found (${r.detail})`);
    } else probs.push("not pushed to Shiprocket");

    console.log(
      `${probs.length ? "✗" : "✓"} ${when} ${o.id} ${amt} ${o.paymentMethod} DB=${o.status} | SR ${o.shiprocketOrderId ?? "-"}: ${sr}`,
    );
    if (probs.length) issues.push(`${o.id}: ${probs.join("; ")}`);
    else allGood++;
  }

  console.log(`\nSUMMARY: ${captured.length} captured | ${allGood} fully matched | ${issues.length} with issues`);
  for (const i of issues) console.log(`  - ${i}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
