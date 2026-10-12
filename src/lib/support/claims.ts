/**
 * Return / replacement claims, always attached to a ticket and an order.
 *
 * Flow: customer picks the item + problem → policy eligibility snapshot →
 * live stock check (replacements) → claim SUBMITTED (or NEEDS_INFO when the
 * policy requires evidence that wasn't attached) → staff decide → fulfilment
 * (replacement / return-pickup AWB, tracked as its own shipment) → completed.
 *
 * Nothing is promised automatically: approval is a staff action (permission
 * "claims.decide"), and a replacement can't be approved while the SKU is out
 * of stock unless a supervisor overrides with a written note.
 */

import { randomInt } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  inventory,
  shipmentTracking,
  supportClaims,
  supportTicketEvents,
  supportTicketMessages,
  supportTickets,
  type SupportClaimRow,
  type SupportTicketRow,
} from "@/db/schema";
import { sendCustomerNotice } from "@/lib/notifications/customer-notice";
import { loadPolicy } from "./config";
import { checkEligibility, TICKET_CATEGORIES, type TicketCategory } from "./rules";

export const CLAIM_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "RETURN_IN_TRANSIT",
  "RECEIVED",
  "REPLACEMENT_SHIPPED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export class ClaimError extends Error {}

type OrderItem = { skuId: string; variantSlug: string | null; name: string; qty: number; unitPriceInr?: number; lineTotalInr?: number };

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

async function stockFor(siteId: string, skuId: string, variantSlug: string | null) {
  const [row] = await db
    .select({ stock: inventory.stock })
    .from(inventory)
    .where(and(eq(inventory.siteId, siteId), eq(inventory.skuId, skuId), eq(inventory.variantSlug, variantSlug ?? "")));
  return row ? row.stock : null;
}

