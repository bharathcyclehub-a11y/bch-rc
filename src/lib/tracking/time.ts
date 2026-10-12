/**
 * Courier timestamps and India-local formatting for tracking.
 *
 * Shiprocket (and the couriers behind it) send IST wall-clock times WITHOUT an
 * offset: "2026-10-07 20:30:00" in tracking responses and webhook scans, and
 * "07 10 2026 20:30:00" in the webhook's current_timestamp. Parsing those with
 * `new Date()` would read them as the server's local time (UTC on the VPS),
 * shifting every scan 5h30m. So every courier time goes through
 * parseCarrierTime(), which pins offset-less values to IST and stores UTC.
 *
 * India has no DST, so a fixed +05:30 offset is exact year-round.
 */

import { IST_OFFSET_MS, istYmd } from "@/lib/tz";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Build the UTC instant for an IST wall-clock time; null on rollover dates. */
function istInstant(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  if (y < 2015 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MS;
  const out = new Date(utcMs);
  // Reject 31 Sep etc.: the IST calendar day must round-trip.
  const back = new Date(utcMs + IST_OFFSET_MS);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null;
  return out;
}

/**
 * Parse a courier timestamp. Offset-less values are IST; values carrying "Z" or
 * an explicit offset are honoured as given. Returns null for blanks, "NA",
 * zero dates and anything unrecognisable — callers must treat null as
 * "the courier did not tell us", never substitute the current time.
 */
export function parseCarrierTime(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || /^(na|n\/a|null|none|-)$/i.test(s) || s.startsWith("0000")) return null;

  // 2026-10-07 20:30[:00][.123][Z|+05:30]
  let m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (m) {
    if (m[7]) {
      const t = Date.parse(s.replace(" ", "T"));
      return Number.isFinite(t) ? new Date(t) : null;
    }
    return istInstant(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }

  // 07 10 2026 20:30:00  /  07-10-2026 20:30  /  07/10/2026
  m = s.match(/^(\d{1,2})[ \-/](\d{1,2})[ \-/](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return istInstant(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));

  // 07 Oct 2026[, 08:30 PM]
  m = s.match(
    /^(\d{1,2})[ \-]([A-Za-z]{3})[A-Za-z]*[ \-,]+(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i,
  );
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    let h = +(m[4] ?? 0);
    const ampm = m[7]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    return istInstant(+m[3], mo, +m[1], h, +(m[5] ?? 0), +(m[6] ?? 0));
  }

  return null;
}

/** The last instant of the IST calendar day `d` falls on. */
export function istEndOfDay(d: Date): Date {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(23, 59, 59, 999);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** True when both instants fall on the same IST calendar day. */
export function sameIstDay(a: Date, b: Date): boolean {
  return istYmd(a) === istYmd(b);
}

/** Whole IST calendar days from `a` to `b` (b later → positive). */
export function istDaysBetween(a: Date, b: Date): number {
  const ka = Date.parse(`${istYmd(a)}T00:00:00Z`);
  const kb = Date.parse(`${istYmd(b)}T00:00:00Z`);
  return Math.round((kb - ka) / 86_400_000);
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

/** "7 Oct, 8:30 pm" in IST. */
export function formatIstDateTime(d: Date): string {
  return d
    .toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s?(am|pm)$/i, (x) => x.toLowerCase());
}

/** "Wed, 8 Oct" in IST. */
export function formatIstDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
