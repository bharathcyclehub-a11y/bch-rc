/**
 * Tracking assessment — the pure rules behind what the customer is told and
 * which delivery exceptions are open. No DB, no clock: `now` is injected so the
 * date-sensitive rules are testable (scripts/tests/tracking.test.ts).
 *
 * Four facts are kept separate, because conflating them is what made /track
 * look current while showing a 2-day-old scan:
 *   1. last verified courier event + ITS timestamp   (lastCourierUpdateAt)
 *   2. last successful tracking check                 (lastCheckedAt)
 *   3. current expected delivery date + its source    (estimate)
 *   4. current delay / exception                      (delay, exceptions)
 *
 * Date rules:
 *   - A courier scan time is never changed and no event is ever synthesised.
 *   - An estimate is never moved forward on our own. Once its IST day has
 *     ended without delivery it becomes EXPIRED ("updated estimate pending")
 *     until the courier supplies a new one.
 *   - "Arriving today" only from a courier EDD that is today, or a courier
 *     out-for-delivery scan made today — never from an expired estimate or a
 *     PRC store estimate.
 */

import type { TrackingConfig } from "./config";
import {
  CUSTOMER_STATUS_LABEL,
  MOVING_STATUSES,
  TERMINAL_STATUSES,
  type ShipmentKind,
  type TrackingStatus,
} from "./status";
import { formatIstDateTime, hoursBetween, istDaysBetween, istEndOfDay, sameIstDay } from "./time";

export const EXCEPTION_TYPES = [
  "EDD_EXPIRED",
  "NO_MOVEMENT",
  "PICKUP_DELAYED",
  "DELIVERY_ATTEMPT_FAILED",
  "CARRIER_DELAY",
  "CARRIER_EXCEPTION",
  "RTO",
  "SYNC_FAILING",
  "MISSING_AWB",
  "SHIPMENT_CANCELLED",
  "ORDER_MISMATCH",
  "CUSTOMER_REPORTED",
  "CARRIER_CORRECTION",
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/** Types the assessment owns: opened AND auto-resolved by the worker. The
 *  others are raised by people or by one-off ingest checks and only a person
 *  resolves them. */
export const AUTO_EXCEPTION_TYPES: ReadonlySet<ExceptionType> = new Set([
  "EDD_EXPIRED",
  "NO_MOVEMENT",
  "PICKUP_DELAYED",
  "DELIVERY_ATTEMPT_FAILED",
  "CARRIER_DELAY",
  "CARRIER_EXCEPTION",
  "RTO",
  "SYNC_FAILING",
  "MISSING_AWB",
  "SHIPMENT_CANCELLED",
  "ORDER_MISMATCH",
]);

export const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  SHIPMENT_CANCELLED: "Shipment cancelled at courier",
  ORDER_MISMATCH: "Order closed but parcel moving",
  EDD_EXPIRED: "Estimate expired",
  NO_MOVEMENT: "No movement",
  PICKUP_DELAYED: "Pickup delayed",
  DELIVERY_ATTEMPT_FAILED: "Delivery attempt failed",
  CARRIER_DELAY: "Courier-reported delay",
  CARRIER_EXCEPTION: "Courier exception",
  RTO: "Return to origin",
  SYNC_FAILING: "Tracking sync failing",
  MISSING_AWB: "Missing AWB",
  CUSTOMER_REPORTED: "Customer reported",
  CARRIER_CORRECTION: "Courier correction",
};

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TrackingFacts = {
  kind: ShipmentKind;
  status: TrackingStatus;
  statusLabel: string | null;
  statusChangedAt: Date | null;
  awbCode: string | null;
  createdAt: Date;
  lastEventAt: Date | null;
  eddAt: Date | null;
  eddSource: string | null;
  deliveredAt: Date | null;
  terminalAt: Date | null;
  deliveryAttempts: number;
  lastSyncSuccessAt: Date | null;
  lastWebhookAt: Date | null;
  consecutiveFailures: number;
};

export type EstimateState =
  | "COURIER"
  | "STORE_ESTIMATE"
  | "EXPIRED"
  | "UNAVAILABLE"
  | "DELIVERED"
  | "NONE";

export type AssessedException = {
  type: ExceptionType;
  severity: Severity;
  detail: string;
  /** Crossed the escalation threshold → ops alert (once) + HIGH or above. */
  escalate: boolean;
  /** Safe and useful to show the customer. */
  customerVisible: boolean;
};

