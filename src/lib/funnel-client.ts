/**
 * Client-side funnel tracker. Buffers user actions and flushes them to
 * /api/track/event in small batches (fetch keepalive), plus a best-effort
 * sendBeacon flush when the tab is hidden/closed to reduce loss of the last
 * events of a session (the most important ones — where they dropped off).
 *
 * First-party, no PII, business-essential → fires for EVERY visitor with no
 * consent gate, exactly like the server-side session tracking. This is the
 * data Syed needs: of N visitors, how many reach each step and where they stop.
 */

import { cleanFunnelMetadata, cleanTrackingPath, MAX_FUNNEL_BATCH, MAX_FUNNEL_BODY_BYTES, type FunnelEventType } from "@/lib/funnel-events";
import { shouldTrackPath } from "@/lib/analytics";

type Buffered = {
  eventId: string;
  type: FunnelEventType;
  path: string;
  metadata: Record<string, unknown>;
  orderId?: string | null;
};

const ENDPOINT = "/api/track/event";
const FLUSH_DEBOUNCE_MS = 1200;

const buffer: Buffered[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function send(useBeacon: boolean) {
  while (buffer.length > 0) {
    const events = buffer.splice(0, MAX_FUNNEL_BATCH);
    // Metadata is bounded before buffering. Limit the byte size as well because
    // sendBeacon and keepalive share a small per-browser request budget.
    while (events.length > 1 && new TextEncoder().encode(JSON.stringify({ events })).length > MAX_FUNNEL_BODY_BYTES) {
      buffer.unshift(events.pop()!);
    }
    const payload = JSON.stringify({ events });
    try {
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const queued = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
        if (queued) continue;
      }
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Telemetry must never throw into the UI.
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    send(false);
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Record a funnel event. `immediate: true` flushes right away (use for events
 * that may be followed by a navigation/redirect — order_submitted, payment_*,
 * purchase — so they aren't lost in the buffer).
 */
export function trackFunnel(
  type: FunnelEventType,
  metadata: Record<string, unknown> = {},
  opts?: { path?: string; orderId?: string | null; immediate?: boolean },
): void {
  if (typeof window === "undefined") return;
  const path = cleanTrackingPath(opts?.path ?? window.location.pathname);
  if (!path || !shouldTrackPath(path)) return;
  buffer.push({
    eventId: crypto.randomUUID(),
    type,
    path,
    metadata: cleanFunnelMetadata(metadata),
    orderId: opts?.orderId ?? null,
  });
  if (opts?.immediate) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    send(false);
  } else {
    scheduleFlush();
  }
}

// Best-effort delivery when the visitor leaves — captures the final (drop-off)
// event of the session. Registered once per client bundle.
if (typeof window !== "undefined") {
  const flushNow = () => send(true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}
