/**
 * POST /api/track/event — first-party funnel-event ingestion.
 *
 * The browser's funnel tracker (src/lib/funnel-client.ts) batches user actions
 * and flushes them here via fetch(keepalive) / sendBeacon. We read the
 * visitor/session identity from the request cookies (not the body), bot-filter,
 * and bulk-insert. Always 204 — telemetry must never surface an error to the
 * page. No consent gate: this is first-party, no-PII, business-essential data,
 * exactly like /api/track session tracking.
 */

import { NextResponse, type NextRequest } from "next/server";
import { recordFunnelEvents, type FunnelEventInput } from "@/lib/funnel-server";
import { isTrackingUuid, MAX_FUNNEL_BATCH, MAX_FUNNEL_BODY_BYTES } from "@/lib/funnel-events";
import { VISITOR_COOKIE } from "@/lib/analytics";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { events?: FunnelEventInput[] };

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if ((origin && origin !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site" || !isTrackingUuid(req.cookies.get(VISITOR_COOKIE)?.value)) {
    return new NextResponse(null, { status: 204 });
  }
  // Shed floods that would bloat funnel_events. Silent 204 keeps the
  // "never surface an error to the page" telemetry contract. Generous cap so
  // real batched browsing is never throttled.
  const limited = rateLimit(req, { scope: "track:event", limit: 120, silent: true });
  if (limited) return limited;

  let body: Body;
  try {
    // sendBeacon sends as text/plain; parse defensively regardless of header.
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_FUNNEL_BODY_BYTES) return new NextResponse(null, { status: 204 });
    body = JSON.parse(raw) as Body;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const events = body && Array.isArray(body.events)
    ? body.events.slice(0, MAX_FUNNEL_BATCH).filter((e) => e && typeof e === "object" && e.type !== "order_submitted")
    : [];
  if (events.length) await recordFunnelEvents(req, events);

  return new NextResponse(null, { status: 204 });
}