export type Assessment = {
  status: TrackingStatus;
  customerLabel: string;
  terminal: boolean;
  lastCourierUpdateAt: Date | null;
  lastCheckedAt: Date | null;
  sync: { healthy: boolean; failingSince: Date | null; consecutiveFailures: number };
  estimate: {
    state: EstimateState;
    /** The date currently promised, null when expired/unavailable. */
    date: Date | null;
    /** The estimate that passed without delivery (EXPIRED only). */
    expiredDate: Date | null;
    source: "COURIER" | "STORE_ESTIMATE" | null;
    arrivingToday: boolean;
  };
  hoursSinceMovement: number | null;
  /** Headline delay message for the customer, then any supporting lines. */
  delay: { type: ExceptionType; headline: string; details: string[] } | null;
  exceptions: AssessedException[];
};

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export const maxSeverity = (a: Severity, b: Severity): Severity =>
  SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;

function durationText(hours: number): string {
  if (hours >= 72) return `${Math.floor(hours / 24)} days`;
  return `${Math.floor(hours)} hours`;
}

export function assessTracking(
  f: TrackingFacts,
  opts: {
    now: Date;
    config: TrackingConfig;
    storeEstimate?: Date | null;
    /** The order's own status, for courier/order disagreement checks. */
    orderStatus?: string | null;
  },
): Assessment {
  const { now, config: c } = opts;
  const terminal = TERMINAL_STATUSES.has(f.status);
  const checks = [f.lastSyncSuccessAt, f.lastWebhookAt].filter((d): d is Date => !!d);
  const lastCheckedAt = checks.length ? new Date(Math.max(...checks.map((d) => d.getTime()))) : null;

  // --- 2. sync health -------------------------------------------------------
  let syncHealthy = true;
  if (!terminal) {
    const since = lastCheckedAt ?? f.createdAt;
    syncHealthy = hoursBetween(since, now) <= c.syncStaleHours;
  }
  const failingSince = syncHealthy ? null : (lastCheckedAt ?? f.createdAt);

  // --- 3. estimate ----------------------------------------------------------
  const estimate: Assessment["estimate"] = {
    state: "NONE",
    date: null,
    expiredDate: null,
    source: null,
    arrivingToday: false,
  };
  if (f.status === "DELIVERED") {
    estimate.state = "DELIVERED";
    estimate.date = f.deliveredAt;
  } else if (!terminal && f.status !== "RTO_IN_TRANSIT") {
    const courier = f.eddSource === "COURIER" && f.eddAt ? f.eddAt : null;
    const candidate = courier ?? opts.storeEstimate ?? null;
    const source = courier ? "COURIER" : candidate ? "STORE_ESTIMATE" : null;
    if (candidate && now.getTime() > istEndOfDay(candidate).getTime()) {
      estimate.state = "EXPIRED";
      estimate.expiredDate = candidate;
      estimate.source = source;
    } else if (candidate) {
      estimate.state = source!;
      estimate.date = candidate;
      estimate.source = source;
    } else {
      estimate.state = "UNAVAILABLE";
    }
    estimate.arrivingToday =
      (estimate.state === "COURIER" && !!estimate.date && sameIstDay(estimate.date, now)) ||
      (f.status === "OUT_FOR_DELIVERY" && !!f.lastEventAt && sameIstDay(f.lastEventAt, now));
  }

  // --- 4. exceptions --------------------------------------------------------
  const hoursSinceMovement = f.lastEventAt ? hoursBetween(f.lastEventAt, now) : null;
  const ex: AssessedException[] = [];
  const add = (e: AssessedException) => ex.push(e);

  if (f.status === "AWAITING_AWB" && !f.awbCode) {
    const h = hoursBetween(f.createdAt, now);
    if (h > c.missingAwbHours) {
      add({
        type: "MISSING_AWB",
        severity: h > c.missingAwbHours * 2 ? "HIGH" : "MEDIUM",
        detail: `Shipment created ${durationText(h)} ago and still has no AWB.`,
        escalate: h > c.missingAwbHours * 2,
        customerVisible: false,
      });
    }
  }

  if (f.status === "AWAITING_PICKUP") {
    const h = hoursBetween(f.statusChangedAt ?? f.createdAt, now);
    if (h > c.pickupDelayHours) {
      add({
        type: "PICKUP_DELAYED",
        severity: "MEDIUM",
        detail: `AWB assigned ${durationText(h)} ago and the courier has not picked it up.`,
        escalate: h > c.pickupDelayHours * 2,
        customerVisible: true,
      });
    }
  }

  if (MOVING_STATUSES.has(f.status) && hoursSinceMovement !== null && hoursSinceMovement > c.noMovementHours) {
    const escalate = hoursSinceMovement > c.noMovementEscalateHours;
    add({
      type: "NO_MOVEMENT",
      severity: escalate ? "HIGH" : "MEDIUM",
      detail: `No courier scan for ${durationText(hoursSinceMovement)} (last: ${formatIstDateTime(f.lastEventAt!)}).`,
      escalate,
      customerVisible: f.status !== "RTO_IN_TRANSIT",
    });
  }

  if (estimate.state === "EXPIRED" && estimate.expiredDate) {
    const daysLate = Math.max(1, istDaysBetween(estimate.expiredDate, now));
    const escalate = daysLate >= c.eddEscalateDays;
    add({
      type: "EDD_EXPIRED",
      severity: escalate ? "HIGH" : "MEDIUM",
      detail: `${estimate.source === "COURIER" ? "Courier" : "PRC"} estimate passed ${daysLate} day${daysLate === 1 ? "" : "s"} ago with no new estimate.`,
      escalate,
      customerVisible: true,
    });
  }

  if (f.status === "DELIVERY_ATTEMPTED") {
    const escalate = f.deliveryAttempts >= c.failedAttemptsEscalate;
    add({
      type: "DELIVERY_ATTEMPT_FAILED",
      severity: escalate ? "HIGH" : "MEDIUM",
      detail: `Delivery attempt failed${f.deliveryAttempts > 1 ? ` (${f.deliveryAttempts} attempts)` : ""}: ${f.statusLabel ?? "undelivered"}.`,
      escalate,
      customerVisible: true,
    });
  }

  if (f.status === "DELAYED") {
    add({
      type: "CARRIER_DELAY",
      severity: "MEDIUM",
      detail: `Courier reports: ${f.statusLabel ?? "delayed"}.`,
      escalate: false,
      customerVisible: true,
    });
  }

  if (f.status === "EXCEPTION") {
    const grave = /LOST|DAMAGE|DESTROY|UNTRACEABLE/i.test(f.statusLabel ?? "");
    add({
      type: "CARRIER_EXCEPTION",
      severity: grave ? "CRITICAL" : "HIGH",
      detail: `Courier reports: ${f.statusLabel ?? "exception"}.`,
      escalate: true,
      customerVisible: true,
    });
  }

  if (f.kind === "FORWARD" && (f.status === "RTO_IN_TRANSIT" || f.status === "RTO_DELIVERED")) {
    add({
      type: "RTO",
      severity: "HIGH",
      detail: f.status === "RTO_DELIVERED" ? "Returned to origin (back with us)." : "Return to origin initiated.",
      escalate: true,
      customerVisible: false,
    });
  }

  const orderStatus = opts.orderStatus ?? null;
  if (f.kind === "FORWARD" && f.status === "CANCELLED" && orderStatus && ["PAID", "PACKED"].includes(orderStatus)) {
    add({
      type: "SHIPMENT_CANCELLED",
      severity: "HIGH",
      detail: "The courier shipment was cancelled but the order is still open — re-ship it or cancel the order.",
      escalate: true,
      customerVisible: false,
    });
  }
  if (
    f.kind === "FORWARD" &&
    orderStatus &&
    ["CANCELLED", "REFUNDED", "FAILED", "ABANDONED"].includes(orderStatus) &&
    (MOVING_STATUSES.has(f.status) || f.status === "DELIVERED")
  ) {
    add({
      type: "ORDER_MISMATCH",
      severity: "HIGH",
      detail: `Order is ${orderStatus} in PRC but the courier shows the parcel ${CUSTOMER_STATUS_LABEL[f.status].toLowerCase()}.`,
      escalate: true,
      customerVisible: false,
    });
  }

  if (!syncHealthy) {
    const h = hoursBetween(failingSince!, now);
    add({
      type: "SYNC_FAILING",
      severity: h > c.syncStaleHours * 2 ? "HIGH" : "MEDIUM",
      detail: `No successful tracking update for ${durationText(h)}${f.consecutiveFailures ? ` (${f.consecutiveFailures} failed checks)` : ""}.`,
      // Never escalated per shipment: a courier outage would page ops once per
      // parcel. The worker raises ONE throttled store-wide alert instead.
      escalate: false,
      customerVisible: false,
    });
  }

  // --- customer delay message ----------------------------------------------
  const PRECEDENCE: ExceptionType[] = [
    "CARRIER_EXCEPTION",
    "EDD_EXPIRED",
    "DELIVERY_ATTEMPT_FAILED",
    "NO_MOVEMENT",
    "CARRIER_DELAY",
    "PICKUP_DELAYED",
  ];
  const message = (t: ExceptionType): string => {
    switch (t) {
      case "CARRIER_EXCEPTION":
        return "The courier has reported a problem with this parcel. Our team is looking into it.";
      case "EDD_EXPIRED":
        return "Delivery delayed — updated estimate pending.";
      case "DELIVERY_ATTEMPT_FAILED":
        return "The courier couldn't complete delivery on the last attempt.";
      case "NO_MOVEMENT":
        return `No new courier movement for over ${durationText(hoursSinceMovement ?? 0)}.`;
      case "CARRIER_DELAY":
        return "The courier has reported a delay on this parcel.";
      case "PICKUP_DELAYED":
        return "Waiting for the courier to collect your parcel from our warehouse.";
      default:
        return "";
    }
  };
  const visible = PRECEDENCE.filter((t) => ex.some((e) => e.type === t && e.customerVisible));
  const delay = visible.length
    ? { type: visible[0], headline: message(visible[0]), details: visible.slice(1).map(message) }
    : null;

  return {
    status: f.status,
    customerLabel:
      f.kind === "RETURN" && f.status === "DELIVERED" ? "Received by PRC" : CUSTOMER_STATUS_LABEL[f.status],
    terminal,
    lastCourierUpdateAt: f.lastEventAt,
    lastCheckedAt,
    sync: { healthy: syncHealthy, failingSince, consecutiveFailures: f.consecutiveFailures },
    estimate,
    hoursSinceMovement,
    delay,
    exceptions: ex,
  };
}

