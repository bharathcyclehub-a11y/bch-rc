/**
 * Display helpers shared by the shipment-exceptions list and the order detail
 * tracking panel. Pure: `now` is always passed in.
 */

import type { Tone } from "@/lib/admin/status";
import { EXCEPTION_LABEL, type ExceptionType } from "@/lib/tracking/assess";
import { CUSTOMER_STATUS_LABEL, isTrackingStatus, type TrackingStatus } from "@/lib/tracking/status";
import { istEndOfDay } from "@/lib/tracking/time";

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: "negative",
  HIGH: "negative",
  MEDIUM: "attention",
  LOW: "neutral",
};

/** Resolved → positive; otherwise by severity (CRITICAL/HIGH negative, MEDIUM attention, LOW neutral). */
export function exceptionTone(status: string, severity: string): Tone {
  return status === "RESOLVED" ? "positive" : (SEVERITY_TONE[severity] ?? "attention");
}

export function exceptionLabel(type: string): string {
  return EXCEPTION_LABEL[type as ExceptionType] ?? type;
}

const STATUS_TONE: Record<TrackingStatus, Tone> = {
  AWAITING_AWB: "neutral",
  AWAITING_PICKUP: "neutral",
  PICKED_UP: "info",
  IN_TRANSIT: "info",
  OUT_FOR_DELIVERY: "info",
  DELIVERY_ATTEMPTED: "attention",
  DELAYED: "attention",
  EXCEPTION: "negative",
  RTO_IN_TRANSIT: "negative",
  RTO_DELIVERED: "negative",
  DELIVERED: "positive",
  CANCELLED: "negative",
  UNKNOWN: "neutral",
};

/** Normalised tracking status → admin label + tone. AWAITING_AWB reads "Awaiting AWB" here (ops wording). */
export function trackingStatusMeta(status: string): { label: string; tone: Tone } {
  if (!isTrackingStatus(status)) return { label: status, tone: "neutral" };
  if (status === "AWAITING_AWB") return { label: "Awaiting AWB", tone: "neutral" };
  if (status === "UNKNOWN") return { label: "Unrecognised status", tone: "neutral" };
  return { label: CUSTOMER_STATUS_LABEL[status], tone: STATUS_TONE[status] };
}

/** Compact elapsed time: "45m", "18h", "4d" (hours up to 72h, like the exception details). */
export function formatSpan(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 72) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "18h ago" · "just now". */
export function ago(d: Date, now: Date): string {
  const ms = now.getTime() - d.getTime();
  return ms < 60_000 ? "just now" : `${formatSpan(ms)} ago`;
}

/** Last successful check = the later of the last parsed poll and the last courier webhook. */
export function lastCheckOf(syncAt: Date | null, webhookAt: Date | null): Date | null {
  if (!syncAt) return webhookAt;
  if (!webhookAt) return syncAt;
  return syncAt > webhookAt ? syncAt : webhookAt;
}

/** True once the estimate's IST calendar day has ended. */
export function estimatePassed(edd: Date, now: Date): boolean {
  return now.getTime() > istEndOfDay(edd).getTime();
}

/** Courier error text for display: no credentials, at most 160 characters. */
export function redactSyncError(msg: string | null): string | null {
  if (!msg) return null;
  const clean = msg
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\b(token|api[_-]?key|password|secret)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, "$1$2***");
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean;
}
