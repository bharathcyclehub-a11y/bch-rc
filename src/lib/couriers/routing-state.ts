/**
 * orders.courier_routing — everything about HOW an order was (or will be)
 * booked, kept on the order row rather than in a parallel table:
 *
 *   decision  the routing engine's latest verdict at booking time, with every
 *             provider's serviceability and quote (src/lib/couriers/routing.ts)
 *   recheck   the latest staff "recheck" from the order page
 *   override  a staff choice of provider before booking (wins over routing)
 *   booking   the booking attempt's state. "attempting" is written BEFORE a
 *             Delhivery call: if its response is lost, the next run looks the
 *             order up on Delhivery before booking anything — a timeout never
 *             counts as "not booked"
 *   held      why the order waits for staff, and when ops were alerted (once)
 *   history   provider switches (e.g. a Shiprocket order cancelled by staff
 *             before its AWB, to book Delhivery instead)
 */

import type { RoutingRecord } from "./routing";
import type { CourierProvider } from "./types";

export type BookingState = {
  provider: CourierProvider;
  state: "attempting" | "booked" | "refused" | "not_found";
  at: string;
  /** Provider's id for the booking request (Delhivery upload_wbn). */
  requestId?: string | null;
  /** Provider's refusal reason (also kept for an ambiguous failure). */
  remark?: string | null;
  /** What chose this provider: "routing" | "override" | "existing". */
  via?: string;
};

export type CourierRoutingState = {
  decision?: RoutingRecord;
  recheck?: RoutingRecord;
  override?: { provider: CourierProvider; by: string; at: string };
  booking?: BookingState;
  held?: { reason: string; since: string; alertedAt: string | null };
  history?: Array<{ at: string; by: string; detail: string }>;
};

export function readRoutingState(v: unknown): CourierRoutingState {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as CourierRoutingState) : {};
}