/**
 * Minutes until the next scheduled poll after a SUCCESSFUL sync, or null when
 * the shipment should stop being polled (final reconciliation done).
 */
export function nextSyncDelayMinutes(
  f: Pick<TrackingFacts, "status" | "terminalAt">,
  a: Pick<Assessment, "exceptions" | "terminal">,
  c: TrackingConfig,
  now: Date,
): number | null {
  if (a.terminal) {
    if (!f.terminalAt) return c.finalReconcileHours * 60;
    const remainingMin = (f.terminalAt.getTime() + c.finalReconcileHours * 3_600_000 - now.getTime()) / 60_000;
    return remainingMin <= 0 ? null : Math.ceil(remainingMin);
  }
  const attention =
    f.status === "OUT_FOR_DELIVERY" ||
    f.status === "DELIVERY_ATTEMPTED" ||
    f.status === "DELAYED" ||
    f.status === "EXCEPTION" ||
    a.exceptions.some((e) => e.type !== "SYNC_FAILING" && e.type !== "RTO");
  if (attention) return c.attentionIntervalMin;
  if (f.status === "RTO_IN_TRANSIT") return c.rtoIntervalMin;
  if (f.status === "AWAITING_AWB" || f.status === "AWAITING_PICKUP") return c.awaitingIntervalMin;
  return c.movingIntervalMin;
}

/** Exponential backoff for a failed sync: base·2^(n-1), capped, ±20% jitter. */
export function failureBackoffMinutes(failures: number, c: TrackingConfig, rng: () => number = Math.random): number {
  const raw = Math.min(c.failureMaxMin, c.failureBaseMin * 2 ** Math.max(0, failures - 1));
  return Math.max(1, Math.round(raw * (0.8 + rng() * 0.4)));
}

/** ±10% jitter so shipments created together don't poll in lockstep. */
export function withJitter(minutes: number, rng: () => number = Math.random): number {
  return Math.max(1, Math.round(minutes * (0.9 + rng() * 0.2)));
}
