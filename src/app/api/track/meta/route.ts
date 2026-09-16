/**
 * POST /api/track/meta — Meta Conversions API relay.
 *
 * Called by analytics-client.ts in parallel with every browser Pixel fire.
 * Both events carry the same `event_id` so Meta dedups them on its side —
 * we count the event once whether the browser pixel succeeded or got
 * blocked by ad-blockers / iOS ITP / Brave.
 *
 * Privacy: Meta requires SHA-256 hashed user identifiers (em, ph). We
 * hash on the server (never send plaintext over the wire) and lowercase /
 * trim per Meta's spec.
 *
 * Hard rules:
 *  - The endpoint is a no-op (returns 204) if env vars NEXT_PUBLIC_META_PIXEL_ID
 *    + META_CAPI_TOKEN aren't both set. So merging this code before Syed
 *    provides the IDs is safe.
 *  - Failures NEVER throw to the client. Best-effort.
 *  - The user's IP + UA are read from request headers — same buyer the
 *    browser pixel saw, so Meta's matching logic links the two events.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { logError } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { isBotUA } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CapiUserData = {
  em?: string[]; // hashed emails
  ph?: string[]; // hashed phone numbers (E.164 digits, no +)
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string; // _fbp cookie if present (Pixel browser ID)
  fbc?: string; // _fbc cookie if present (click ID)
};

type CapiEvent = {
  event_name: string;
  event_time: number; // unix seconds
  event_id: string;
  event_source_url: string;
  action_source: "website";
  user_data: CapiUserData;
  custom_data?: Record<string, unknown>;
};

type Body = {
  consent?: string;
  eventName: string;
  eventId: string;
  eventTime: number;
  customData?: Record<string, unknown>;
  userData?: { email?: string | null; phone?: string | null };
  sourceUrl?: string;
};

const sha256 = (s: string) =>
  createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  // Indian numbers: strip the leading 0 / + / 91 prefix variations and store
  // as E.164-style "91XXXXXXXXXX" before hashing, so Meta can match against
  // the Pixel's normalised version of the same number.
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  return digits;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if ((origin && origin !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site" || isBotUA(req.headers.get("user-agent"))) {
    return new NextResponse(null, { status: 204 });
  }
  // Cap per-IP so the configured CAPI relay can't be driven to flood Meta with
  // fabricated conversions. Silent 204 keeps the best-effort telemetry contract.
  const limited = rateLimit(req, { scope: "track:meta", limit: 120, silent: true });
  if (limited) return limited;

  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  // Both must be set or we silently no-op. Lets us merge this code today
  // and turn it on later by adding env vars in Vercel.
  if (!pixelId || !token) return new NextResponse(null, { status: 204 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!body || body.consent !== "accepted" || !["PageView", "AddToCart", "InitiateCheckout", "Purchase"].includes(body.eventName) || typeof body.eventId !== "string" || body.eventId.length > 128) {
    return new NextResponse(null, { status: 204 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined;
  const ua = req.headers.get("user-agent") ?? undefined;
  // _fbp / _fbc cookies set by the browser Pixel — Meta's matching gets
  // dramatically better when they're attached to the server event too.
  const fbp = req.cookies.get("_fbp")?.value;
  const fbc = req.cookies.get("_fbc")?.value;

  const user_data: CapiUserData = {
    client_ip_address: ip,
    client_user_agent: ua,
    fbp,
    fbc,
  };
  if (body.userData?.email) user_data.em = [sha256(body.userData.email)];
  if (body.userData?.phone)
    user_data.ph = [sha256(normalisePhone(body.userData.phone))];

  const event: CapiEvent = {
    event_name: body.eventName,
    event_time: body.eventTime || Math.floor(Date.now() / 1000),
    event_id: body.eventId,
    event_source_url: body.sourceUrl ?? req.headers.get("referer") ?? "",
    action_source: "website",
    user_data,
    custom_data: body.customData,
  };

  try {
    const url =
      `https://graph.facebook.com/v18.0/${pixelId}/events` +
      `?access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: [event] }),
      // Tight timeout so a slow Meta endpoint can't backpressure our server.
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) {
      const txt = await r.text();
      logError("capi:meta", new Error(`${r.status} ${txt.slice(0, 200)}`));
    }
  } catch (err) {
    logError("capi:meta", err);
  }

  return new NextResponse(null, { status: 204 });
}
