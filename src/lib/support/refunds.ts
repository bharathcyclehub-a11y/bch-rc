/**
 * Refund cases — the only path that moves customer money back.
 *
 * Safety rules:
 *   - a refund is PROCESSED only when Razorpay says so (refund.processed
 *     webhook, or an API read-back with status "processed"); a COD bank/UPI
 *     payout (method MANUAL) is PROCESSED only when finance records its
 *     transfer reference — and is labelled as such;
 *   - approval/execution needs "refunds.approve" (OWNER, FINANCE) — callers
 *     check it; support agents can only REQUEST;
 *   - double refunds are blocked three ways: a unique idempotency key per
 *     request, a row lock on the order while checking the refundable balance,
 *     and an atomic REQUESTED → PROCESSING claim before calling Razorpay;
 *   - an ambiguous Razorpay failure (network/5xx) stays PROCESSING with
 *     "outcome unknown" until reconciled — it is never retried blindly.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, refundCases, supportTicketEvents, supportTickets, type RefundCaseRow } from "@/db/schema";
import { razorpay } from "@/lib/razorpay";
import { alertOps } from "@/lib/alert";
import { releaseOrderHoldsBestEffort } from "@/lib/inventory/release";
import { sendCustomerNotice } from "@/lib/notifications/customer-notice";
import { logError } from "@/lib/logger";

export class RefundError extends Error {}

/**
 * The two Razorpay calls refunds make, behind one seam so tests can replace
 * them without touching the SDK (scripts/tests/support.integration.test.ts).
 */
export const refundGateway = {
  refund: (paymentId: string, params: { amount: number; speed: "normal"; receipt: string; notes: Record<string, string> }) =>
    razorpay.payments.refund(paymentId, params) as Promise<unknown>,
  listRefunds: (paymentId: string) => razorpay.payments.fetchMultipleRefund(paymentId, { count: 100 }) as Promise<unknown>,
};

const ACTIVE = ["REQUESTED", "APPROVED", "PROCESSING", "PROCESSED"] as const;

type OrderRow = typeof orders.$inferSelect;

/** Money we can return through Razorpay for this order (₹). */
export function onlineRefundable(o: Pick<OrderRow, "paymentMethod" | "paymentStatus" | "totalInr" | "confirmationFeeInr" | "razorpayPaymentId">): number {
  if (!o.razorpayPaymentId) return 0;
  if (!["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.paymentStatus)) return 0;
  return o.paymentMethod === "COD" ? o.confirmationFeeInr : o.totalInr;
}

async function audit(c: Pick<RefundCaseRow, "orderId" | "ticketId" | "id" | "amountInr">, type: string, actor: string, payload: Record<string, unknown> = {}) {
  const [o] = await db.select({ siteId: orders.siteId, customerId: orders.customerId }).from(orders).where(eq(orders.id, c.orderId));
  await db.insert(events).values({
    siteId: o?.siteId ?? null,
    orderId: c.orderId,
    customerId: o?.customerId ?? null,
    type,
    payload: { refundCaseId: c.id, amountInr: c.amountInr, actor, ...payload },
    source: actor === "webhook" ? "webhook" : actor === "system" ? "system" : "admin",
  });
  if (c.ticketId) await db.insert(supportTicketEvents).values({ ticketId: c.ticketId, type, actor, payload: { refundCaseId: c.id, amountInr: c.amountInr, ...payload } });
}

export async function requestRefund(input: {
  orderId: string;
  amountInr: number;
  reason: string;
  method: "RAZORPAY" | "MANUAL";
  requestedBy: string;
  idempotencyKey: string;
  ticketId?: string | null;
  claimId?: string | null;
}): Promise<RefundCaseRow> {
  const amount = Math.round(input.amountInr);
  if (!Number.isFinite(amount) || amount <= 0) throw new RefundError("Enter a refund amount above ₹0.");
  if (input.reason.trim().length < 5) throw new RefundError("Give a reason for the refund.");
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(input.idempotencyKey)) throw new RefundError("Missing request key — reload the page.");

  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!o) throw new RefundError("Order not found.");
    const [dup] = await tx.select().from(refundCases).where(eq(refundCases.idempotencyKey, input.idempotencyKey));
    if (dup) return dup;

    const existing = await tx
      .select({ method: refundCases.method, amount: refundCases.amountInr })
      .from(refundCases)
      .where(and(eq(refundCases.orderId, o.id), inArray(refundCases.status, [...ACTIVE])));
    const committed = existing.reduce((s, r) => s + r.amount, 0);
    const committedOnline = existing.filter((r) => r.method === "RAZORPAY").reduce((s, r) => s + r.amount, 0);
    if (input.method === "RAZORPAY") {
      const room = onlineRefundable(o) - committedOnline;
      if (room <= 0) throw new RefundError("Nothing left to refund online for this order (no captured payment, or already refunded).");
      if (amount > room) throw new RefundError(`At most ₹${room.toLocaleString("en-IN")} can be refunded online.`);
    }
    if (committed + amount > o.totalInr) {
      throw new RefundError(`That would refund more than the order total (₹${o.totalInr.toLocaleString("en-IN")}, ₹${committed.toLocaleString("en-IN")} already requested).`);
    }

    const [row] = await tx
      .insert(refundCases)
      .values({
        orderId: o.id,
        ticketId: input.ticketId ?? null,
        claimId: input.claimId ?? null,
        amountInr: amount,
        reason: input.reason.trim().slice(0, 500),
        method: input.method,
        status: "REQUESTED",
        idempotencyKey: input.idempotencyKey,
        requestedBy: input.requestedBy,
        razorpayPaymentId: input.method === "RAZORPAY" ? o.razorpayPaymentId : null,
      })
      .returning();
    return row;
  }).then(async (row) => {
    await audit(row, "REFUND_REQUESTED", input.requestedBy, { method: row.method, reason: row.reason });
    return row;
  });
}

