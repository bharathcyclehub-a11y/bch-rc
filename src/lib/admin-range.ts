/**
 * ONE time-window vocabulary for every admin page.
 *
 * Before this, four surfaces each invented their own window and disagreed:
 *   - Overview      ?range= with presets [1,7,14,30], default 1
 *   - Analytics     ?range= with presets [1,7,30,90], default 30
 *   - Finance       hardcoded `addUtcDays(istDayStart(), -29)`, no param at all
 *   - Returns / RTO no window whatsoever — all-time, silently
 * so "last 30 days" on Finance and "30 days" on Analytics were different spans,
 * and two pages could not be filtered at all.
 *
 * This module is the single parser. It understands the presets AND an explicit
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` custom span, always on IST calendar days
 * (India has no DST, so a fixed +5:30 offset is exact), and always returns a
 * half-open interval [from, to) so day boundaries can never double-count.
 *
 * Pure and dependency-free apart from the tz helpers, so pages, the shared
 * <RangeTabs> control and any future export route all agree by construction.
 */

import { addUtcDays, istDayStart, istShortDate, istYmd, IST_OFFSET_MS } from "@/lib/tz";

/** Preset windows offered by the shared control, in days INCLUSIVE of today. */
export const RANGE_PRESETS = [1, 7, 14, 30, 90] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Hard ceiling on a custom span. Guards against a hand-typed ?from=1970-01-01
 *  turning an indexed range scan into a full table scan. */
const MAX_CUSTOM_DAYS = 366;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AdminRange = {
  mode: "preset" | "custom";
  /** Day count for a preset; for a custom span, the inclusive number of days. */
  days: number;
  /** Inclusive lower bound — the UTC instant of an IST midnight. */
  from: Date;
  /**
   * EXCLUSIVE upper bound. `null` for presets, which always run up to "now" and
   * so need no upper filter. Custom spans always set it to the IST midnight
   * AFTER the chosen end date, so the end day is fully included.
   */
  to: Date | null;
  /** Human label for page subtitles: "today", "last 30 days", "08 Jul – 05 Sep". */
  label: string;
  /** Querystring fragment that reproduces this range ("" when it's the default). */
  query: string;
};

/** The UTC instant of IST midnight on a `YYYY-MM-DD` IST calendar date. */
function istDayStartFromYmd(ymd: string): Date | null {
  if (!YMD_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  // Round-trip through istYmd to reject impossible dates (2026-02-31 etc.),
  // which Date.UTC would silently roll forward into March.
  const instant = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
  if (Number.isNaN(instant.getTime()) || istYmd(instant) !== ymd) return null;
  return instant;
}

function presetRange(days: number, defaultDays: number): AdminRange {
  const from = addUtcDays(istDayStart(), -(days - 1));
  return {
    mode: "preset",
    days,
    from,
    to: null,
    label: days === 1 ? "today" : `last ${days} days`,
    query: days === defaultDays ? "" : `range=${days}`,
  };
}

/**
 * Resolve the window for a page from its searchParams.
 *
 * Custom wins when both `from` and `to` parse; anything malformed, inverted or
 * longer than MAX_CUSTOM_DAYS falls back to the preset (and ultimately to
 * `defaultDays`) rather than erroring — a bad URL should never 500 the admin.
 */
export function resolveAdminRange(
  sp: { range?: string; from?: string; to?: string },
  opts: { defaultDays?: number; presets?: readonly number[] } = {},
): AdminRange {
  const defaultDays = opts.defaultDays ?? 30;
  const presets = opts.presets ?? RANGE_PRESETS;

  const fromYmd = (sp.from ?? "").trim();
  const toYmd = (sp.to ?? "").trim();

  if (fromYmd && toYmd) {
    const from = istDayStartFromYmd(fromYmd);
    const endDay = istDayStartFromYmd(toYmd);
    if (from && endDay && endDay.getTime() >= from.getTime()) {
      // Half-open: push the upper bound to the NEXT IST midnight so the whole
      // end day counts. Without this, "05 Sep – 05 Sep" would match nothing.
      const to = addUtcDays(endDay, 1);
      const days = Math.round(
        (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (days >= 1 && days <= MAX_CUSTOM_DAYS) {
        return {
          mode: "custom",
          days,
          from,
          to,
          label: `${istShortDate(from)} – ${istShortDate(endDay)}`,
          query: `from=${fromYmd}&to=${toYmd}`,
        };
      }
    }
    // Fall through to presets on any invalid custom input.
  }

  const raw = Number(sp.range);
  const days = presets.includes(raw) ? raw : defaultDays;
  return presetRange(days, defaultDays);
}

/** `YYYY-MM-DD` for an <input type="date"> default, in IST. */
export function rangeInputValue(d: Date): string {
  return istYmd(d);
}
