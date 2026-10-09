/**
 * Shiprocket payload → CarrierSnapshot.
 *
 * Both inputs — the courier webhook body and the GET /courier/track/* poll
 * response — are reduced to one shape so a scan seen first by the webhook and
 * later by the poll (or the other way round) produces the SAME fingerprint and
 * is stored once.
 *
 * Nothing here invents data: a scan without a parseable courier timestamp is
 * dropped, an absent EDD stays null, and "no activities yet" is an empty scan
 * list (a successful answer), not an error.
 */

import { createHash } from "node:crypto";
import { parseCarrierTime } from "./time";

export type CarrierScan = {
  /** Courier scan time. */
  at: Date;
  /** Courier's own status code (e.g. "X-PPOM"), when given. */
  code: string | null;
  /** Shiprocket's normalised label ("sr-status-label") or the courier status. */
  label: string | null;
  activity: string | null;
  location: string | null;
  raw: Record<string, unknown>;
};

export type CarrierSnapshot = {
  awb: string | null;
  courierName: string | null;
  shipmentId: string | null;
  /** Shiprocket's summary status for the shipment. */
  currentLabel: string | null;
  currentCode: string | null;
  /** Only when the courier stated a time for the current status (webhook). */
  currentAt: Date | null;
  /** Courier-provided expected delivery date. */
  edd: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  isReturn: boolean;
  trackUrl: string | null;
  /** Courier's reason for a failed delivery / pickup, when given. */
  reason: string | null;
  /** Courier's own count of delivery attempts, when given. */
  attemptCount: number | null;
  scans: CarrierScan[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && !/^(na|n\/a|null)$/i.test(t) ? t : null;
};

function parseScan(raw: unknown): CarrierScan | null {
  if (!isObj(raw)) return null;
  const at = parseCarrierTime(raw.date ?? raw.scan_date ?? raw.updated_time_stamp);
  if (!at) return null;
  const srLabel = str(raw["sr-status-label"]);
  return {
    at,
    code: str(raw.status) ?? str(raw["sr-status"]),
    label: srLabel ?? str(raw.status) ?? null,
    activity: str(raw.activity),
    location: str(raw.location),
    raw,
  };
}

function norm(v: string | null): string {
  return (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Stable identity of a courier scan. */
export function scanFingerprint(scan: Pick<CarrierScan, "at" | "code" | "activity" | "location" | "label">): string {
  const key = [
    scan.at.toISOString(),
    norm(scan.code),
    norm(scan.activity ?? scan.label),
    norm(scan.location),
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

function dedupeScans(scans: CarrierScan[]): CarrierScan[] {
  const seen = new Set<string>();
  const out: CarrierScan[] = [];
  for (const s of scans) {
    const fp = scanFingerprint(s);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(s);
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Parse a Shiprocket tracking response. Accepts the bare `{ tracking_data }`
 * shape and the `{ "<awb|shipment id>": { tracking_data } }` keyed shape.
 * Returns null when the body isn't a tracking response at all (caller treats
 * that as a failed sync, never as "no news").
 */
export function parseShiprocketTracking(body: unknown): CarrierSnapshot | null {
  if (!isObj(body)) return null;
  let td: unknown = body.tracking_data;
  if (!isObj(td)) {
    const inner = Object.values(body).find((v) => isObj(v) && isObj((v as Obj).tracking_data));
    td = inner ? (inner as Obj).tracking_data : undefined;
  }
  if (!isObj(td)) return null;

  const track = Array.isArray(td.shipment_track) && isObj(td.shipment_track[0]) ? (td.shipment_track[0] as Obj) : {};
  const activities = Array.isArray(td.shipment_track_activities) ? td.shipment_track_activities : [];
  const scans = dedupeScans(activities.map(parseScan).filter((s): s is CarrierScan => s !== null));

  return {
    awb: str(track.awb_code),
    courierName: str(track.courier_company_name) ?? str(track.courier_name),
    shipmentId: str(track.shipment_id),
    currentLabel: str(track.current_status),
    currentCode: str(td.shipment_status) ?? str(track.current_status_id),
    currentAt: null,
    edd: parseCarrierTime(track.edd) ?? parseCarrierTime(td.etd),
    pickedUpAt: parseCarrierTime(track.pickup_date),
    deliveredAt: parseCarrierTime(track.delivered_date),
    isReturn: false,
    trackUrl: str(td.track_url),
    reason: null,
    attemptCount: null,
    scans,
  };
}

export type ShiprocketWebhook = {
  awb?: string | number;
  courier_name?: string;
  current_status?: string;
  current_status_id?: number | string;
  shipment_status?: string;
  shipment_status_id?: number | string;
  current_timestamp?: string;
  order_id?: string | number;
  channel_order_id?: string;
  sr_order_id?: string | number;
  etd?: string;
  scans?: unknown[];
  is_return?: number | boolean;
  delivered_date?: string;
  undelivered_reason?: string;
  pickup_exception_reason?: string;
  delivery_attempt_count?: number | string;
};

/**
 * Shiprocket names a re-created ("cloned") order after ours with a suffix —
 * PRC-ABCD1234 becomes PRC-ABCD1234-C. Returns the base id to match on, or
 * null when there is no such suffix.
 */
export function baseOrderId(channelOrderId: string | null | undefined): string | null {
  const m = String(channelOrderId ?? "").trim().toUpperCase().match(/^(PRC-[A-Z0-9]{4,12})-[A-Z0-9]{1,3}$/);
  return m ? m[1] : null;
}

/** Parse a Shiprocket courier webhook body into the same snapshot shape. */
export function parseShiprocketWebhook(body: ShiprocketWebhook): CarrierSnapshot {
  const scans = dedupeScans(
    (Array.isArray(body.scans) ? body.scans : []).map(parseScan).filter((s): s is CarrierScan => s !== null),
  );
  return {
    awb: str(body.awb),
    courierName: str(body.courier_name),
    shipmentId: null,
    currentLabel: str(body.current_status) ?? str(body.shipment_status),
    currentCode: str(body.current_status_id) ?? str(body.shipment_status_id),
    currentAt: parseCarrierTime(body.current_timestamp),
    edd: parseCarrierTime(body.etd),
    pickedUpAt: null,
    deliveredAt: parseCarrierTime(body.delivered_date),
    isReturn: body.is_return === 1 || body.is_return === true,
    trackUrl: null,
    reason: str(body.undelivered_reason) ?? str(body.pickup_exception_reason),
    attemptCount: Number.isFinite(Number(body.delivery_attempt_count)) ? Number(body.delivery_attempt_count) : null,
    scans,
  };
}

/**
 * Events to store for a snapshot: every scan, plus the summary status as its
 * own event when the courier timed it (webhook current_timestamp) AND it is
 * newer than the last scan — so a webhook that carries only a status change
 * still moves the timeline, without duplicating a scan it already contains.
 */
export function snapshotEvents(snap: CarrierSnapshot): CarrierScan[] {
  const events = [...snap.scans];
  const last = events[events.length - 1];
  if (snap.currentAt && snap.currentLabel && (!last || snap.currentAt.getTime() - last.at.getTime() > 60_000)) {
    events.push({
      at: snap.currentAt,
      code: snap.currentCode,
      label: snap.currentLabel,
      activity: snap.currentLabel,
      location: null,
      raw: { source: "current_status", current_status: snap.currentLabel, current_timestamp: snap.currentAt.toISOString() },
    });
  }
  return events;
}
