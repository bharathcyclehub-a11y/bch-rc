/**
 * Same-origin checks that survive a reverse proxy.
 *
 * `req.nextUrl.origin` is built from what the Node server itself sees. Behind
 * the VPS nginx that is `http://…` (TLS terminates at nginx), while the browser
 * sends `Origin: https://pocketrccars.com`. Comparing the two full origins then
 * fails on every real browser request — which is exactly what silently killed
 * client analytics after the 17 Sep 2026 cutover from Vercel: `page_view` went
 * from ~3,000/day to 0, because every batch was rejected as cross-origin.
 *
 * Compare HOSTS instead. nginx forwards `Host` unchanged, so the host is the
 * same on both sides of the proxy, and a genuine cross-site post still fails.
 */

import type { NextRequest } from "next/server";

/** True when the request has no Origin, or its Origin host matches ours. */
export function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  // No Origin header: same-origin navigation, sendBeacon in some browsers, or
  // a server-to-server call. The cookie/bot checks at the call site still apply.
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("host") ?? req.nextUrl.host);
  } catch {
    return false;
  }
}

/**
 * The externally-reachable base URL for a server-to-server call back into this
 * app (the middleware tracking beacon). Uses the proxy's forwarded protocol so
 * we don't POST to `http://` and get bounced through nginx's redirect to HTTPS,
 * which turns the POST into a GET and drops the payload.
 *
 * `INTERNAL_ORIGIN` overrides it — set it to `http://127.0.0.1:<port>` on a
 * host whose network can't route its own public domain back to itself.
 */
export function selfOrigin(req: {
  headers: Headers;
  nextUrl: { protocol: string; host: string };
}): string {
  const override = process.env.INTERNAL_ORIGIN?.trim();
  if (override) return override.replace(/\/$/, "");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    req.nextUrl.protocol.replace(/:$/, "");
  const host = req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}
