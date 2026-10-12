/**
 * /api/webhooks/courier — Shiprocket shipment tracking events.
 *
 * Path renamed away from /shiprocket because their URL validator rejects
 * URLs containing the literal "shiprocket" keyword.
 *
 * Authenticity: Shiprocket's webhook mechanism is a shared token sent in the
 * `x-api-key` header (they do not sign bodies). We compare it in constant
 * time against SHIPROCKET_WEBHOOK_TOKEN and NEVER fail open.
 *
 * Webhook validator tolerance:
 *  Shiprocket's "Save" and "Test Webhook" buttons probe the endpoint with
 *  unpredictable payloads (sometimes empty body, sometimes GET, sometimes
 *  HEAD, sometimes without our custom header). Anything other than 200 is
 *  reported to the user as "Please check your endpoint, unable to send
 *  request to mentioned api." So this handler:
 *   - answers 200 to GET / HEAD (reachability probes)
 *   - answers 200 to POST with missing/wrong x-api-key (auth probes), no writes
 *   - answers 200 to POST with empty or malformed body (shape probes)
 *   - only writes to the DB when the body is a real, parseable event
 *
 * Processing (src/lib/tracking/webhook.ts): the event is stored in
 * webhooks_inbound FIRST (dedup on a key that includes the courier
 * timestamp), then ingested — scans become immutable tracking events, the
 * shipment state is rebuilt, exceptions are reconciled. If processing fails
 * the row keeps processed=false and the tracking worker retries it, so we
 * still answer 200: the event is safe with us and a retry storm from
 * Shiprocket would only add duplicates.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhooksInbound } from "@/db/schema";
import { logWarn } from "@/lib/logger";
import { processStoredWebhook, webhookExternalId } from "@/lib/tracking/webhook";
import type { ShiprocketWebhook } from "@/lib/tracking/carrier";

// IMPORTANT: each call MUST construct its own NextResponse. Reusing a
// module-level constant breaks because Response bodies are single-use streams.
const ok = () => NextResponse.json({ ok: true });

export async function GET() {
  return ok();
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN;
  if (!expected) {
    logWarn("courier:webhook", "SHIPROCKET_WEBHOOK_TOKEN unset — refusing to process events");
    return ok();
  }
  if (!tokenMatches(req.headers.get("x-api-key"), expected)) {
    // Ack 200 (validator tolerance) but leave a trace: a wrong token pasted in
    // the Shiprocket dashboard is otherwise indistinguishable from "never
    // configured" — every real event silently vanishes.
    logWarn("courier:webhook", "POST with missing/wrong x-api-key — event dropped");
    return ok();
  }

  const rawBody = await req.text();
  if (!rawBody.trim()) return ok();

  let event: ShiprocketWebhook;
  try {
    event = JSON.parse(rawBody) as ShiprocketWebhook;
  } catch {
    return ok();
  }
  if (!event || typeof event !== "object" || (!event.awb && !event.order_id && !event.channel_order_id)) {
    return ok();
  }

  const externalId = webhookExternalId(event);
  // Idempotent insert via ON CONFLICT DO NOTHING on (source, external_id).
  // Shiprocket's "Test Webhook" button sends the SAME payload every time.
  const inserted = await db
    .insert(webhooksInbound)
    .values({ source: "shiprocket", externalId, payload: event, processed: false })
    .onConflictDoNothing({ target: [webhooksInbound.source, webhooksInbound.externalId] })
    .returning({ id: webhooksInbound.id });

  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const result = await processStoredWebhook(inserted[0].id, externalId, event);
  if (result.error) logWarn("courier:webhook", "processing failed — queued for retry", { externalId });
  return NextResponse.json({ ok: true, matched: result.matched });
}
