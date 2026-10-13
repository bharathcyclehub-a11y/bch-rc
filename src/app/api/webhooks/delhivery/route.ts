/**
 * /api/webhooks/delhivery — Delhivery "scan push" status events for parcels
 * booked directly on Delhivery.
 *
 * Not self-serve: Delhivery's integration team enables scan push after we
 * send their Scan Push requirement doc (endpoint + headers) to
 * lastmile-integration@delhivery.com — see COURIERS.md. Until
 * then the tracking worker polls Delhivery, and it keeps polling afterwards
 * as reconciliation (a failed push is retried once by Delhivery, then lost).
 *
 * Authenticity: Delhivery does not sign bodies; the scan-push setup lets us
 * name a header, and we ask for `x-api-key: <DELHIVERY_WEBHOOK_TOKEN>`,
 * compared in constant time. No token configured → events are refused
 * (never fail open).
 *
 * Delhivery needs a 200 within 500 ms, so the event is stored in
 * webhooks_inbound (dedup on waybill + status + status time + NSL code) and
 * answered at once; processing runs after the response, and a failure there
 * leaves processed=false for the tracking worker's retry (max 5 attempts).
 */

import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { db } from "@/db";
import { webhooksInbound } from "@/db/schema";
import { envStr } from "@/lib/env";
import { logWarn } from "@/lib/logger";
import type { DelhiveryWebhook } from "@/lib/tracking/carrier";
import { delhiveryWebhookExternalId, processStoredDelhiveryWebhook } from "@/lib/tracking/webhook";

const ok = () => NextResponse.json({ ok: true });

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  return ok();
}

export async function POST(req: Request) {
  const expected = envStr("DELHIVERY_WEBHOOK_TOKEN");
  if (!expected) {
    logWarn("delhivery:webhook", "DELHIVERY_WEBHOOK_TOKEN unset — refusing to process events");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!tokenMatches(req.headers.get("x-api-key"), expected)) {
    logWarn("delhivery:webhook", "POST with missing/wrong x-api-key — event dropped");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let event: DelhiveryWebhook;
  try {
    event = JSON.parse(await req.text()) as DelhiveryWebhook;
  } catch {
    return ok();
  }
  if (!event?.Shipment?.AWB) return ok();

  const externalId = delhiveryWebhookExternalId(event);
  const inserted = await db
    .insert(webhooksInbound)
    .values({ source: "delhivery", externalId, payload: event, processed: false })
    .onConflictDoNothing({ target: [webhooksInbound.source, webhooksInbound.externalId] })
    .returning({ id: webhooksInbound.id });
  if (inserted.length === 0) return NextResponse.json({ ok: true, duplicate: true });

  after(async () => {
    const result = await processStoredDelhiveryWebhook(inserted[0].id, externalId, event);
    if (result.error) logWarn("delhivery:webhook", "processing failed — queued for retry", { externalId });
  });
  return ok();
}
