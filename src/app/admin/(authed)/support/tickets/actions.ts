"use server";

/**
 * Staff create a ticket on a customer's behalf (phone call, Instagram DM,
 * walk-in). Same service as the web form — createTicket() — so priority
 * rules, SLA, claims and the customer notice are identical; the actor is the
 * staff email and the channel is ADMIN.
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { logError } from "@/lib/logger";
import { isMissingTableError } from "@/lib/support/admin-queries";
import { isCategory, TICKET_CATEGORIES } from "@/lib/support/rules";
import { createTicket, TicketError } from "@/lib/support/tickets";

export type CreateTicketResult = { ok: true; id: string; number: string } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);

export async function createTicketAction(fd: FormData): Promise<CreateTicketResult> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.reply")) return { ok: false, error: "Your role can't create tickets." };

  const category = text(fd, "category", 40);
  if (!isCategory(category)) return { ok: false, error: "Choose a category." };
  const description = text(fd, "description", 4000);
  const subject = text(fd, "subject", 140) || null;
  const orderId = text(fd, "orderId", 40).toUpperCase() || null;
  const name = text(fd, "name", 120) || null;
  const email = text(fd, "email", 200).toLowerCase() || null;
  const phone = text(fd, "phone", 20) || null;

  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look right." };
  if (phone && phone.replace(/\D/g, "").length < 10) return { ok: false, error: "Enter a 10-digit phone number." };
  if (!orderId && TICKET_CATEGORIES[category].needsOrder) {
    return { ok: false, error: `“${TICKET_CATEGORIES[category].label}” needs the order ID.` };
  }

  try {
    if (orderId) {
      const [o] = await db.select({ siteId: orders.siteId }).from(orders).where(eq(orders.id, orderId));
      if (!o || !ctx.siteIds.includes(o.siteId)) return { ok: false, error: `No order ${orderId} on your stores.` };
    }
    const created = await createTicket({
      category,
      description,
      subject,
      orderId,
      contact: { name, email, phone },
      channel: "ADMIN",
      actor: ctx.email,
    });
    revalidatePath("/admin/support");
    revalidatePath("/admin/support/tickets");
    return { ok: true, id: created.id, number: created.number };
  } catch (err) {
    if (err instanceof TicketError) return { ok: false, error: err.message };
    if (isMissingTableError(err)) return { ok: false, error: "The support centre isn't set up yet — apply the support migration first." };
    logError("admin:support:create-ticket", err, { orderId });
    return { ok: false, error: "Couldn't create the ticket — try again." };
  }
}