async function contactFor(c: RefundCaseRow) {
  if (c.ticketId) {
    const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, c.ticketId));
    if (t) return { siteId: t.siteId, customerId: t.customerId, email: t.contactEmail, phone: t.contactPhone, number: t.number };
  }
  const [o] = await db.select().from(orders).where(eq(orders.id, c.orderId));
  const a = (o?.shippingAddress ?? {}) as { email?: string | null; phone?: string | null };
  return { siteId: o?.siteId ?? "prc", customerId: o?.customerId ?? null, email: a.email ?? null, phone: a.phone ?? null, number: null };
}

async function notice(c: RefundCaseRow, kind: "REFUND_INITIATED" | "REFUND_CONFIRMED") {
  const who = await contactFor(c);
  const amount = `₹${c.amountInr.toLocaleString("en-IN")}`;
  await sendCustomerNotice({
    kind,
    dedupKey: `refund:${c.id}:${kind}`,
    siteId: who.siteId,
    orderId: c.orderId,
    customerId: who.customerId,
    email: who.email,
    phone: who.phone,
    subject: kind === "REFUND_CONFIRMED" ? `Refund of ${amount} completed for ${c.orderId}` : `Refund of ${amount} started for ${c.orderId}`,
    lines:
      kind === "REFUND_CONFIRMED"
        ? [
            c.method === "MANUAL"
              ? `We've sent ${amount} to your bank account / UPI ID. Transfer reference: ${c.manualReference ?? "—"}.`
              : `Razorpay has confirmed your refund of ${amount}. Reference: ${c.razorpayRefundId ?? "—"}. Banks usually show it within 5–7 working days.`,
          ]
        : [`We've started a refund of ${amount} to your original payment method. Reference: ${c.razorpayRefundId ?? "—"}. We'll email you again when the bank confirms it.`],
  });
}

