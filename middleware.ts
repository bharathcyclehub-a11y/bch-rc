/**
 * Next.js middleware. Two jobs:
 *  1. Refresh the Supabase session cookie on every request (without this, SSR
 *     pages won't see the logged-in user).
 *  2. First-party visitor analytics — assign the visitor (prc_vid) and session
 *     (prc_sid) cookies and, on session START only, record the session by
 *     calling /api/track SERVER-TO-SERVER via event.waitUntil. Because the
 *     browser never issues that request, ad-blockers can't strip it — the main
 *     accuracy win over client-side analytics. Per-navigation liveness is
 *     bumped by the batched /api/track/event handler instead, so an engaged
 *     visit costs one round-trip at the start, not one per navigation.
 *
 * Runs on the edge runtime, so it must not touch postgres-js directly; the DB
 * write happens in the node /api/track route.
 */

import { createServerClient } from "@supabase/ssr";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
// Relative import (not the "@/" alias) on purpose: a freshly-created Vercel
// project can externalize alias-resolved imports in the Edge middleware bundle
// ("The Edge Function 'middleware' is referencing unsupported modules:
// @/lib/analytics"), failing the deploy. A relative path always inlines
// correctly across project configs and is harmless everywhere else.
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  VISITOR_COOKIE,
  VISITOR_TTL_SECONDS,
  UTM_KEYS,
  shouldTrackPath,
  isBotUA,
} from "./src/lib/analytics";
import { selfOrigin } from "./src/lib/request-origin";

// MAINTENANCE MODE — gated by env var. Runs BEFORE Supabase/analytics so a
// paused site doesn't waste a DB round-trip on every request. Toggle via
// Vercel dashboard: set MAINTENANCE_MODE=true → site rewrites every route
// to /maintenance with HTTP 503 (Google reads 503 + Retry-After as
// "temporary, do not de-index"). Set it back to false (or delete) → live.
//
// Tolerant of BOM/CRLF/whitespace/case because PowerShell's
// `"true" | vercel env add` pipeline silently mangles the value.
//
// Operator bypass: set MAINTENANCE_BYPASS_TOKEN in Vercel, visit
// /?unlock=<token> once — a 7-day cookie lets you preview the live site
// while it stays down for everyone else.
const MAINT_BYPASS_COOKIE = "prc_maint_bypass";

