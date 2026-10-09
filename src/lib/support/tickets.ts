/**
 * Support tickets — the one service behind the web form, the guided chat and
 * (later) WhatsApp / voice: every channel calls these functions, so rules,
 * audit trail and notifications are identical everywhere.
 *
 * Access model:
 *   - customers see a ticket when their verified session owns it, or with the
 *     secret link emailed at creation (only its SHA-256 is stored);
 *   - internal notes are never returned to customers;
 *   - every state change writes a support_ticket_events row (audit log).
 */

import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders,
  refundCases,
  shipmentTracking,
  supportClaims,
  supportTicketAttachments,
  supportTicketEvents,
  supportTicketMessages,
  supportTickets,
  type SupportTicketRow,
} from "@/db/schema";
import { alertOps } from "@/lib/alert";
import { sendCustomerNotice } from "@/lib/notifications/customer-notice";
import { logError } from "@/lib/logger";
import { raiseException } from "@/lib/tracking/exceptions";
import { getPublicTrackingView } from "@/lib/tracking/view";
import { getProductById } from "@/lib/products";
import { createClaimForTicket } from "./claims";
import { loadSla, REOPEN_WINDOW_DAYS } from "./config";
import { storeEvidence } from "./evidence";
import {
  OPEN_STATUSES,
  TICKET_CATEGORIES,
  TICKET_STATUS_LABEL,
  canStaffMove,
  computePriority,
  customerStage,
  higherPriority,
  isTicketStatus,
  slaDueDates,
  type Priority,
  type TicketCategory,
  type TicketStatus,
} from "./rules";
import { safeEqual } from "./session";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const code = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://pocketrccars.com").replace(/\/$/, "");

export class TicketError extends Error {}

export type Channel = "WEB" | "CHAT" | "WHATSAPP" | "VOICE" | "ADMIN";

const DELIVERY_CATEGORIES = new Set<TicketCategory>(["ORDER_NOT_RECEIVED", "DELIVERY_DELAYED", "INCORRECT_TRACKING"]);

export function ticketLink(number: string, token?: string | null): string {
  return `${SITE_URL}/support/tickets/${number}${token ? `?k=${encodeURIComponent(token)}` : ""}`;
}

async function logEvent(ticketId: string, type: string, actor: string, payload: Record<string, unknown> = {}) {
  await db.insert(supportTicketEvents).values({ ticketId, type, actor, payload });
}

export type CreateTicketInput = {
  category: TicketCategory;
  description: string;
  subject?: string | null;
  orderId?: string | null;
  skuId?: string | null;
  variantSlug?: string | null;
  contact: { name?: string | null; email?: string | null; phone?: string | null };
  /** Customer id from a verified support session (null for unverified). */
  verifiedCustomerId?: string | null;
  channel?: Channel;
  safetyFlag?: boolean;
  context?: Record<string, unknown>;
  /** "customer" or the staff email creating it on someone's behalf. */
  actor: string;
  files?: File[];
  now?: Date;
};

export type CreatedTicket = {
  id: string;
  number: string;
  accessToken: string;
  priority: Priority;
  status: TicketStatus;
  claimNumber: string | null;
};