export async function createClaimForTicket(input: {
  ticket: SupportTicketRow;
  order: { id: string; siteId: string; customerId: string; status: string; deliveredAt: Date | null; items: unknown };
  category: TicketCategory;
  skuId: string | null;
  variantSlug: string | null;
  hasEvidence: boolean;
  now: Date;
}): Promise<SupportClaimRow | null> {
  const reason = TICKET_CATEGORIES[input.category].claimReason;
  if (!reason) return null;
  const policy = await loadPolicy();
  const eligibility = checkEligibility({
    category: input.category,
    orderStatus: input.order.status,
    deliveredAt: input.order.deliveredAt,
    now: input.now,
    policy,
  });
  const items = ((input.order.items as OrderItem[]) ?? []).filter(
    (i) => !input.skuId || (i.skuId === input.skuId && (input.variantSlug == null || (i.variantSlug ?? "") === (input.variantSlug ?? ""))),
  );
  const claimItems = (items.length ? items : ((input.order.items as OrderItem[]) ?? [])).map((i) => ({
    skuId: i.skuId,
    variantSlug: i.variantSlug ?? null,
    name: i.name,
    qty: i.qty,
    unitPriceInr: i.unitPriceInr ?? null,
  }));

  let stock: Record<string, unknown> = {};
  if (eligibility.claimType === "REPLACEMENT" && claimItems[0]) {
    const s = await stockFor(input.order.siteId, claimItems[0].skuId, claimItems[0].variantSlug);
    stock = {
      skuId: claimItems[0].skuId,
      variantSlug: claimItems[0].variantSlug,
      available: s,
      inStock: (s ?? 0) >= claimItems[0].qty,
      checkedAt: input.now.toISOString(),
    };
  }
  const missingEvidence = eligibility.evidence === "REQUIRED" && !input.hasEvidence;

  for (let i = 0; i < 5; i++) {
    const number = `C-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
    const [claim] = await db
      .insert(supportClaims)
      .values({
        number,
        ticketId: input.ticket.id,
        orderId: input.order.id,
        customerId: input.order.customerId,
        type: eligibility.claimType ?? "REPLACEMENT",
        status: missingEvidence ? "NEEDS_INFO" : "SUBMITTED",
        reason,
        items: claimItems,
        eligibility,
        stock,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    if (!claim) continue;
    await db.insert(supportTicketEvents).values({
      ticketId: input.ticket.id,
      type: "CLAIM_CREATED",
      actor: "system",
      payload: { claim: claim.number, eligible: eligibility.eligible, stock, missingEvidence },
    });
    const lines = [
      `${claim.type === "RETURN" ? "Return" : "Replacement"} request ${claim.number} created. ${eligibility.message}`,
      ...(missingEvidence ? ["Please add a photo or short video of the problem so we can review it."] : []),
      ...(stock.inStock === false ? ["Replacement stock for this item is not available right now — our team will suggest the best option."] : []),
    ];
    await db.insert(supportTicketMessages).values({ ticketId: input.ticket.id, authorType: "SYSTEM", body: lines.join(" "), createdAt: input.now });
    if (missingEvidence) {
      await db.update(supportTickets).set({ awaiting: "CUSTOMER" }).where(eq(supportTickets.id, input.ticket.id));
    }
    return claim;
  }
  throw new Error("could not allocate a claim number");
}

async function claimEvent(claim: SupportClaimRow, type: string, actor: string, payload: Record<string, unknown>) {
  await db.insert(supportTicketEvents).values({ ticketId: claim.ticketId, type, actor, payload: { claim: claim.number, ...payload } });
}

async function noticeToCustomer(claim: SupportClaimRow, kind: "CLAIM_DECISION" | "REPLACEMENT_SHIPPED", subject: string, lines: string[], now: Date) {
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, claim.ticketId));
  if (!t) return;
  await sendCustomerNotice({
    kind,
    dedupKey: `${claim.number}:${kind}:${claim.status}`,
    siteId: t.siteId,
    orderId: claim.orderId,
    customerId: t.customerId,
    email: t.contactEmail,
    phone: t.contactPhone,
    now,
    subject,
    lines,
    cta: { label: "Open your request", url: `${(process.env.NEXT_PUBLIC_SITE_URL || "https://pocketrccars.com").replace(/\/$/, "")}/support/tickets/${t.number}` },
  });
}

export async function getClaim(id: string) {
  const [c] = await db.select().from(supportClaims).where(eq(supportClaims.id, id));
  return c ?? null;
}

/** Staff decision. Approving a replacement requires stock unless overridden. */
export async function decideClaim(
  claim: SupportClaimRow,
  staffEmail: string,
  decision: "APPROVE" | "REJECT" | "NEEDS_INFO" | "UNDER_REVIEW",
  note: string,
  opts: { overrideStock?: boolean } = {},
  now = new Date(),
) {
  if (!["SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO"].includes(claim.status)) {
    throw new ClaimError(`This claim is already ${claim.status.toLowerCase().replace(/_/g, " ")}.`);
  }
  if ((decision === "REJECT" || decision === "NEEDS_INFO") && note.trim().length < 5) {
    throw new ClaimError("Add a short note for the customer explaining the decision.");
  }
  let stockNow: number | null = null;
  if (decision === "APPROVE" && claim.type === "REPLACEMENT") {
    const item = (claim.items as OrderItem[])[0];
    if (item) {
      const [o] = await db.select({ siteId: supportTickets.siteId }).from(supportTickets).where(eq(supportTickets.id, claim.ticketId));
      stockNow = await stockFor(o?.siteId ?? "prc", item.skuId, item.variantSlug);
      if ((stockNow ?? 0) < item.qty && !opts.overrideStock) {
        throw new ClaimError(`Out of stock (${stockNow ?? 0} available) — a replacement can't be promised. Offer a refund, or override with a note if stock is arriving.`);
      }
      if (opts.overrideStock && note.trim().length < 5) throw new ClaimError("Explain the stock override in the note.");
    }
  }
  const status: ClaimStatus =
    decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : decision === "NEEDS_INFO" ? "NEEDS_INFO" : "UNDER_REVIEW";
  const [updated] = await db
    .update(supportClaims)
    .set({ status, decisionBy: staffEmail, decisionAt: now, decisionNote: note.trim() || null, updatedAt: now })
    .where(and(eq(supportClaims.id, claim.id), eq(supportClaims.status, claim.status)))
    .returning();
  if (!updated) throw new ClaimError("Someone else just updated this claim — reload and try again.");
  await claimEvent(updated, "CLAIM_DECIDED", staffEmail, { decision, note, stockNow, overrideStock: !!opts.overrideStock });

  if (decision === "UNDER_REVIEW") return updated;
  const label = claim.type === "RETURN" ? "return" : "replacement";
  const lines =
    decision === "APPROVE"
      ? [
          `Good news — your ${label} request ${claim.number} is approved.`,
          claim.type === "RETURN"
            ? "We'll arrange the return pickup and share the details here. The refund starts after the item reaches us and passes inspection."
            : "We'll send the replacement and share its tracking here.",
          ...(note.trim() ? [note.trim()] : []),
        ]
      : decision === "REJECT"
        ? [`We couldn't approve your ${label} request ${claim.number}.`, note.trim()]
        : [`We need a little more information for ${claim.number}.`, note.trim()];
  await db.insert(supportTicketMessages).values({ ticketId: claim.ticketId, authorType: "STAFF", authorName: staffEmail, authorEmail: staffEmail, body: lines.join(" "), createdAt: now });
  await db
    .update(supportTickets)
    .set({
      status: decision === "NEEDS_INFO" ? "AWAITING_CUSTOMER" : "RESOLUTION_PROPOSED",
      awaiting: "CUSTOMER",
      lastStaffMessageAt: now,
      updatedAt: now,
    })
    .where(eq(supportTickets.id, claim.ticketId));
  await noticeToCustomer(updated, "CLAIM_DECISION", `Update on your ${label} request ${claim.number}`, lines, now);
  return updated;
}

