/**
 * Server-side funnel-event writer.
 *
 * Both the public batch endpoint (/api/track/event) and server routes that
 * want to record an authoritative event (e.g. /api/serviceability logging
 * every pincode result) go through here. The visitor/session identity is read
 * from the httpOnly prc_sid / prc_vid cookies on the REQUEST — the browser
 * never has to expose them to JS, and a spoofed body can't forge a session.
 *
 * Telemetry must never break a user flow, so every write is best-effort: it
 * swallows and logs failures and returns rather than throwing.
 */

import type { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { funnelEvents, analyticsSessions } from "@/db/schema";
import { SESSION_COOKIE, VISITOR_COOKIE, isBotUA, shouldTrackPath } from "@/lib/analytics";
import { cleanFunnelMetadata, cleanTrackingPath, isFunnelEvent, isTrackingUuid, MAX_FUNNEL_BATCH, type FunnelEventType } from "@/lib/funnel-events";
import { logError } from "@/lib/logger";

const SITE_ID = process.env.DEFAULT_SITE_ID ?? "prc";

export type FunnelEventInput = {
  eventId?: string;
  type: FunnelEventType | string;
  path?: string | null;
  metadata?: Record<string, unknown> | null;
  orderId?: string | null;
};

type Ids = { sessionId: string | null; visitorId: string | null; isBot: boolean };

function idsFromRequest(req: NextRequest): Ids {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  const vid = req.cookies.get(VISITOR_COOKIE)?.value;
  return {
    sessionId: isTrackingUuid(sid) ? sid : null,
    visitorId: isTrackingUuid(vid) ? vid : null,
    isBot: isBotUA(req.headers.get("user-agent")),
  };
}

/** Bulk-insert a batch of funnel events for one request's session. */
export async function recordFunnelEvents(
  req: NextRequest,
  items: FunnelEventInput[],
): Promise<void> {
  if (!items.length) return;
  const { sessionId, visitorId, isBot } = idsFromRequest(req);
  if (isBot) return;

  const rows = items
    .filter((e) => e && typeof e === "object" && isFunnelEvent(String(e.type)))
    .filter((e) => !e.path || shouldTrackPath(cleanTrackingPath(e.path) ?? ""))
    .slice(0, MAX_FUNNEL_BATCH)
    .map((e) => ({
      ...(isTrackingUuid(e.eventId) ? { id: e.eventId } : {}),
      siteId: SITE_ID,
      sessionId,
      visitorId,
      type: String(e.type),
      path: cleanTrackingPath(e.path),
      metadata: cleanFunnelMetadata(e.metadata),
      orderId: e.orderId ? String(e.orderId).slice(0, 64) : null,
      isBot,
    }));

  if (!rows.length) return;
  try {
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(funnelEvents).values(rows)
        .onConflictDoNothing({ target: funnelEvents.id })
        .returning({ type: funnelEvents.type });
      if (sessionId && visitorId && inserted.length > 0) {
        const pageviews = inserted.filter((r) => r.type === "page_view").length;
        await tx.update(analyticsSessions).set({
          lastSeenAt: new Date(),
          pageviewCount: sql`${analyticsSessions.pageviewCount} + ${pageviews}`,
        }).where(and(eq(analyticsSessions.id, sessionId), eq(analyticsSessions.visitorId, visitorId)));
      }
    });
  } catch (err) {
    logError("funnel:record-batch", err, { count: rows.length });
  }
}

/** Record a single event from inside a server route (authoritative source). */
export async function recordServerFunnelEvent(
  req: NextRequest,
  type: FunnelEventType,
  metadata?: Record<string, unknown>,
  opts?: { path?: string | null; orderId?: string | null },
): Promise<void> {
  // Order creation retries may execute this hook again. Use a stable UUID in
  // the existing primary key so retries cannot duplicate authoritative events.
  const digest = type === "order_submitted" && opts?.orderId
    ? createHash("sha256").update(`${SITE_ID}:${type}:${opts.orderId}`).digest("hex")
    : null;
  const eventId = digest ? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}` : undefined;
  await recordFunnelEvents(req, [
    { eventId, type, metadata: metadata ?? {}, path: opts?.path ?? null, orderId: opts?.orderId ?? null },
  ]);
}