export async function createTicket(input: CreateTicketInput): Promise<CreatedTicket> {
  const now = input.now ?? new Date();
  const cat = TICKET_CATEGORIES[input.category];
  const description = input.description.trim().slice(0, 4000);
  if (description.length < 10) throw new TicketError("Please describe the problem in a few words (at least 10 characters).");
  const staff = input.actor !== "customer";

  let order: typeof orders.$inferSelect | null = null;
  if (input.orderId) {
    [order] = await db.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw new TicketError("We couldn't find that order.");
    if (!staff && order.customerId !== input.verifiedCustomerId) {
      throw new TicketError("Please verify your order before raising a request about it.");
    }
  } else if (cat.needsOrder) {
    throw new TicketError("Please choose the order this is about.");
  }

  const addr = (order?.shippingAddress ?? {}) as { fullName?: string; email?: string | null; phone?: string | null };
  const contactEmail = (input.contact.email ?? addr.email ?? "").trim().toLowerCase() || null;
  const contactPhone = (input.contact.phone ?? addr.phone ?? "").trim() || null;
  const contactName = (input.contact.name ?? addr.fullName ?? "").trim() || null;
  if (!contactEmail && !contactPhone) throw new TicketError("Add an email or phone number so we can reply.");

  // Courier facts for the priority rules.
  let trackingDelivered = false;
  let estimateExpired = false;
  if (order && DELIVERY_CATEGORIES.has(input.category)) {
    const view = await getPublicTrackingView(order.id, now).catch(() => null);
    trackingDelivered = view?.orderState === "DELIVERED";
    estimateExpired = view?.facts.estimate.state === "EXPIRED";
  }
  const { priority, reason } = computePriority({
    category: input.category,
    description,
    safetyFlag: !!input.safetyFlag,
    trackingDelivered,
    estimateExpired,
  });
  const sla = await loadSla();
  const due = slaDueDates(priority, now, sla);
  const productName = input.skuId ? (getProductById(input.skuId)?.name ?? null) : null;
  const subject =
    (input.subject?.trim() || `${cat.label}${productName ? ` — ${productName}` : ""}`).slice(0, 140);
  const accessToken = randomBytes(18).toString("base64url");
  const safety = priority === "CRITICAL" && reason.startsWith("Possible safety");

  let ticket: SupportTicketRow | undefined;
  for (let i = 0; i < 5 && !ticket; i++) {
    [ticket] = await db
      .insert(supportTickets)
      .values({
        number: `T-${code(6)}`,
        siteId: order?.siteId ?? "prc",
        customerId: order?.customerId ?? input.verifiedCustomerId ?? null,
        orderId: order?.id ?? null,
        skuId: input.skuId ?? null,
        category: input.category,
        subject,
        status: "NEW",
        priority,
        priorityReason: reason,
        channel: input.channel ?? "WEB",
        contactName,
        contactEmail,
        contactPhone,
        identityVerified: !!order && (staff || order.customerId === input.verifiedCustomerId),
        accessTokenHash: sha256(accessToken),
        safetyFlag: safety,
        awaiting: "STAFF",
        firstResponseDueAt: due.firstResponseDueAt,
        resolutionDueAt: due.resolutionDueAt,
        lastCustomerMessageAt: staff ? null : now,
        context: { ...(input.context ?? {}), variantSlug: input.variantSlug ?? null },
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
  }
  if (!ticket) throw new Error("could not allocate a ticket number");

  const [message] = await db
    .insert(supportTicketMessages)
    .values({
      ticketId: ticket.id,
      authorType: staff ? "STAFF" : "CUSTOMER",
      authorName: staff ? input.actor : contactName,
      authorEmail: staff ? input.actor : contactEmail,
      body: description,
      createdAt: now,
    })
    .returning({ id: supportTicketMessages.id });
  await attachFiles(ticket.id, message.id, input.files ?? [], staff ? "STAFF" : "CUSTOMER");

  await logEvent(ticket.id, "CREATED", input.actor, {
    category: input.category,
    channel: input.channel ?? "WEB",
    verified: ticket.identityVerified,
    orderId: order?.id ?? null,
  });
  await logEvent(ticket.id, "PRIORITY_SET", "system", { priority, reason });

  let claimNumber: string | null = null;
  if (order && cat.claimReason) {
    try {
      const claim = await createClaimForTicket({
        ticket,
        order,
        category: input.category,
        skuId: input.skuId ?? null,
        variantSlug: input.variantSlug ?? null,
        hasEvidence: (input.files?.length ?? 0) > 0,
        now,
      });
      claimNumber = claim?.number ?? null;
    } catch (err) {
      logError("support:claim-create", err, { ticket: ticket.number });
    }
  }

  if (order && DELIVERY_CATEGORIES.has(input.category)) {
    const [trk] = await db
      .select({ id: shipmentTracking.id })
      .from(shipmentTracking)
      .where(and(eq(shipmentTracking.orderId, order.id), eq(shipmentTracking.kind, "FORWARD")));
    await raiseException({
      siteId: order.siteId,
      orderId: order.id,
      trackingId: trk?.id ?? null,
      type: "CUSTOMER_REPORTED",
      severity: priority === "CRITICAL" ? "CRITICAL" : priority === "HIGH" ? "HIGH" : "MEDIUM",
      detail: `${cat.label} — ticket ${ticket.number}`,
      ticketId: ticket.id,
      now,
    }).catch((err) => logError("support:exception", err, { ticket: ticket!.number }));
  }

  let status: TicketStatus = "NEW";
  if (priority === "CRITICAL") {
    status = "ESCALATED";
    await db
      .update(supportTickets)
      .set({ status, escalatedAt: now, escalationReason: reason })
      .where(eq(supportTickets.id, ticket.id));
    await logEvent(ticket.id, "ESCALATED", "system", { reason });
    await alertOps({
      scope: "support",
      message: `CRITICAL ticket ${ticket.number}: ${reason}`,
      siteId: ticket.siteId,
      orderId: order?.id ?? null,
      context: { ticket: ticket.number, category: input.category },
    });
  }

  await sendCustomerNotice({
    kind: "TICKET_CREATED",
    dedupKey: `${ticket.number}:CREATED`,
    siteId: ticket.siteId,
    orderId: order?.id ?? null,
    customerId: ticket.customerId,
    email: contactEmail,
    phone: contactPhone,
    now,
    subject: `We've got your request ${ticket.number}`,
    lines: [
      `Hi ${(contactName ?? "there").split(/\s+/)[0]}, thanks for contacting PRC Support. Your reference is ${ticket.number}.`,
      `We reply within ${sla.firstResponseHours[priority]} support hour${sla.firstResponseHours[priority] === 1 ? "" : "s"} (10 AM – 8 PM IST). Use the link below to add photos, reply or follow progress.`,
    ],
    cta: { label: "View your request", url: ticketLink(ticket.number, accessToken) },
  });

  return { id: ticket.id, number: ticket.number, accessToken, priority, status, claimNumber };
}

async function attachFiles(ticketId: string, messageId: string | null, files: File[], uploadedBy: "CUSTOMER" | "STAFF") {
  for (const f of files.slice(0, 5)) {
    const stored = await storeEvidence(f, ticketId);
    await db.insert(supportTicketAttachments).values({ ticketId, messageId, uploadedBy, ...stored });
  }
}

// ---------------------------------------------------------------------------
// Customer access
// ---------------------------------------------------------------------------

export async function findTicketForCustomer(
  number: string,
  access: { sessionCustomerId?: string | null; token?: string | null },
): Promise<SupportTicketRow | null> {
  const n = number.trim().toUpperCase();
  if (!/^T-[A-Z0-9]{6}$/.test(n)) return null;
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.number, n));
  if (!t) return null;
  if (access.sessionCustomerId && t.customerId === access.sessionCustomerId) return t;
  if (access.token && t.accessTokenHash && safeEqual(sha256(access.token), t.accessTokenHash)) return t;
  return null;
}