/**
 * Record the replacement shipment (or the return pickup). A replacement sent
 * without a linked replacement order decrements stock here, exactly once and
 * only if stock remains. The AWB becomes a tracked shipment.
 */
export async function recordClaimShipment(
  claim: SupportClaimRow,
  staffEmail: string,
  input: { awb: string | null; replacementOrderId: string | null },
  now = new Date(),
) {
  if (claim.status !== "APPROVED") throw new ClaimError("Approve the claim before recording its shipment.");
  const awb = input.awb?.trim() || null;
  if (!awb && !input.replacementOrderId) throw new ClaimError("Enter the AWB or the replacement order ID.");

  if (claim.type === "REPLACEMENT" && !input.replacementOrderId && !claim.stockCommitted) {
    const item = (claim.items as OrderItem[])[0];
    const [t] = await db.select({ siteId: supportTickets.siteId }).from(supportTickets).where(eq(supportTickets.id, claim.ticketId));
    if (item) {
      const dec = await db
        .update(inventory)
        .set({ stock: sql`${inventory.stock} - ${item.qty}`, updatedAt: now })
        .where(
          and(
            eq(inventory.siteId, t?.siteId ?? "prc"),
            eq(inventory.skuId, item.skuId),
            eq(inventory.variantSlug, item.variantSlug ?? ""),
            gte(inventory.stock, item.qty),
          ),
        )
        .returning({ stock: inventory.stock });
      if (dec.length === 0) throw new ClaimError("Not enough stock to send this replacement.");
    }
  }

  const next: ClaimStatus = claim.type === "RETURN" ? "RETURN_IN_TRANSIT" : "REPLACEMENT_SHIPPED";
  const [updated] = await db
    .update(supportClaims)
    .set({
      status: next,
      shipmentAwb: awb,
      replacementOrderId: input.replacementOrderId,
      stockCommitted: claim.type === "REPLACEMENT" && !input.replacementOrderId ? true : claim.stockCommitted,
      updatedAt: now,
    })
    .where(and(eq(supportClaims.id, claim.id), eq(supportClaims.status, "APPROVED")))
    .returning();
  if (!updated) throw new ClaimError("Someone else just updated this claim — reload and try again.");

  if (awb) {
    const [t] = await db.select({ siteId: supportTickets.siteId }).from(supportTickets).where(eq(supportTickets.id, claim.ticketId));
    await db
      .insert(shipmentTracking)
      .values({ siteId: t?.siteId ?? "prc", orderId: claim.orderId, kind: claim.type === "RETURN" ? "RETURN" : "REPLACEMENT", awbCode: awb, status: "UNKNOWN" })
      .onConflictDoNothing();
  }
  await claimEvent(updated, "CLAIM_SHIPMENT", staffEmail, { awb, replacementOrderId: input.replacementOrderId });
  if (claim.type === "REPLACEMENT") {
    await noticeToCustomer(
      updated,
      "REPLACEMENT_SHIPPED",
      `Your replacement for ${claim.number} is on its way`,
      [`Your replacement has been handed to the courier.${awb ? ` AWB: ${awb}.` : ""}`, "You'll see its progress on your request page."],
      now,
    );
  }
  return updated;
}

export async function markReturnReceived(claim: SupportClaimRow, staffEmail: string, conditionNote: string, now = new Date()) {
  if (claim.status !== "RETURN_IN_TRANSIT") throw new ClaimError("Only a return in transit can be marked received.");
  if (conditionNote.trim().length < 3) throw new ClaimError("Note the condition of the returned item.");
  const [updated] = await db
    .update(supportClaims)
    .set({ status: "RECEIVED", decisionNote: conditionNote.trim(), updatedAt: now })
    .where(and(eq(supportClaims.id, claim.id), eq(supportClaims.status, "RETURN_IN_TRANSIT")))
    .returning();
  if (!updated) throw new ClaimError("Someone else just updated this claim — reload and try again.");
  await claimEvent(updated, "RETURN_RECEIVED", staffEmail, { condition: conditionNote });
  return updated;
}

export async function completeClaim(claim: SupportClaimRow, staffEmail: string, now = new Date()) {
  if (!["REPLACEMENT_SHIPPED", "RECEIVED", "APPROVED"].includes(claim.status)) throw new ClaimError("This claim can't be completed yet.");
  const [updated] = await db
    .update(supportClaims)
    .set({ status: "COMPLETED", updatedAt: now })
    .where(eq(supportClaims.id, claim.id))
    .returning();
  await claimEvent(updated, "CLAIM_COMPLETED", staffEmail, {});
  return updated;
}
