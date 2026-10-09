"use server";

/**
 * Customer ticket actions: create (web form), reply, close, reopen.
 *
 * Server actions are reachable by direct POST, so each one re-validates its
 * FormData with zod, rate-limits by IP, and re-checks access on the server:
 * orders must belong to the verified session; tickets must be owned by the
 * session or opened with their secret link token. No emails, phones or
 * descriptions are logged.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { getSupportSession } from "@/lib/support/session";
import { ORDER_ID_RE, normaliseOrderId } from "@/lib/support/verify";
import { TICKET_CATEGORIES, isCategory, type TicketCategory } from "@/lib/support/rules";
import { loadPolicy } from "@/lib/support/config";
import { EvidenceError, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FILES } from "@/lib/support/evidence";
import {
  TicketError,
  addCustomerMessage,
  closeTicketByCustomer,
  createTicket,
  findTicketForCustomer,
  reopenTicket,
} from "@/lib/support/tickets";
import { getOwnedOrder, itemValue, orderItems } from "@/lib/support/customer-queries";
import { TOO_MANY, allowAction } from "../_lib/guard";

export type ActionResult = { ok: true; href?: string } | { ok: false; error: string };

/** Matches the client cap (nginx / server-action body limit is 20 MB). */
const MAX_TOTAL_BYTES = 19 * 1024 * 1024;
const TOTAL_TOO_BIG = "Attachments add up to more than 19 MB — send fewer or smaller files (you can add more in a reply).";

const GENERIC = "Something went wrong on our side and your request wasn't sent. Please try again, or WhatsApp us.";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const TicketInput = z.object({
  category: z.string().refine(isCategory),
  orderId: opt(20),
  item: opt(200),
  description: z.string().trim().min(10, "Please describe the problem in at least 10 characters.").max(1000, "Please keep the description under 1000 characters."),
  safety: opt(5),
  name: opt(80),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .pipe(z.email().optional()),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || v.replace(/\D/g, "").length >= 10),
  context: opt(6000),
});

/** Customer-supplied hand-off context — kept small and string-only. */
const ContextShape = z
  .object({
    source: z.enum(["chat", "guide"]).optional(),
    article: z.string().max(80).optional(),
    stepsTried: z.array(z.string().max(200)).max(20).optional(),
    transcript: z.string().max(4000).optional(),
  })
  .catch({});

function filesFrom(fd: FormData): File[] {
  return fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "size" in f && f.size > 0);
}

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const field = issue?.path[0];
  if (field === "description") return issue.message.startsWith("Please") ? issue.message : "Please describe the problem (10–1000 characters).";
  if (field === "email") return "Enter a valid email address so we can reply.";
  if (field === "phone") return "Enter a 10-digit phone number, or leave it empty.";
  if (field === "category") return "Choose what the problem is about.";
  return "Please check the form and try again.";
}

