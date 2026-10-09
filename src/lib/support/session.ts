/**
 * Verified-customer session for the Support Centre.
 *
 * After a guest proves they own an order (email code, verify.ts) they get a
 * signed, httpOnly cookie scoped to their customer id for a few hours. Every
 * order/ticket read re-checks ownership against that id on the server.
 *
 * Signing key: SUPPORT_SESSION_SECRET, or — so production works without a new
 * secret — a key derived (HKDF, separate label) from CRON_SECRET. In
 * development a fixed local key is used; production without either refuses.
 */

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "prc_support";
const TTL_SECONDS = 4 * 60 * 60;

let cachedKey: Buffer | null = null;

export function supportKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env.SUPPORT_SESSION_SECRET;
  const cron = process.env.CRON_SECRET;
  if (explicit) cachedKey = Buffer.from(explicit, "utf8");
  else if (cron) cachedKey = Buffer.from(hkdfSync("sha256", cron, "prc-support", "support-session-v1", 32));
  else if (process.env.NODE_ENV !== "production") cachedKey = Buffer.from("prc-support-local-dev-only", "utf8");
  else throw new Error("SUPPORT_SESSION_SECRET (or CRON_SECRET) must be set for customer verification");
  return cachedKey;
}

export function hmac(value: string): string {
  return createHmac("sha256", supportKey()).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SupportSession = {
  customerId: string;
  /** The email that received the code (masked in UI). */
  email: string;
  /** The order used to verify. */
  orderId: string;
  exp: number;
};

export function signSession(s: Omit<SupportSession, "exp">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + TTL_SECONDS })).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function readSessionToken(token: string | undefined, now = Date.now()): SupportSession | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, hmac(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SupportSession;
    if (!s.customerId || !s.exp || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

export async function getSupportSession(): Promise<SupportSession | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(COOKIE)?.value);
}

/** Call from a server action or route handler only. */
export async function setSupportSession(s: Omit<SupportSession, "exp">): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, signSession(s), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function clearSupportSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** "sandeep@gmail.com" → "s•••••@gmail.com" */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(6, user.length - 1)))}@${domain}`;
}

/** "9876543210" → "••••••3210" */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length >= 4 ? `••••••${d.slice(-4)}` : "••••";
}
