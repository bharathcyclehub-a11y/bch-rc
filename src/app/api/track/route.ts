/**
 * POST /api/track — first-party pageview ingestion.
 *
 * Called SERVER-TO-SERVER by the edge middleware (never by the browser), so
 * ad-blockers can't intercept it. The middleware fires this ONCE per session —
 * on session start — to INSERT the session row with first-touch attribution
 * (source/referrer/utm, set only on insert and never overwritten). This is the
 * ad-blocker-proof, dashboard-of-record signal.
 *
 * Per-navigation liveness (last_seen_at) and the pageview tally are bumped
 * separately by the batched /api/track/event handler (recordFunnelEvents), so
 * an engaged visit costs one server round-trip at the start rather than one per
 * navigation.
 *
 * Pageview count ownership (single writer): this route INSERTs the session with
 * pageview_count = 0 and NEVER increments it — the batched event handler is the
 * sole owner and counts every page_view event (including the landing one). The
 * old default of 1 here PLUS the landing page_view event double-counted the
 * first page of every session. The ON CONFLICT branch only refreshes
 * last_seen_at (a rare same-sid re-insert must not re-add a pageview).
 *
 * This endpoint is best-effort: it must never throw back to the middleware
 * (which is in the critical path of every page load). All failures are logged
 * and swallowed; it always returns 204.
 */

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { sites, analyticsSessions } from "@/db/schema";
import {
  classifySource,
  isBotUA,
  referrerHostOf,
  type TrafficSource,
} from "@/lib/analytics";
import { logError } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { cleanTrackingPath, isTrackingUuid } from "@/lib/funnel-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TrackBody = {
  sid?: string;
  vid?: string;
  path?: string;
  referrer?: string | null;
  host?: string | null;
  country?: string | null;
  ua?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
};

// --- host → site_id resolution, cached (sites change ~never) ------------------
let sitesCache: { at: number; map: Map<string, string> } | null = null;
const SITES_TTL_MS = 10 * 60 * 1000;

async function resolveSiteId(host: string | null | undefined): Promise<string> {
  const fallback = process.env.DEFAULT_SITE_ID ?? "prc";
  const clean = (host ?? "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(":")[0];
  if (!clean) return fallback;

  if (!sitesCache || Date.now() - sitesCache.at > SITES_TTL_MS) {
    try {
      const rows = await db
        .select({ id: sites.id, domain: sites.domain })
        .from(sites);
      const map = new Map<string, string>();
      for (const r of rows) {
        map.set(r.domain.toLowerCase().replace(/^www\./, ""), r.id);
      }
      sitesCache = { at: Date.now(), map };
    } catch (err) {
      logError("track:resolveSite", err);
      return fallback;
    }
  }
  return sitesCache.map.get(clean) ?? fallback;
}

export async function POST(req: NextRequest) {
  // Optional shared secret — set ANALYTICS_TRACK_SECRET in the env on both the
  // middleware and this route (same Vercel project, same env) to reject
  // spoofed pageviews. If unset, the endpoint accepts (lets tracking work
  // before the secret is provisioned).
  const secret = process.env.ANALYTICS_TRACK_SECRET;
  if (secret && req.headers.get("x-track-secret") !== secret) {
    return new NextResponse(null, { status: 204 });
  }
  if (!secret) {
    const limited = rateLimit(req, { scope: "track:session", limit: 120, silent: true });
    if (limited) return limited;
  }

  let body: TrackBody;
  try {
    const raw = await req.text();
    if (raw.length > 16_384) return new NextResponse(null, { status: 204 });
    body = JSON.parse(raw) as TrackBody;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (!body || typeof body !== "object") return new NextResponse(null, { status: 204 });
  const { sid, vid } = body;
  if (!isTrackingUuid(sid) || !isTrackingUuid(vid)) return new NextResponse(null, { status: 204 });
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && value !== undefined && (typeof value !== "string" || value.length > 2048)) return new NextResponse(null, { status: 204 });
    if (key === "path" && !cleanTrackingPath(value)) return new NextResponse(null, { status: 204 });
  }

  try {
    const ua = body.ua ?? req.headers.get("user-agent");
    const bot = isBotUA(ua);
    if (bot) return new NextResponse(null, { status: 204 });
    const siteId = await resolveSiteId(body.host);
    const refHost = referrerHostOf(body.referrer);
    const source: TrafficSource = classifySource({
      utmMedium: body.utm_medium,
      utmSource: body.utm_source,
      referrerHost: refHost,
      selfHost: body.host,
    });

    await db
      .insert(analyticsSessions)
      .values({
        id: sid,
        visitorId: vid,
        siteId,
        source,
        referrer: body.referrer ?? null,
        referrerHost: refHost,
        landingPath: body.path ?? null,
        utmSource: body.utm_source ?? null,
        utmMedium: body.utm_medium ?? null,
        utmCampaign: body.utm_campaign ?? null,
        utmTerm: body.utm_term ?? null,
        utmContent: body.utm_content ?? null,
        country: body.country ?? null,
        userAgent: ua ?? null,
        isBot: bot,
        // Start at 0: the batched /api/track/event handler owns the pageview
        // tally and increments once per page_view event (landing included).
        // Overrides the schema default of 1 so the first page isn't counted twice.
        pageviewCount: 0,
      })
      .onConflictDoUpdate({
        target: analyticsSessions.id,
        // Only refresh liveness on a re-insert — do NOT bump pageview_count here
        // (events own it), or a rare duplicate session start would over-count.
        set: {
          lastSeenAt: new Date(),
        },
      });
  } catch (err) {
    logError("track:upsert", err, { sid });
  }

  return new NextResponse(null, { status: 204 });
}