/** Bring the order's payment status in line with CONFIRMED refunds. */
async function syncOrderPaymentState(orderId: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return;
  const done = await db
    .select({ amount: refundCases.amountInr })
    .from(refundCases)
    .where(and(eq(refundCases.orderId, orderId), eq(refundCases.status, "PROCESSED")));
  const refunded = done.reduce((s, r) => s + r.amount, 0);
  if (refunded <= 0) return;
  const full = refunded >= o.totalInr;
  await db
    .update(orders)
    .set({
      paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
      ...(full && o.status !== "REFUNDED" ? { status: "REFUNDED" as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
  if (full) await releaseOrderHoldsBestEffort(orderId, "REFUNDED");
}

async function markProcessed(c: RefundCaseRow, providerStatus: string, actor: string) {
  const [u] = await db
    .update(refundCases)
    .set({ status: "PROCESSED", providerStatus, providerConfirmedAt: new Date(), failureReason: null, updatedAt: new Date() })
    .where(and(eq(refundCases.id, c.id), inArray(refundCases.status, ["APPROVED", "PROCESSING"])))
    .returning();
  if (!u) return;
  await audit(u, "REFUND_CONFIRMED", actor, { providerStatus, refundId: u.razorpayRefundId, manualReference: u.manualReference });
  await syncOrderPaymentState(u.orderId);
  await notice(u, "REFUND_CONFIRMED");
}

/** Razorpay SDK errors carry statusCode; 4xx = Razorpay definitively refused. */
function definitiveRefusal(err: unknown): string | null {
  const e = err as { statusCode?: number; error?: { description?: string } };
  return e?.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? (e.error?.description ?? `Razorpay ${e.statusCode}`) : null;
}

export async function approveRefund(c: RefundCaseRow, financeEmail: string): Promise<RefundCaseRow> {
  if (c.status !== "REQUESTED") throw new RefundError(`This refund is already ${c.status.toLowerCase()}.`);
  if (c.method === "MANUAL") {
    const [u] = await db
      .update(refundCases)
      .set({ status: "APPROVED", approvedBy: financeEmail, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(refundCases.id, c.id), eq(refundCases.status, "REQUESTED")))
      .returning();
    if (!u) throw new RefundError("Someone else just updated this refund — reload.");
    await audit(u, "REFUND_APPROVED", financeEmail, { method: "MANUAL" });
    return u;
  }
  if (!c.razorpayPaymentId) throw new RefundError("No Razorpay payment on this order.");

  // Claim the case BEFORE calling Razorpay: only one approver can get here.
  const [claimed] = await db
    .update(refundCases)
    .set({ status: "PROCESSING", approvedBy: financeEmail, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(refundCases.id, c.id), eq(refundCases.status, "REQUESTED")))
    .returning();
  if (!claimed) throw new RefundError("Someone else just approved this refund.");
  await audit(claimed, "REFUND_APPROVED", financeEmail, { method: "RAZORPAY" });

  let r: { id: string; status?: string };
  try {
    r = (await refundGateway.refund(claimed.razorpayPaymentId!, {
      amount: claimed.amountInr * 100,
      speed: "normal",
      receipt: claimed.id.slice(0, 40),
      notes: { refund_case_id: claimed.id, order_id: claimed.orderId, approved_by: financeEmail },
    })) as { id: string; status?: string };
  } catch (err) {
    const refusal = definitiveRefusal(err);
    const [u] = await db
      .update(refundCases)
      .set(
        refusal
          ? { status: "FAILED", failureReason: refusal.slice(0, 300), updatedAt: new Date() }
          : { failureReason: "Outcome unknown (network/Razorpay error) — use “Check with Razorpay” before retrying.", updatedAt: new Date() },
      )
      .where(eq(refundCases.id, claimed.id))
      .returning();
    logError("support:refund", err, { refundCaseId: claimed.id, orderId: claimed.orderId });
    await audit(u, refusal ? "REFUND_FAILED" : "REFUND_OUTCOME_UNKNOWN", financeEmail, { error: refusal ?? "unknown" });
    if (!refusal) {
      await alertOps({ scope: "refunds", message: `Refund ${claimed.id} for ${claimed.orderId}: Razorpay outcome unknown — reconcile`, orderId: claimed.orderId });
    }
    throw new RefundError(refusal ? `Razorpay refused the refund: ${refusal}` : "Razorpay didn't answer clearly. The refund is held as PROCESSING — use “Check with Razorpay”.");
  }

  // Razorpay ACCEPTED the refund. Anything failing from here is ours: the
  // case stays PROCESSING and "Check with Razorpay" (which matches on
  // notes.refund_case_id) repairs it — never call Razorpay again for it.
  try {
    const [u] = await db
      .update(refundCases)
      .set({ razorpayRefundId: r.id, providerStatus: r.status ?? "pending", failureReason: null, updatedAt: new Date() })
      .where(eq(refundCases.id, claimed.id))
      .returning();
    await audit(u, "REFUND_INITIATED", financeEmail, { refundId: r.id, providerStatus: r.status });
    if (r.status === "processed") await markProcessed(u, "processed", "razorpay-api");
    else await notice(u, "REFUND_INITIATED");
  } catch (err) {
    logError("support:refund-record", err, { refundCaseId: claimed.id, orderId: claimed.orderId });
    await alertOps({
      scope: "refunds",
      message: `Razorpay accepted refund ${r.id} for ${claimed.orderId} but recording it failed — run "Check with Razorpay"`,
      orderId: claimed.orderId,
    });
    throw new RefundError(`Razorpay accepted the refund (${r.id}) but we couldn't record it. Don't retry — use “Check with Razorpay”.`);
  }
  const [fresh] = await db.select().from(refundCases).where(eq(refundCases.id, claimed.id));
  return fresh;
}

/** Finance records a COD bank/UPI payout. */
export async function recordManualRefund(c: RefundCaseRow, financeEmail: string, reference: string) {
  if (c.method !== "MANUAL") throw new RefundError("Only manual refunds take a transfer reference.");
  if (c.status !== "APPROVED") throw new RefundError("Approve the refund first.");
  const ref = reference.trim();
  if (!/^[A-Za-z0-9 ._/-]{6,60}$/.test(ref)) throw new RefundError("Enter the bank/UPI transaction reference (UTR).");
  const [u] = await db
    .update(refundCases)
    .set({ manualReference: ref, updatedAt: new Date() })
    .where(and(eq(refundCases.id, c.id), eq(refundCases.status, "APPROVED")))
    .returning();
  if (!u) throw new RefundError("Someone else just updated this refund — reload.");
  await markProcessed(u, "manual-transfer-recorded", financeEmail);
}

export async function rejectRefund(c: RefundCaseRow, email: string, reason: string) {
  if (!["REQUESTED", "APPROVED"].includes(c.status)) throw new RefundError("This refund can't be rejected now.");
  if (reason.trim().length < 5) throw new RefundError("Give a reason.");
  const [u] = await db
    .update(refundCases)
    .set({ status: "REJECTED", failureReason: reason.trim(), updatedAt: new Date() })
    .where(and(eq(refundCases.id, c.id), inArray(refundCases.status, ["REQUESTED", "APPROVED"])))
    .returning();
  if (u) await audit(u, "REFUND_REJECTED", email, { reason });
}

/** Read the truth back from Razorpay (for "outcome unknown" or a missed webhook). */
export async function reconcileRefund(c: RefundCaseRow, actor: string): Promise<string> {
  if (c.method !== "RAZORPAY" || !c.razorpayPaymentId) return "Not a Razorpay refund.";
  const list = (await refundGateway.listRefunds(c.razorpayPaymentId)) as {
    items?: Array<{ id: string; status: string; amount: number; notes?: Record<string, string> }>;
  };
  const match = (list.items ?? []).find((r) => r.id === c.razorpayRefundId || r.notes?.refund_case_id === c.id);
  if (!match) {
    if (c.status === "PROCESSING" && !c.razorpayRefundId) {
      await db
        .update(refundCases)
        .set({ status: "FAILED", failureReason: "Razorpay has no refund for this case — safe to request again.", updatedAt: new Date() })
        .where(eq(refundCases.id, c.id));
      await audit(c, "REFUND_RECONCILED", actor, { found: false });
      return "Razorpay has no such refund — marked failed; you can request it again.";
    }
    return "Razorpay hasn't recorded this refund yet.";
  }
  await db
    .update(refundCases)
    .set({ razorpayRefundId: match.id, providerStatus: match.status, updatedAt: new Date() })
    .where(eq(refundCases.id, c.id));
  await audit(c, "REFUND_RECONCILED", actor, { refundId: match.id, providerStatus: match.status });
  const [fresh] = await db.select().from(refundCases).where(eq(refundCases.id, c.id));
  if (match.status === "processed") {
    await markProcessed(fresh, "processed", "razorpay-api");
    return "Razorpay confirms the refund is processed.";
  }
  if (match.status === "failed") {
    await db.update(refundCases).set({ status: "FAILED", failureReason: "Razorpay reports the refund failed.", updatedAt: new Date() }).where(eq(refundCases.id, c.id));
    return "Razorpay reports the refund failed.";
  }
  return `Razorpay status: ${match.status}.`;
}

/**
 * Verified Razorpay refund webhook. Returns true when it matched a refund
 * case; false lets the caller apply its legacy handling for refunds made
 * outside the support centre (e.g. in the Razorpay dashboard).
 */
export async function applyRazorpayRefundEvent(
  eventName: string,
  refund: { id: string; payment_id: string; amount: number; status?: string; notes?: Record<string, string> },
): Promise<boolean> {
  const [c] = await db
    .select()
    .from(refundCases)
    .where(
      refund.notes?.refund_case_id && /^[0-9a-f-]{36}$/i.test(refund.notes.refund_case_id)
        ? eq(refundCases.id, refund.notes.refund_case_id)
        : eq(refundCases.razorpayRefundId, refund.id),
    );
  if (!c) return false;
  if (!c.razorpayRefundId) {
    await db.update(refundCases).set({ razorpayRefundId: refund.id, updatedAt: new Date() }).where(eq(refundCases.id, c.id));
  }
  const [fresh] = await db.select().from(refundCases).where(eq(refundCases.id, c.id));
  if (eventName === "refund.processed") await markProcessed(fresh, "processed", "webhook");
  else if (eventName === "refund.failed") {
    await db
      .update(refundCases)
      .set({ status: "FAILED", providerStatus: "failed", failureReason: "Razorpay reported the refund failed.", updatedAt: new Date() })
      .where(and(eq(refundCases.id, c.id), sql`${refundCases.status} <> 'PROCESSED'`));
    await audit(fresh, "REFUND_FAILED", "webhook", { refundId: refund.id });
    await alertOps({ scope: "refunds", message: `Razorpay refund ${refund.id} FAILED for ${c.orderId}`, orderId: c.orderId });
  } else {
    await db.update(refundCases).set({ providerStatus: refund.status ?? "created", updatedAt: new Date() }).where(eq(refundCases.id, c.id));
  }
  return true;
}

export async function getRefundCase(id: string) {
  const [c] = await db.select().from(refundCases).where(eq(refundCases.id, id));
  return c ?? null;
}