export async function listCustomerTickets(customerId: string) {
  return db
    .select({
      number: supportTickets.number,
      subject: supportTickets.subject,
      status: supportTickets.status,
      orderId: supportTickets.orderId,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(eq(supportTickets.customerId, customerId))
    .orderBy(desc(supportTickets.updatedAt))
    .limit(50);
}

export type CustomerTicketView = {
  number: string;
  subject: string;
  category: string;
  status: TicketStatus;
  statusLabel: string;
  stage: 0 | 1 | 2 | 3;
  orderId: string | null;
  createdAt: string;
  awaitingCustomer: boolean;
  canReply: boolean;
  canReopen: boolean;
  canClose: boolean;
  messages: Array<{
    id: string;
    author: "You" | "PRC Support" | "Update";
    authorName: string | null;
    body: string;
    at: string;
    attachments: Array<{ id: string; mimeType: string; name: string | null }>;
  }>;
  claim: { number: string; type: string; status: string; eligibility: string | null } | null;
  refunds: Array<{ amountInr: number; status: string; reference: string | null }>;
};

const CLAIM_STATUS_CUSTOMER: Record<string, string> = {
  SUBMITTED: "Submitted — waiting for review",
  UNDER_REVIEW: "Under review",
  NEEDS_INFO: "We need more information",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  RETURN_IN_TRANSIT: "Return pickup in progress",
  RECEIVED: "Return received — being inspected",
  REPLACEMENT_SHIPPED: "Replacement shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const REFUND_STATUS_CUSTOMER: Record<string, string> = {
  REQUESTED: "Requested — awaiting approval",
  APPROVED: "Approved — being processed",
  PROCESSING: "Initiated — waiting for bank confirmation",
  PROCESSED: "Refunded",
  FAILED: "Failed — our team will contact you",
  REJECTED: "Not approved",
  CANCELLED: "Cancelled",
};

export async function customerTicketView(t: SupportTicketRow, now: Date = new Date()): Promise<CustomerTicketView> {
  const msgs = await db
    .select()
    .from(supportTicketMessages)
    .where(and(eq(supportTicketMessages.ticketId, t.id), eq(supportTicketMessages.internal, false)))
    .orderBy(asc(supportTicketMessages.createdAt));
  const files = await db
    .select({ id: supportTicketAttachments.id, messageId: supportTicketAttachments.messageId, mimeType: supportTicketAttachments.mimeType, name: supportTicketAttachments.originalName })
    .from(supportTicketAttachments)
    .where(eq(supportTicketAttachments.ticketId, t.id));
  const [claim] = await db.select().from(supportClaims).where(eq(supportClaims.ticketId, t.id)).limit(1);
  const refunds = await db
    .select({ amountInr: refundCases.amountInr, status: refundCases.status, ref: refundCases.razorpayRefundId, manual: refundCases.manualReference })
    .from(refundCases)
    .where(eq(refundCases.ticketId, t.id));
  const status = isTicketStatus(t.status) ? t.status : "OPEN";
  const reopenable =
    status === "RESOLVED" && !!t.resolvedAt && now.getTime() - t.resolvedAt.getTime() < REOPEN_WINDOW_DAYS * 86_400_000;
  return {
    number: t.number,
    subject: t.subject,
    category: TICKET_CATEGORIES[t.category as TicketCategory]?.label ?? t.category,
    status,
    statusLabel: TICKET_STATUS_LABEL[status],
    stage: customerStage(status),
    orderId: t.orderId,
    createdAt: t.createdAt.toISOString(),
    awaitingCustomer: status === "AWAITING_CUSTOMER" || status === "RESOLUTION_PROPOSED",
    canReply: status !== "CLOSED",
    canReopen: reopenable,
    canClose: OPEN_STATUSES.includes(status),
    messages: msgs.map((m) => ({
      id: m.id,
      author: m.authorType === "CUSTOMER" ? "You" : m.authorType === "STAFF" ? "PRC Support" : "Update",
      authorName: m.authorType === "STAFF" ? (m.authorName?.split("@")[0] ?? null) : null,
      body: m.body,
      at: m.createdAt.toISOString(),
      attachments: files.filter((f) => f.messageId === m.id).map((f) => ({ id: f.id, mimeType: f.mimeType, name: f.name })),
    })),
    claim: claim
      ? {
          number: claim.number,
          type: claim.type === "RETURN" ? "Return" : "Replacement",
          status: CLAIM_STATUS_CUSTOMER[claim.status] ?? claim.status,
          eligibility: (claim.eligibility as { message?: string })?.message ?? null,
        }
      : null,
    refunds: refunds.map((r) => ({
      amountInr: r.amountInr,
      status: REFUND_STATUS_CUSTOMER[r.status] ?? r.status,
      reference: r.status === "PROCESSED" || r.status === "PROCESSING" ? (r.ref ?? r.manual ?? null) : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Customer actions
// ---------------------------------------------------------------------------

export async function addCustomerMessage(t: SupportTicketRow, body: string, files: File[] = [], now = new Date()) {
  const text = body.trim().slice(0, 4000);
  if (!text && files.length === 0) throw new TicketError("Write a message or attach a file.");
  if (t.status === "CLOSED") throw new TicketError("This ticket is closed. Please raise a new request.");
  const [m] = await db
    .insert(supportTicketMessages)
    .values({ ticketId: t.id, authorType: "CUSTOMER", authorName: t.contactName, authorEmail: t.contactEmail, body: text || "(attachment)", createdAt: now })
    .returning({ id: supportTicketMessages.id });
  await attachFiles(t.id, m.id, files, "CUSTOMER");
  const reopen = t.status === "RESOLVED";
  const next: TicketStatus = reopen
    ? "REOPENED"
    : t.status === "AWAITING_CUSTOMER" || t.status === "RESOLUTION_PROPOSED" || t.status === "NEW"
      ? t.status === "NEW" ? "NEW" : "OPEN"
      : (t.status as TicketStatus);
  await db
    .update(supportTickets)
    .set({
      status: next,
      awaiting: "STAFF",
      lastCustomerMessageAt: now,
      updatedAt: now,
      ...(reopen ? { reopenCount: sql`${supportTickets.reopenCount} + 1`, resolvedAt: null } : {}),
    })
    .where(eq(supportTickets.id, t.id));
  await logEvent(t.id, reopen ? "REOPENED" : "CUSTOMER_REPLIED", "customer", { files: files.length });
}

export async function reopenTicket(t: SupportTicketRow, reason: string, now = new Date()) {
  if (t.status !== "RESOLVED" || !t.resolvedAt || now.getTime() - t.resolvedAt.getTime() > REOPEN_WINDOW_DAYS * 86_400_000) {
    throw new TicketError("This ticket can no longer be reopened. Please raise a new request.");
  }
  await addCustomerMessage(t, reason || "I'd like to reopen this request.", [], now);
}

export async function closeTicketByCustomer(t: SupportTicketRow, now = new Date()) {
  if (!OPEN_STATUSES.includes(t.status as TicketStatus)) return;
  await db
    .update(supportTickets)
    .set({ status: "RESOLVED", resolvedAt: now, awaiting: "NONE", updatedAt: now })
    .where(eq(supportTickets.id, t.id));
  await db.insert(supportTicketMessages).values({ ticketId: t.id, authorType: "SYSTEM", body: "Marked as solved by the customer.", createdAt: now });
  await logEvent(t.id, "RESOLVED_BY_CUSTOMER", "customer");
}

// ---------------------------------------------------------------------------
// Staff actions (callers MUST have checked permissions)
// ---------------------------------------------------------------------------

export async function getTicketById(id: string) {
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
  return t ?? null;
}

export async function staffReply(
  t: SupportTicketRow,
  staffEmail: string,
  input: { body: string; internal: boolean; setStatus?: TicketStatus | null; files?: File[] },
  now = new Date(),
) {
  const body = input.body.trim().slice(0, 6000);
  if (!body) throw new TicketError("Write a reply first.");
  if (t.status === "CLOSED") throw new TicketError("This ticket is closed.");
  const [m] = await db
    .insert(supportTicketMessages)
    .values({ ticketId: t.id, authorType: "STAFF", authorName: staffEmail, authorEmail: staffEmail, body, internal: input.internal, createdAt: now })
    .returning({ id: supportTicketMessages.id });
  await attachFiles(t.id, m.id, input.files ?? [], "STAFF");
  if (input.internal) {
    await logEvent(t.id, "INTERNAL_NOTE", staffEmail);
    await db.update(supportTickets).set({ updatedAt: now }).where(eq(supportTickets.id, t.id));
    return;
  }
  const current = t.status as TicketStatus;
  let next: TicketStatus = input.setStatus ?? (["NEW", "OPEN", "REOPENED", "ASSIGNED"].includes(current) ? "IN_PROGRESS" : current);
  if (next !== current && !canStaffMove(current, next)) next = current;
  await db
    .update(supportTickets)
    .set({
      status: next,
      firstResponseAt: t.firstResponseAt ?? now,
      lastStaffMessageAt: now,
      awaiting: next === "AWAITING_CUSTOMER" || next === "RESOLUTION_PROPOSED" ? "CUSTOMER" : next === "RESOLVED" ? "NONE" : "STAFF",
      resolvedAt: next === "RESOLVED" ? now : t.resolvedAt,
      updatedAt: now,
    })
    .where(eq(supportTickets.id, t.id));
  await logEvent(t.id, "STAFF_REPLIED", staffEmail, { status: next });
  await sendCustomerNotice({
    kind: next === "RESOLVED" ? "TICKET_RESOLVED" : "TICKET_REPLY",
    dedupKey: `${t.number}:MSG:${m.id}`,
    siteId: t.siteId,
    orderId: t.orderId,
    customerId: t.customerId,
    email: t.contactEmail,
    phone: t.contactPhone,
    now,
    subject: next === "RESOLVED" ? `Your request ${t.number} is resolved` : `PRC Support replied to ${t.number}`,
    lines: [body.length > 600 ? `${body.slice(0, 600)}…` : body, "Reply from your ticket page if you need anything else."],
    cta: { label: "Open your request", url: ticketLink(t.number) },
  });
}

export async function setTicketStatus(t: SupportTicketRow, staffEmail: string, to: TicketStatus, note?: string, now = new Date()) {
  const from = t.status as TicketStatus;
  if (from === to) return;
  if (!canStaffMove(from, to)) throw new TicketError(`Can't move a ticket from ${from} to ${to}.`);
  await db
    .update(supportTickets)
    .set({
      status: to,
      resolvedAt: to === "RESOLVED" ? now : to === "REOPENED" ? null : t.resolvedAt,
      closedAt: to === "CLOSED" ? now : t.closedAt,
      awaiting: to === "AWAITING_CUSTOMER" || to === "RESOLUTION_PROPOSED" ? "CUSTOMER" : to === "RESOLVED" || to === "CLOSED" ? "NONE" : "STAFF",
      updatedAt: now,
    })
    .where(eq(supportTickets.id, t.id));
  await logEvent(t.id, "STATUS_CHANGED", staffEmail, { from, to, note: note ?? null });
  if (to === "RESOLVED") {
    await sendCustomerNotice({
      kind: "TICKET_RESOLVED",
      dedupKey: `${t.number}:RESOLVED:${now.toISOString()}`,
      siteId: t.siteId,
      orderId: t.orderId,
      customerId: t.customerId,
      email: t.contactEmail,
      phone: t.contactPhone,
      now,
      subject: `Your request ${t.number} is resolved`,
      lines: [note?.trim() || "We've marked your request as resolved.", `Not sorted? You can reopen it within ${REOPEN_WINDOW_DAYS} days from the ticket page.`],
      cta: { label: "Open your request", url: ticketLink(t.number) },
    });
  }
}

export async function assignTicket(t: SupportTicketRow, staffEmail: string, assignee: string | null, now = new Date()) {
  const status: TicketStatus = assignee && (t.status === "NEW" || t.status === "OPEN") ? "ASSIGNED" : (t.status as TicketStatus);
  await db.update(supportTickets).set({ assignedTo: assignee, status, updatedAt: now }).where(eq(supportTickets.id, t.id));
  await logEvent(t.id, "ASSIGNED", staffEmail, { to: assignee });
}

export async function escalateTicket(t: SupportTicketRow, actor: string, reason: string, now = new Date()) {
  const priority = higherPriority(t.priority as Priority, "HIGH");
  await db
    .update(supportTickets)
    .set({ status: "ESCALATED", escalatedAt: now, escalationReason: reason.slice(0, 300), priority, updatedAt: now })
    .where(eq(supportTickets.id, t.id));
  await logEvent(t.id, "ESCALATED", actor, { reason, priority });
  await alertOps({ scope: "support", message: `Ticket ${t.number} escalated: ${reason}`, siteId: t.siteId, orderId: t.orderId, context: { ticket: t.number } });
}

export async function setTicketPriority(t: SupportTicketRow, staffEmail: string, priority: Priority, reason: string, now = new Date()) {
  const sla = await loadSla();
  const due = slaDueDates(priority, t.createdAt, sla);
  await db
    .update(supportTickets)
    .set({ priority, priorityReason: `Manual: ${reason}`.slice(0, 200), firstResponseDueAt: due.firstResponseDueAt, resolutionDueAt: due.resolutionDueAt, updatedAt: now })
    .where(eq(supportTickets.id, t.id));
  await logEvent(t.id, "PRIORITY_CHANGED", staffEmail, { from: t.priority, to: priority, reason });
}

// ---------------------------------------------------------------------------
// Maintenance (run from the 15-minute cron)
// ---------------------------------------------------------------------------

export async function runSupportMaintenance(now: Date = new Date()): Promise<{ autoClosed: number }> {
  const cutoff = new Date(now.getTime() - REOPEN_WINDOW_DAYS * 86_400_000);
  const closed = await db
    .update(supportTickets)
    .set({ status: "CLOSED", closedAt: now, awaiting: "NONE", updatedAt: now })
    .where(and(eq(supportTickets.status, "RESOLVED"), lt(supportTickets.resolvedAt, cutoff)))
    .returning({ id: supportTickets.id });
  if (closed.length) {
    await db.insert(supportTicketEvents).values(closed.map((c) => ({ ticketId: c.id, type: "AUTO_CLOSED", actor: "system", payload: {} })));
  }
  return { autoClosed: closed.length };
}

/** Open tickets past their first-response target with no staff reply yet. */
export async function countSlaBreaches(now: Date = new Date()): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(
      and(
        inArray(supportTickets.status, [...OPEN_STATUSES]),
        isNull(supportTickets.firstResponseAt),
        lt(supportTickets.firstResponseDueAt, now),
      ),
    );
  return r?.n ?? 0;
}
