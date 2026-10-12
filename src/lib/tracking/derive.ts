/**
 * Which status a shipment is in — pure, shared by ingest, tests and dry runs.
 *
 * Two sources, and they are not equally reliable:
 *   - Shiprocket's SUMMARY status (`current_status` in the webhook and the
 *     tracking API) is Shiprocket's own normalised vocabulary. Replaying 715
 *     production webhooks (Oct 2026) mapped every summary value correctly.
 *   - Courier SCANS often carry only the courier's private codes ("PREPERD",
 *     "RTBM", "STOCKSCAN", "PCNO") when Shiprocket's per-scan label is "NA",
 *     and their activity text is inconsistent across couriers.
 *
 * So the summary decides the status whenever it is at least as recent as the
 * newest recognised scan. Each summary is kept with its own time (webhook
 * current_timestamp; for a poll, the moment Shiprocket answered) and a summary
 * older than the one already stored is ignored — a late webhook can't drag
 * the status back. Scans still drive the timeline, the last-movement time and
 * the attempt count, and decide the status only when they are newer than any
 * summary we have.
 */

import { TERMINAL_STATUSES, type TrackingStatus } from "./status";

/** A scan may land a little before Shiprocket updates its summary. */
const SUMMARY_TOLERANCE_MS = 2 * 60_000;

export type Timed = { status: TrackingStatus; at: Date };

export type DeriveInput = {
  previous: {
    status: TrackingStatus;
    statusChangedAt: Date | null;
    summary: Timed | null;
  };
  /** Newest scan whose status is recognised (not UNKNOWN). */
  latestKnownScan: Timed | null;
  /** This snapshot's summary, when recognised. */
  snapshotSummary: Timed | null;
  /** The shipment has an AWB (used only when nothing else is known). */
  hasAwb: boolean;
};

export type DeriveResult = {
  status: TrackingStatus;
  /** When the deciding source says this status began. */
  statusAt: Date | null;
  /** Summary to store (the newer of stored and snapshot). */
  summary: Timed | null;
  /** A final status moved on a genuinely newer courier fact. */
  correction: boolean;
};

export function deriveTrackingStatus(input: DeriveInput): DeriveResult {
  const { previous, latestKnownScan, snapshotSummary } = input;

  const stored = previous.summary;
  const summary =
    snapshotSummary && (!stored || snapshotSummary.at.getTime() >= stored.at.getTime()) ? snapshotSummary : stored;

  let status: TrackingStatus;
  let statusAt: Date | null;
  if (summary && (!latestKnownScan || summary.at.getTime() >= latestKnownScan.at.getTime() - SUMMARY_TOLERANCE_MS)) {
    status = summary.status;
    // The status began at the newest scan with the same status if we have one,
    // otherwise when the summary was reported.
    statusAt = latestKnownScan && latestKnownScan.status === summary.status ? latestKnownScan.at : summary.at;
  } else if (latestKnownScan) {
    status = latestKnownScan.status;
    statusAt = latestKnownScan.at;
  } else if (input.hasAwb && (previous.status === "AWAITING_AWB" || previous.status === "UNKNOWN")) {
    status = "AWAITING_PICKUP";
    statusAt = null;
  } else {
    status = previous.status;
    statusAt = previous.statusChangedAt;
  }

  // A final status only moves on a NEWER courier fact (correction).
  let correction = false;
  if (TERMINAL_STATUSES.has(previous.status) && status !== previous.status) {
    const newer = !!statusAt && !!previous.statusChangedAt && statusAt.getTime() > previous.statusChangedAt.getTime();
    if (newer) correction = true;
    else {
      status = previous.status;
      statusAt = previous.statusChangedAt;
    }
  }

  return { status, statusAt, summary, correction };
}
