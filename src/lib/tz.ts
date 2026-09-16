/**
 * IST (Asia/Kolkata) day-boundary helpers — the single source of truth for
 * "which calendar day did this happen on" across the whole admin.
 *
 * WHY THIS EXISTS: the server runs UTC on Vercel. `date.setHours(0,0,0,0)` and
 * a bare `date_trunc('day', ts)` therefore bucket by UTC midnight = 5:30 AM IST,
 * so an order placed 00:00–05:30 IST lands on the PREVIOUS day and the analytics
 * numbers disagree with the IST dates shown on the orders list. The dashboard
 * was fixed for this in 86b2be5; this module lifts that exact logic out so the
 * analytics page (and anything else) can't drift from it again.
 *
 * India observes no DST, so a fixed +5:30 offset is exact year-round.
 *
 * Pairs with the SQL side: bucket timestamps with
 *   date_trunc('day', <col> AT TIME ZONE 'Asia/Kolkata')
 * and format day labels with
 *   to_char(date_trunc('day', <col> AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')
 * so the JS keys produced by istYmd() line up with the DB's grouping keys.
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The UTC instant corresponding to IST midnight of the IST day that `now`
 * falls in. Use as the ">= today" boundary for "today" windows.
 */
export function istDayStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

/**
 * Add `n` whole days (n may be negative) to an IST-midnight instant. Because IST
 * is a fixed offset, adding 24h in UTC always lands on the next IST midnight, so
 * setUTCDate keeps the arithmetic tied to the boundary regardless of host TZ.
 */
export function addUtcDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * IST calendar date of an instant as `YYYY-MM-DD`. Matches the SQL buckets,
 * which are date_trunc'd in Asia/Kolkata — so these keys line up with DB rows.
 */
export function istYmd(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

/** Parse an actual IST calendar date, rejecting rollover dates such as Feb 31. */
export function istDayStartFromYmd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  const instant = new Date(calendar.getTime() - IST_OFFSET_MS);
  return Number.isFinite(instant.getTime()) && istYmd(instant) === ymd ? instant : null;
}

/** Short human day label ("08 Jul"), always rendered in IST. */
export function istShortDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/** IST weekday with Monday=0 … Sunday=6 (for Monday-anchored week buckets). */
export function istWeekdayMon0(d: Date): number {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return (ist.getUTCDay() + 6) % 7;
}