export async function submitTicketAction(fd: FormData): Promise<ActionResult> {
  if (!(await allowAction("support:ticket", 10, 10 * 60_000))) return { ok: false, error: TOO_MANY };

  const parsed = TicketInput.safeParse({
    category: fd.get("category") ?? "",
    orderId: fd.get("orderId") ?? undefined,
    item: fd.get("item") ?? undefined,
    description: fd.get("description") ?? "",
    safety: fd.get("safety") ?? undefined,
    name: fd.get("name") ?? undefined,
    email: fd.get("email") ?? undefined,
    phone: fd.get("phone") ?? undefined,
    context: fd.get("context") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  const category = input.category as TicketCategory;
  const cat = TICKET_CATEGORIES[category];

  try {
    const session = await getSupportSession();
    const policy = await loadPolicy();

    // Order: must be the verified customer's own.
    let orderId: string | null = null;
    let skuId: string | null = null;
    let variantSlug: string | null = null;
    if (input.orderId) {
      const id = normaliseOrderId(input.orderId);
      if (!ORDER_ID_RE.test(id)) return { ok: false, error: "That order ID doesn't look right." };
      const order = session ? await getOwnedOrder(id, session.customerId) : null;
      if (!order) return { ok: false, error: "Please verify your order before raising a request about it." };
      orderId = order.id;
      const items = orderItems(order);
      const needsItem = (cat.group === "PRODUCT" || cat.group === "RETURNS") && items.length > 0;
      const chosen = input.item ? items.find((it) => itemValue(it) === input.item) : items.length === 1 ? items[0] : undefined;
      if (input.item && !chosen) return { ok: false, error: "Choose the item from this order." };
      if (needsItem && !chosen) return { ok: false, error: "Choose which item has the problem." };
      if (chosen && needsItem) {
        skuId = chosen.skuId;
        variantSlug = chosen.variantSlug;
      }
    } else if (cat.needsOrder) {
      return { ok: false, error: "Please verify your order first — this kind of request needs it." };
    }

    // Contact: verified customers are reached on the order's details; others
    // must leave a name and email.
    let contact: { name?: string | null; email?: string | null; phone?: string | null } = {};
    if (!session) {
      if (!input.name || input.name.length < 2) return { ok: false, error: "Enter your name." };
      if (!input.email) return { ok: false, error: "Enter your email so we can reply." };
      contact = { name: input.name, email: input.email, phone: input.phone ?? null };
    } else if (!orderId) {
      contact = { email: session.email, phone: input.phone ?? null };
    }

    // Evidence.
    const files = filesFrom(fd);
    const maxFiles = Math.min(policy.maxEvidenceFiles, MAX_EVIDENCE_FILES);
    const maxBytes = Math.min(policy.maxEvidenceMb * 1024 * 1024, MAX_EVIDENCE_BYTES);
    if (files.length > maxFiles) return { ok: false, error: `You can attach up to ${maxFiles} files.` };
    if (files.some((f) => f.size > maxBytes)) {
      return { ok: false, error: `Each file must be under ${Math.round(maxBytes / (1024 * 1024))} MB.` };
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return { ok: false, error: TOTAL_TOO_BIG };
    if (cat.evidence === "REQUIRED" && files.length === 0) {
      return { ok: false, error: "Please add at least one photo or short video showing the problem." };
    }

    let context: Record<string, unknown> = {};
    if (input.context) {
      try {
        context = { handoff: ContextShape.parse(JSON.parse(input.context)) };
      } catch {
        context = {};
      }
    }

    const created = await createTicket({
      category,
      description: input.description,
      orderId,
      skuId,
      variantSlug,
      contact,
      verifiedCustomerId: session?.customerId ?? null,
      channel: "WEB",
      safetyFlag: input.safety === "1",
      context,
      actor: "customer",
      files,
    });
    return {
      ok: true,
      href: `/support/tickets/${created.number}?k=${encodeURIComponent(created.accessToken)}&created=1`,
    };
  } catch (err) {
    if (err instanceof TicketError || err instanceof EvidenceError) return { ok: false, error: err.message };
    logError("support:ticket-create", err, { category });
    return { ok: false, error: GENERIC };
  }
}

// ---------------------------------------------------------------------------
// Existing tickets
// ---------------------------------------------------------------------------

const Access = z.object({
  number: z.string().trim().toUpperCase().regex(/^T-[A-Z0-9]{6}$/),
  k: opt(64),
});

async function ticketFrom(fd: FormData) {
  const a = Access.safeParse({ number: fd.get("number") ?? "", k: fd.get("k") ?? undefined });
  if (!a.success) return null;
  const session = await getSupportSession();
  const row = await findTicketForCustomer(a.data.number, { sessionCustomerId: session?.customerId ?? null, token: a.data.k ?? null });
  return row ? { row, number: a.data.number } : null;
}

const NOT_FOUND = "We couldn't open this ticket. Use the link from your email, or verify your order again.";

export async function replyTicketAction(fd: FormData): Promise<ActionResult> {
  if (!(await allowAction("support:reply", 20, 10 * 60_000))) return { ok: false, error: TOO_MANY };
  const body = z.string().trim().max(2000).safeParse(fd.get("body") ?? "");
  if (!body.success) return { ok: false, error: "Please keep your message under 2000 characters." };
  try {
    const t = await ticketFrom(fd);
    if (!t) return { ok: false, error: NOT_FOUND };
    const policy = await loadPolicy();
    const files = filesFrom(fd);
    const maxFiles = Math.min(policy.maxEvidenceFiles, MAX_EVIDENCE_FILES);
    const maxBytes = Math.min(policy.maxEvidenceMb * 1024 * 1024, MAX_EVIDENCE_BYTES);
    if (files.length > maxFiles) return { ok: false, error: `You can attach up to ${maxFiles} files.` };
    if (files.some((f) => f.size > maxBytes)) {
      return { ok: false, error: `Each file must be under ${Math.round(maxBytes / (1024 * 1024))} MB.` };
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return { ok: false, error: TOTAL_TOO_BIG };
    if (!body.data && files.length === 0) return { ok: false, error: "Write a message or attach a file." };
    await addCustomerMessage(t.row, body.data, files);
    revalidatePath(`/support/tickets/${t.number}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof TicketError || err instanceof EvidenceError) return { ok: false, error: err.message };
    logError("support:ticket-reply", err);
    return { ok: false, error: GENERIC };
  }
}

export async function closeTicketAction(fd: FormData): Promise<ActionResult> {
  if (!(await allowAction("support:reply", 20, 10 * 60_000))) return { ok: false, error: TOO_MANY };
  try {
    const t = await ticketFrom(fd);
    if (!t) return { ok: false, error: NOT_FOUND };
    await closeTicketByCustomer(t.row);
    revalidatePath(`/support/tickets/${t.number}`);
    return { ok: true };
  } catch (err) {
    logError("support:ticket-close", err);
    return { ok: false, error: GENERIC };
  }
}

export async function reopenTicketAction(fd: FormData): Promise<ActionResult> {
  if (!(await allowAction("support:reply", 20, 10 * 60_000))) return { ok: false, error: TOO_MANY };
  const reason = z.string().trim().max(1000).safeParse(fd.get("reason") ?? "");
  if (!reason.success) return { ok: false, error: "Please keep the reason under 1000 characters." };
  try {
    const t = await ticketFrom(fd);
    if (!t) return { ok: false, error: NOT_FOUND };
    await reopenTicket(t.row, reason.data);
    revalidatePath(`/support/tickets/${t.number}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof TicketError) return { ok: false, error: err.message };
    logError("support:ticket-reopen", err);
    return { ok: false, error: GENERIC };
  }
}
