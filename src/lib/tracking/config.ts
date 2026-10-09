/**
 * Tracking configuration — polling intervals, staleness thresholds and
 * escalation rules. Defaults live here; ops can override any field from
 * /admin/support/settings (stored in app_settings under "tracking.config").
 *
 * Intervals are in MINUTES, thresholds in HOURS unless named otherwise.
 */

import { z } from "zod";

export const trackingConfigSchema = z.object({
  /** Poll interval while waiting for an AWB / courier pickup. */
  awaitingIntervalMin: z.number().int().min(15).max(1440),
  /** Poll interval while the parcel is moving normally. */
  movingIntervalMin: z.number().int().min(15).max(1440),
  /** Poll interval for out-for-delivery, failed attempts, delays and open exceptions. */
  attentionIntervalMin: z.number().int().min(15).max(1440),
  /** Poll interval for parcels returning to us (RTO). */
  rtoIntervalMin: z.number().int().min(15).max(1440),
  /** After a final status, one more check this many hours later, then stop. */
  finalReconcileHours: z.number().min(1).max(168),
  /** Failed sync: first retry after this many minutes, doubling each time… */
  failureBaseMin: z.number().int().min(5).max(240),
  /** …capped here. */
  failureMaxMin: z.number().int().min(15).max(1440),
  /** Shipments synced per worker run (keeps us inside courier API limits). */
  maxPerRun: z.number().int().min(1).max(200),
  /** Pause between courier API calls inside one run. */
  callSpacingMs: z.number().int().min(0).max(5000),
  /** Courier auth refused / rate limited → pause every sync this long. */
  circuitBreakMin: z.number().int().min(5).max(720),

  /** No new courier scan for this long while in transit → "no movement". */
  noMovementHours: z.number().min(6).max(240),
  /** Escalate "no movement" (ops alert + HIGH) after this long. */
  noMovementEscalateHours: z.number().min(12).max(480),
  /** AWB assigned but not picked up for this long → "pickup delayed". */
  pickupDelayHours: z.number().min(6).max(240),
  /** Shipment created but still no AWB after this long → admin exception. */
  missingAwbHours: z.number().min(1).max(240),
  /** No successful sync (poll or webhook) for this long → "sync failing". */
  syncStaleHours: z.number().min(1).max(72),
  /** Escalate an expired delivery estimate after this many days. */
  eddEscalateDays: z.number().int().min(1).max(30),
  /** Escalate after this many failed delivery attempts. */
  failedAttemptsEscalate: z.number().int().min(1).max(10),
});

export type TrackingConfig = z.infer<typeof trackingConfigSchema>;

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  awaitingIntervalMin: 120,
  movingIntervalMin: 60,
  attentionIntervalMin: 30,
  rtoIntervalMin: 180,
  finalReconcileHours: 24,
  failureBaseMin: 15,
  failureMaxMin: 360,
  maxPerRun: 40,
  callSpacingMs: 300,
  circuitBreakMin: 30,

  noMovementHours: 36,
  noMovementEscalateHours: 72,
  pickupDelayHours: 36,
  missingAwbHours: 12,
  syncStaleHours: 6,
  eddEscalateDays: 2,
  failedAttemptsEscalate: 2,
};

/** Merge a stored override onto the defaults, dropping invalid fields. */
export function resolveTrackingConfig(stored: unknown): TrackingConfig {
  if (!stored || typeof stored !== "object") return DEFAULT_TRACKING_CONFIG;
  const merged: Record<string, unknown> = { ...DEFAULT_TRACKING_CONFIG };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (!(k in DEFAULT_TRACKING_CONFIG)) continue;
    const field = trackingConfigSchema.shape[k as keyof TrackingConfig];
    if (field.safeParse(v).success) merged[k] = v;
  }
  return merged as TrackingConfig;
}
