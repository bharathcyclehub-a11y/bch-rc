/**
 * Guest order verification by one-time email code.
 *
 * Knowing an order id + phone is NOT enough to see an order: the customer
 * must also read a 6-digit code sent to the email on that order (every paid
 * order in the last 90 days has one). Codes live 10 minutes, allow 5 tries,
 * and only an HMAC of the code is stored. The code is sent directly (not via
 * the outbox) so it is never persisted in plain text, and it is never logged.
 *
 * Abuse limits: 3 codes per order per 15 min, 8 per IP per 15 min (on top of
 * the route's per-IP rate limit). Mismatched details get one generic answer.
 */

import { randomInt } from "node:crypto";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders, supportVerifications } from "@/db/schema";
import { sendEmail } from "@/lib/notifications/send-email";
import { logError } from "@/lib/logger";
import { hmac, maskEmail, safeEqual } from "./session";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

export const ORDER_ID_RE = /^PRC-[A-Z0-9]{4,12}$/;

export function normaliseOrderId(raw: string): string {
  return raw.trim().toUpperCase();
}

const digits10 = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

export type StartResult =
  | { ok: true; challengeId: string; destination: string; expiresInSec: number }
  | { ok: false; code: "INVALID" | "NOT_MATCHED" | "RATE_LIMITED" | "NO_EMAIL" | "SEND_FAILED"; message: string };

export async function startOrderVerification(input: {
  orderId: string;
  contact: string;
  ipHash: string | null;
  now?: Date;
}): Promise<StartResult> {
  const now = input.now ?? new Date();
  const orderId = normaliseOrderId(input.orderId);
  const contact = input.contact.trim();
  if (!ORDER_ID_RE.test(orderId) || contact.length < 4) {
    return { ok: false, code: "INVALID", message: "Enter your order ID and the phone number or email used at checkout." };
  }
  const notMatched = {
    ok: false as const,
    code: "NOT_MATCHED" as const,
    message: "We couldn't match that order ID with that phone number or email. Check both and try again.",
  };

  const [row] = await db
    .select({ id: orders.id, customerId: orders.customerId, addr: orders.shippingAddress, phone: customers.phone })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, orderId));
  if (!row) return notMatched;

  const addr = (row.addr ?? {}) as { email?: string | null; phone?: string | null };
  const orderEmail = addr.email?.trim().toLowerCase() || null;
  const matches = contact.includes("@")
    ? !!orderEmail && contact.toLowerCase() === orderEmail
    : digits10(contact).length === 10 && (digits10(contact) === digits10(addr.phone) || digits10(contact) === digits10(row.phone));
  if (!matches) return notMatched;
  if (!orderEmail) {
    return {
      ok: false,
      code: "NO_EMAIL",
      message: "This order has no email on file, so we can't send a code. Raise a ticket and our team will verify you by phone.",
    };
  }

  const since = new Date(now.getTime() - WINDOW_MS);
  const [byOrder] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportVerifications)
    .where(and(eq(supportVerifications.orderId, orderId), gte(supportVerifications.createdAt, since)));
  const [byIp] = input.ipHash
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(supportVerifications)
        .where(and(eq(supportVerifications.ipHash, input.ipHash), gte(supportVerifications.createdAt, since)))
    : [{ n: 0 }];
  if ((byOrder?.n ?? 0) >= 3 || (byIp?.n ?? 0) >= 8) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many codes requested. Please wait 15 minutes and try again." };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [challenge] = await db
    .insert(supportVerifications)
    .values({
      orderId,
      customerId: row.customerId,
      destinationMasked: maskEmail(orderEmail),
      codeHash: "pending",
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      ipHash: input.ipHash,
      createdAt: now,
    })
    .returning({ id: supportVerifications.id });
  await db
    .update(supportVerifications)
    .set({ codeHash: hmac(`${challenge.id}:${code}`) })
    .where(eq(supportVerifications.id, challenge.id));

  const sent = await sendEmail({
    to: orderEmail,
    subject: `${code} is your PRC Support verification code`,
    text: `Your PRC Support verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email — nobody can see your order without it.\n\n— PRC Support`,
    html: `<div style="font-family:-apple-system,system-ui,Segoe UI,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0a0a0a"><div style="font-weight:900;font-size:20px">PRC Cars</div><p>Your PRC Support verification code:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">${code}</p><p style="color:#555;font-size:13px">It expires in 10 minutes. If you didn't ask for it, ignore this email — nobody can see your order without it.</p></div>`,
  });
  if (!sent.ok) {
    logError("support:verify-send", new Error(sent.error), { orderId });
    return { ok: false, code: "SEND_FAILED", message: "We couldn't send the code right now. Please try again in a minute." };
  }
  return { ok: true, challengeId: challenge.id, destination: maskEmail(orderEmail), expiresInSec: CODE_TTL_MS / 1000 };
}

export type ConfirmResult =
  | { ok: true; customerId: string; orderId: string; email: string }
  | { ok: false; code: "INVALID" | "EXPIRED" | "LOCKED"; message: string };

export async function confirmOrderVerification(input: {
  challengeId: string;
  code: string;
  now?: Date;
}): Promise<ConfirmResult> {
  const now = input.now ?? new Date();
  const code = input.code.replace(/\D/g, "");
  if (!/^[0-9a-f-]{36}$/i.test(input.challengeId) || code.length !== 6) {
    return { ok: false, code: "INVALID", message: "Enter the 6-digit code from the email." };
  }
  // Count the attempt atomically BEFORE comparing, so parallel guesses can't
  // exceed the limit.
  const [c] = await db
    .update(supportVerifications)
    .set({ attempts: sql`${supportVerifications.attempts} + 1` })
    .where(
      and(
        eq(supportVerifications.id, input.challengeId),
        isNull(supportVerifications.verifiedAt),
        lt(supportVerifications.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning();
  if (!c) return { ok: false, code: "LOCKED", message: "This code can't be used any more. Request a new one." };
  if (c.expiresAt < now) return { ok: false, code: "EXPIRED", message: "This code has expired. Request a new one." };
  if (!safeEqual(c.codeHash, hmac(`${c.id}:${code}`))) {
    const left = MAX_ATTEMPTS - c.attempts;
    return {
      ok: false,
      code: left > 0 ? "INVALID" : "LOCKED",
      message: left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong codes. Request a new one.",
    };
  }
  await db.update(supportVerifications).set({ verifiedAt: now }).where(eq(supportVerifications.id, c.id));
  const [o] = await db.select({ addr: orders.shippingAddress }).from(orders).where(eq(orders.id, c.orderId));
  const email = ((o?.addr ?? {}) as { email?: string }).email?.trim().toLowerCase() ?? "";
  return { ok: true, customerId: c.customerId, orderId: c.orderId, email };
}

/** Housekeeping: verification rows are only needed briefly. */
export async function purgeOldVerifications(now: Date = new Date()): Promise<void> {
  await db.delete(supportVerifications).where(lt(supportVerifications.createdAt, new Date(now.getTime() - 7 * 86_400_000)));
}
