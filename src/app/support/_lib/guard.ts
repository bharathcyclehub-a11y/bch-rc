/**
 * Server-action guards for the customer Support Centre.
 *
 * Route handlers use rateLimit(req) directly; server actions have no Request,
 * so the client IP is read from the forwarded headers the same way
 * clientIp() does (x-real-ip first, then the leftmost x-forwarded-for).
 */

import { headers } from "next/headers";
import { checkLimits } from "@/lib/rate-limit";
import { hmac } from "@/lib/support/session";

export async function requestIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** HMAC of the client IP — what verify.ts stores, never the raw address. */
export async function requestIpHash(): Promise<string | null> {
  const ip = await requestIp();
  return ip === "unknown" ? null : hmac(`ip:${ip}`);
}

/** Per-IP fixed-window limit for a server action. Returns true when allowed. */
export async function allowAction(scope: string, limit: number, windowMs = 60_000): Promise<boolean> {
  const ip = await requestIp();
  const res = checkLimits(scope, Date.now(), [
    { key: `${scope}:ip:${ip}`, limit, windowMs, dimension: "ip" },
  ]);
  return !res.blocked;
}

export const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