function maintenanceCheck(request: NextRequest): NextResponse | null {
  const raw = (process.env.MAINTENANCE_MODE ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase();
  if (raw !== "true" && raw !== "1" && raw !== "on") return null;

  const { pathname, searchParams } = request.nextUrl;

  // Allow the maintenance page itself + Next plumbing + crawler files so
  // Google can still see robots.txt / sitemap.xml correctly.
  if (
    pathname === "/maintenance" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/logo/")
  ) {
    return null;
  }

  // Operator bypass: ?unlock=<token> sets a cookie, then every request from
  // this browser sees the live site for 7 days.
  const bypassToken = process.env.MAINTENANCE_BYPASS_TOKEN;
  if (bypassToken) {
    if (searchParams.get("unlock") === bypassToken) {
      const res = NextResponse.next();
      res.cookies.set(MAINT_BYPASS_COOKIE, bypassToken, {
        maxAge: 60 * 60 * 24 * 7,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      return res;
    }
    if (request.cookies.get(MAINT_BYPASS_COOKIE)?.value === bypassToken) {
      return null;
    }
  }

  const url = request.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  return NextResponse.rewrite(url, {
    status: 503,
    headers: { "Retry-After": "3600" },
  });
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const maintResponse = maintenanceCheck(request);
  if (maintResponse) return maintResponse;

  // 1:16 "Big" store on its own subdomain. When a request arrives on the host
  // named in STORE16_HOST (e.g. big.pocketrccars.com), serve the /16 store at
  // the root. Env-gated → completely inert until the subdomain is configured in
  // Vercel, so this is a no-op for the main site. Only the root path is
  // rewritten; /16/*, /checkout, /api, /track etc. already resolve as-is.
  const store16Host = process.env.STORE16_HOST?.trim().toLowerCase();
  if (store16Host) {
    const host = (request.headers.get("host") ?? "")
      .toLowerCase()
      .split(":")[0];
    const path = request.nextUrl.pathname;
    if (host === store16Host) {
      // On the 16 subdomain, serve the /16 store at the root.
      if (path === "/") {
        const url = request.nextUrl.clone();
        url.pathname = "/16";
        return NextResponse.rewrite(url);
      }
    } else if (path === "/16" || path.startsWith("/16/")) {
      // On the MAIN domain (pocketrccars.com), the 16 store lives ONLY on its
      // subdomain — permanently redirect the old /16 path there so it isn't a
      // duplicate, indexable URL. (Inert in local/preview where STORE16_HOST is
      // unset, so /16 stays reachable for development.)
      return NextResponse.redirect(
        `https://${store16Host}${path}${request.nextUrl.search}`,
        308,
      );
    }
  }

  let response = NextResponse.next({ request });

  // Supabase session refresh — ONLY when configured. A preview deploy without
  // the Supabase env vars must not take down the whole site with
  // MIDDLEWARE_INVOCATION_FAILED; skip the refresh (auth-gated pages degrade
  // gracefully) and still serve the page + analytics. Production has the vars,
  // so this is a no-op there.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supaUrl && supaKey) {
    const supabase = createServerClient(supaUrl, supaKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    try {
      await supabase.auth.getUser();
    } catch {
      // Best-effort: an auth hiccup must never 500 page delivery.
    }
  }

  // --- First-party analytics -------------------------------------------------
  trackPageview(request, response, event);

  return response;
}

/**
 * Assigns identity cookies and fires the server-side pageview. Counts document
 * loads and client-side (RSC) navigations, but skips prefetches — Next issues
 * a prefetch request for links in view, which is not a real visit.
 */
function trackPageview(
  request: NextRequest,
  response: NextResponse,
  event: NextFetchEvent,
): void {
  const isPrefetch =
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("x-purpose") === "prefetch";

  if (
    request.method !== "GET" ||
    isPrefetch ||
    !shouldTrackPath(request.nextUrl.pathname)
  ) {
    return;
  }

  // Identity cookies. Both are SET-ONLY-IF-MISSING so the response carries no
  // Set-Cookie on the cached path. The previous code re-set prc_sid on every
  // hit to "slide" the 30-min window, which forced Set-Cookie on every page
  // render and made Vercel treat the response as uncacheable. The sliding
  // behaviour is now handled in the DB row instead - /api/track bumps
  // analytics_sessions.last_seen_at on every beacon, so the session window
  // still slides even though the browser-side cookie's maxAge is fixed.
  //
  // Trade-off: a visitor who keeps a tab idle for >30 min then refreshes
  // gets a new sid (a clean new session). Previously the sliding cookie
  // would let them keep the same sid forever as long as they navigated
  // within 30 min of the last hit. The DB row still treats the visit as
  // one session via the vid match, so the sid renewal is the cleanly
  // correct semantic, not a regression.
  const secure = process.env.NODE_ENV === "production";
  let vid = request.cookies.get(VISITOR_COOKIE)?.value;
  let sid = request.cookies.get(SESSION_COOKIE)?.value;
  const writesIdentity = !vid || !sid;
  if (!vid) {
    vid = crypto.randomUUID();
    response.cookies.set(VISITOR_COOKIE, vid, {
      maxAge: VISITOR_TTL_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
    });
  }
  if (!sid) {
    sid = crypto.randomUUID();
    response.cookies.set(SESSION_COOKIE, sid, {
      maxAge: SESSION_TTL_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
    });
  }
  // Cooperative signal so the cache layer can short-circuit on returning
  // visitors. Vercel ignores `private` on the response if Set-Cookie is
  // present (which we've now eliminated for returning visitors). The
  // Cache-Control header is set further up the chain by the route; we just
  // flag this for the route to read if it wants to.
  //
  // The server-side session write fires ONCE per session — on session start (a
  // freshly-minted sid/vid). This is the ad-blocker-proof signal every
  // dashboard-of-record metric is built from: it INSERTs the session row with
  // first-touch attribution (source/utm/referrer), captured only at insert and
  // never overwritten. Mid-session navigations need no write here — the
  // per-navigation liveness (last_seen_at) is bumped by the already-batched
  // /api/track/event handler (see recordFunnelEvents), so an engaged visit no
  // longer costs one edge request PER navigation, only one at the start.
  if (!writesIdentity) {
    response.headers.set("x-prc-identity", "warm");
    return;
  }

  // Detected crawlers are excluded from every dashboard count (is_bot = false
  // filter), so recording their session changes no displayed number — skip the
  // round-trip rather than pay an edge request for a row nothing reads.
  if (isBotUA(request.headers.get("user-agent"))) return;

  const url = request.nextUrl;
  const payload: Record<string, string | null> = {
    sid,
    vid,
    path: url.pathname,
    referrer: request.headers.get("referer"),
    host: request.headers.get("host") ?? url.host,
    country: request.headers.get("x-vercel-ip-country"),
    ua: request.headers.get("user-agent"),
  };
  for (const k of UTM_KEYS) payload[k] = url.searchParams.get(k);

  const secret = process.env.ANALYTICS_TRACK_SECRET;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret) headers["x-track-secret"] = secret;

  // Fire-and-forget, server-to-server. waitUntil keeps the function alive until
  // the POST resolves without delaying the user's response.
  event.waitUntil(
    fetch(`${selfOrigin(request)}/api/track`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Best-effort: a dropped beacon must never affect page delivery.
    }),
  );
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - images / videos / fonts
     * - api/webhooks/* (external services like Shiprocket/Razorpay — must respond
     *   fast and never need a Supabase session refresh)
     * - api/track/* (first-party telemetry: the server-to-server session write,
     *   the batched funnel beacon, and the Meta CAPI relay — none need
     *   maintenance/store16/auth middleware, and excluding them stops the
     *   internal /api/track POST from re-running the whole middleware)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/track|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|woff2|ttf)$).*)",
  ],
};
