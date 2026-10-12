"use server";

/**
 * Ticket desk server actions. Every action:
 *   1. re-checks its permission on the server (a hidden button is never the control);
 *   2. scopes the row to the operator's sites (ticket.siteId / order.siteId);
 *   3. calls the support service (tickets.ts / claims.ts / refunds.ts), which
 *      owns the rules and writes the audit trail;
 *   4. returns { ok, error } — never throws to the client.
 *
 *   reply / internal note       support.reply
 *   status change, escalate     support.reply
 *   assign, priority change     support.assign
 *   claim decision              claims.decide
 *   claim shipment / received / complete   claims.fulfil
 *   refund request              refunds.request
 *   refund approve / transfer / reject / reconcile   refunds.approve (OWNER, FINANCE)
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { admins, orders, type RefundCaseRow, type SupportClaimRow, type SupportTicketRow } from "@/db/schema";
import { requireAdmin, type AdminContext } from "@/lib/admin-auth";
import { can, type AdminPermission } from "@/lib/admin/permissions";
import { logError } from "@/lib/logger";
import { isMissingTableError, isUuid, liveStock } from "@/lib/support/admin-queries";
import {
  ClaimError,
  completeClaim,
  decideClaim,
  getClaim,
  markReturnReceived,
  recordClaimShipment,
} from "@/lib/support/claims";
import { loadPolicy } from "@/lib/support/config";
import { EvidenceError } from "@/lib/support/evidence";
import {
  approveRefund,
  getRefundCase,
  reconcileRefund,
  recordManualRefund,
  rejectRefund,
  RefundError,
  requestRefund,
} from "@/lib/support/refunds";
import { canStaffMove, isTicketStatus, type Priority, type TicketStatus } from "@/lib/support/rules";
import {
  assignTicket,
  escalateTicket,
  getTicketById,
  setTicketPriority,
  setTicketStatus,
  staffReply,
  TicketError,
} from "@/lib/support/tickets";

export type DeskResult = { ok: true; message?: string } | { ok: false; error: string; code?: "OUT_OF_STOCK" };

const DENIED = (what: string): DeskResult => ({ ok: false, error: `Your role can't ${what}.` });
const NOT_FOUND: DeskResult = { ok: false, error: "That ticket no longer exists or isn't on your stores." };
const PRIORITY_VALUES: readonly Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

async function gate(permission: AdminPermission): Promise<AdminContext | null> {
  const ctx = await requireAdmin();
  return can(ctx.role, permission) ? ctx : null;
}

async function scopedTicket(ctx: AdminContext, ticketId: string): Promise<SupportTicketRow | null> {
  if (!isUuid(ticketId)) return null;
  const t = await getTicketById(ticketId);
  return t && ctx.siteIds.includes(t.siteId) ? t : null;
}

async function scopedClaim(ctx: AdminContext, claimId: string): Promise<{ claim: SupportClaimRow; ticket: SupportTicketRow } | null> {
  if (!isUuid(claimId)) return null;
  const claim = await getClaim(claimId);
  if (!claim) return null;
  const ticket = await scopedTicket(ctx, claim.ticketId);
  return ticket ? { claim, ticket } : null;
}

async function scopedRefund(ctx: AdminContext, refundId: string): Promise<RefundCaseRow | null> {
  if (!isUuid(refundId)) return null;
  const c = await getRefundCase(refundId);
  if (!c) return null;
  const [o] = await db.select({ siteId: orders.siteId }).from(orders).where(eq(orders.id, c.orderId));
  return o && ctx.siteIds.includes(o.siteId) ? c : null;
}

function refresh(ticketId: string | null, orderId?: string | null) {
  if (ticketId) revalidatePath(`/admin/support/tickets/${ticketId}`);
  revalidatePath("/admin/support/tickets");
  revalidatePath("/admin/support");
  if (orderId) revalidatePath(`/admin/orders/${orderId}`);
}

function fail(scope: string, err: unknown, fallback = "Something went wrong — try again."): DeskResult {
  if (err instanceof TicketError || err instanceof ClaimError || err instanceof RefundError || err instanceof EvidenceError) {
    return { ok: false, error: err.message };
  }
  if (isMissingTableError(err)) return { ok: false, error: "The support centre isn't set up yet — apply the support migration." };
  logError(scope, err);
  return { ok: false, error: fallback };
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ── Conversation ────────────────────────────────────────────────────────────

export async function replyAction(fd: FormData): Promise<DeskResult> {
  const ctx = await gate("support.reply");
  if (!ctx) return DENIED("reply to tickets");
  try {
    const ticket = await scopedTicket(ctx, String(fd.get("ticketId") ?? ""));
    if (!ticket) return NOT_FOUND;
    const internal = fd.get("internal") === "1";
    const body = clean(fd.get("body"), 6000);
    const rawStatus = String(fd.get("setStatus") ?? "");
    let setStatus: TicketStatus | null = null;
    if (!internal && rawStatus) {
      if (!isTicketStatus(rawStatus) || !isTicketStatus(ticket.status) || !canStaffMove(ticket.status, rawStatus)) {
        return { ok: false, error: "That status isn't available from the ticket's current status." };
      }
      setStatus = rawStatus;
    }
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const { maxEvidenceFiles } = await loadPolicy();
    const maxFiles = Math.min(5, maxEvidenceFiles);
    if (files.length > maxFiles) return { ok: false, error: `Attach at most ${maxFiles} files per message.` };

    await staffReply(ticket, ctx.email, { body, internal, setStatus, files });
    refresh(ticket.id);
    return { ok: true, message: internal ? "Internal note added" : "Reply sent to the customer" };
  } catch (err) {
    return fail("admin:support:reply", err, "Couldn't send that — try again.");
  }
}

// ── Ticket state ────────────────────────────────────────────────────────────

export async function changeStatusAction(ticketId: string, to: string, note: string): Promise<DeskResult> {
  const ctx = await gate("support.reply");
  if (!ctx) return DENIED("change ticket status");
  try {
    const ticket = await scopedTicket(ctx, ticketId);
    if (!ticket) return NOT_FOUND;
    if (!isTicketStatus(to)) return { ok: false, error: "Unknown status." };
    await setTicketStatus(ticket, ctx.email, to, clean(note, 500) || undefined);
    refresh(ticket.id);
    return { ok: true, message: "Status updated" };
  } catch (err) {
    return fail("admin:support:status", err);
  }
}

export async function assignAction(ticketId: string, assignee: string | null): Promise<DeskResult> {
  const ctx = await gate("support.assign");
  if (!ctx) return DENIED("assign tickets");
  try {
    const ticket = await scopedTicket(ctx, ticketId);
    if (!ticket) return NOT_FOUND;
    let to: string | null = null;
    if (assignee) {
      const [a] = await db
        .select({ email: admins.email })
        .from(admins)
        .where(and(eq(admins.email, assignee.toLowerCase()), eq(admins.active, true)));
      if (!a) return { ok: false, error: "That person isn't an active admin." };
      to = a.email;
    }
    if ((ticket.assignedTo ?? null) === to) return { ok: true, message: "No change" };
    await assignTicket(ticket, ctx.email, to);
    refresh(ticket.id);
    return { ok: true, message: to ? `Assigned to ${to}` : "Unassigned" };
  } catch (err) {
    return fail("admin:support:assign", err);
  }
}

export async function changePriorityAction(ticketId: string, priority: string, reason: string): Promise<DeskResult> {
  const ctx = await gate("support.assign");
  if (!ctx) return DENIED("change priority");
  try {
    const ticket = await scopedTicket(ctx, ticketId);
    if (!ticket) return NOT_FOUND;
    if (!PRIORITY_VALUES.includes(priority as Priority)) return { ok: false, error: "Unknown priority." };
    const why = clean(reason, 180);
    if (why.length < 5) return { ok: false, error: "Give a short reason (it's shown to the team)." };
    await setTicketPriority(ticket, ctx.email, priority as Priority, why);
    refresh(ticket.id);
    return { ok: true, message: "Priority updated — SLA targets recalculated" };
  } catch (err) {
    return fail("admin:support:priority", err);
  }
}

export async function escalateAction(ticketId: string, reason: string): Promise<DeskResult> {
  const ctx = await gate("support.reply");
  if (!ctx) return DENIED("escalate tickets");
  try {
    const ticket = await scopedTicket(ctx, ticketId);
    if (!ticket) return NOT_FOUND;
    if (ticket.status === "CLOSED" || ticket.status === "RESOLVED") return { ok: false, error: "Reopen the ticket before escalating it." };
    const why = clean(reason, 300);
    if (why.length < 5) return { ok: false, error: "Say why it needs escalating." };
    await escalateTicket(ticket, ctx.email, why);
    refresh(ticket.id);
    return { ok: true, message: "Escalated — the team has been alerted" };
  } catch (err) {
    return fail("admin:support:escalate", err);
  }
}

// ── Claims ──────────────────────────────────────────────────────────────────

const DECISIONS = ["APPROVE", "REJECT", "NEEDS_INFO", "UNDER_REVIEW"] as const;

export async function decideClaimAction(
  claimId: string,
  decision: string,
  note: string,
  overrideStock: boolean,
): Promise<DeskResult> {
  const ctx = await gate("claims.decide");
  if (!ctx) return DENIED("decide claims");
  try {
    const found = await scopedClaim(ctx, claimId);
    if (!found) return { ok: false, error: "That claim isn't on your stores." };
    if (!(DECISIONS as readonly string[]).includes(decision)) return { ok: false, error: "Unknown decision." };
    await decideClaim(found.claim, ctx.email, decision as (typeof DECISIONS)[number], clean(note, 1000), {
      overrideStock: decision === "APPROVE" && overrideStock,
    });
    refresh(found.ticket.id, found.claim.orderId);
    return { ok: true, message: decision === "UNDER_REVIEW" ? "Marked under review" : "Decision sent to the customer" };
  } catch (err) {
    if (err instanceof ClaimError && /^Out of stock/.test(err.message)) {
      return { ok: false, error: err.message, code: "OUT_OF_STOCK" };
    }
    return fail("admin:support:claim-decide", err);
  }
}

export async function recordShipmentAction(claimId: string, awb: string, replacementOrderId: string): Promise<DeskResult> {
  const ctx = await gate("claims.fulfil");
  if (!ctx) return DENIED("record claim shipments");
  try {
    const found = await scopedClaim(ctx, claimId);
    if (!found) return { ok: false, error: "That claim isn't on your stores." };
    const awbClean = clean(awb, 40).replace(/\s+/g, "") || null;
    if (awbClean && !/^[A-Za-z0-9-]{6,40}$/.test(awbClean)) return { ok: false, error: "That AWB doesn't look right." };
    const replId = clean(replacementOrderId, 40).toUpperCase() || null;
    if (replId) {
      const [o] = await db.select({ siteId: orders.siteId }).from(orders).where(eq(orders.id, replId));
      if (!o || !ctx.siteIds.includes(o.siteId)) return { ok: false, error: `No order ${replId} on your stores.` };
    }
    await recordClaimShipment(found.claim, ctx.email, { awb: awbClean, replacementOrderId: replId });
    refresh(found.ticket.id, found.claim.orderId);
    return { ok: true, message: found.claim.type === "RETURN" ? "Return pickup recorded" : "Replacement shipment recorded" };
  } catch (err) {
    return fail("admin:support:claim-ship", err);
  }
}

export async function returnReceivedAction(claimId: string, conditionNote: string): Promise<DeskResult> {
  const ctx = await gate("claims.fulfil");
  if (!ctx) return DENIED("receive returns");
  try {
    const found = await scopedClaim(ctx, claimId);
    if (!found) return { ok: false, error: "That claim isn't on your stores." };
    await markReturnReceived(found.claim, ctx.email, clean(conditionNote, 1000));
    refresh(found.ticket.id, found.claim.orderId);
    return { ok: true, message: "Return marked received" };
  } catch (err) {
    return fail("admin:support:claim-received", err);
  }
}

export async function completeClaimAction(claimId: string): Promise<DeskResult> {
  const ctx = await gate("claims.fulfil");
  if (!ctx) return DENIED("complete claims");
  try {
    const found = await scopedClaim(ctx, claimId);
    if (!found) return { ok: false, error: "That claim isn't on your stores." };
    await completeClaim(found.claim, ctx.email);
    refresh(found.ticket.id, found.claim.orderId);
    return { ok: true, message: "Claim completed" };
  } catch (err) {
    return fail("admin:support:claim-complete", err);
  }
}

/** Read-only: current stock for the claim's first item (replacement availability). */
export async function checkStockAction(claimId: string): Promise<DeskResult> {
  const ctx = await gate("support.view");
  if (!ctx) return DENIED("view support");
  try {
    const found = await scopedClaim(ctx, claimId);
    if (!found) return { ok: false, error: "That claim isn't on your stores." };
    const item = ((found.claim.items as Array<{ skuId: string; variantSlug: string | null; name: string; qty: number }>) ?? [])[0];
    if (!item) return { ok: false, error: "This claim has no items." };
    const n = await liveStock(found.ticket.siteId, item.skuId, item.variantSlug);
    if (n == null) return { ok: true, message: `${item.name}: no inventory row — treat as out of stock.` };
    return { ok: true, message: `${item.name}: ${n} in stock now${n < item.qty ? ` (needs ${item.qty})` : ""}.` };
  } catch (err) {
    return fail("admin:support:stock", err);
  }
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export async function requestRefundAction(fd: FormData): Promise<DeskResult> {
  const ctx = await gate("refunds.request");
  if (!ctx) return DENIED("request refunds");
  try {
    const ticket = await scopedTicket(ctx, String(fd.get("ticketId") ?? ""));
    if (!ticket) return NOT_FOUND;
    if (!ticket.orderId) return { ok: false, error: "This ticket isn't linked to an order." };
    const method = String(fd.get("method") ?? "");
    if (method !== "RAZORPAY" && method !== "MANUAL") return { ok: false, error: "Choose how the money goes back." };
    const amount = Number(String(fd.get("amount") ?? "").replace(/[,\s₹]/g, ""));
    const claimId = String(fd.get("claimId") ?? "");
    let claim: string | null = null;
    if (claimId) {
      const found = await scopedClaim(ctx, claimId);
      if (!found || found.ticket.id !== ticket.id) return { ok: false, error: "That claim doesn't belong to this ticket." };
      claim = found.claim.id;
    }
    const row = await requestRefund({
      orderId: ticket.orderId,
      amountInr: amount,
      reason: clean(fd.get("reason"), 500),
      method,
      requestedBy: ctx.email,
      idempotencyKey: String(fd.get("idempotencyKey") ?? ""),
      ticketId: ticket.id,
      claimId: claim,
    });
    refresh(ticket.id, ticket.orderId);
    return { ok: true, message: `Refund of ₹${row.amountInr.toLocaleString("en-IN")} requested — finance will approve it` };
  } catch (err) {
    return fail("admin:support:refund-request", err);
  }
}

async function refundAction(
  refundId: string,
  ticketId: string,
  scope: string,
  run: (c: RefundCaseRow, ctx: AdminContext) => Promise<string>,
): Promise<DeskResult> {
  const ctx = await gate("refunds.approve");
  if (!ctx) return DENIED("approve or record refunds (owner / finance only)");
  try {
    const c = await scopedRefund(ctx, refundId);
    if (!c) return { ok: false, error: "That refund isn't on your stores." };
    const message = await run(c, ctx);
    refresh(isUuid(ticketId) ? ticketId : c.ticketId, c.orderId);
    return { ok: true, message };
  } catch (err) {
    // A Razorpay failure still changed the case (FAILED / outcome unknown) — show it.
    refresh(isUuid(ticketId) ? ticketId : null);
    return fail(scope, err);
  }
}

export async function approveRefundAction(refundId: string, ticketId: string): Promise<DeskResult> {
  return refundAction(refundId, ticketId, "admin:support:refund-approve", async (c, ctx) => {
    const u = await approveRefund(c, ctx.email);
    if (u.method === "MANUAL") return "Approved — make the bank/UPI transfer, then record its reference";
    if (u.status === "PROCESSED") return "Razorpay confirmed the refund";
    return `Sent to Razorpay${u.razorpayRefundId ? ` (${u.razorpayRefundId})` : ""} — waiting for Razorpay to confirm`;
  });
}

export async function recordTransferAction(refundId: string, ticketId: string, reference: string): Promise<DeskResult> {
  return refundAction(refundId, ticketId, "admin:support:refund-manual", async (c, ctx) => {
    await recordManualRefund(c, ctx.email, clean(reference, 60));
    return "Transfer reference recorded";
  });
}

export async function rejectRefundAction(refundId: string, ticketId: string, reason: string): Promise<DeskResult> {
  return refundAction(refundId, ticketId, "admin:support:refund-reject", async (c, ctx) => {
    await rejectRefund(c, ctx.email, clean(reason, 500));
    return "Refund rejected";
  });
}

export async function reconcileRefundAction(refundId: string, ticketId: string): Promise<DeskResult> {
  return refundAction(refundId, ticketId, "admin:support:refund-reconcile", (c, ctx) => reconcileRefund(c, ctx.email));
}
