/** Pure analytics dates. Every query uses the same half-open IST interval. */
import { addUtcDays, istDayStart, istDayStartFromYmd, istYmd, IST_OFFSET_MS } from "./tz";

export const MAX_WINDOW_DAYS = 3660;
const DAY_MS = 24 * 60 * 60 * 1000;
export type AnalyticsGranularity = "day" | "month" | "year";

export type MetricWindow = {
  days: number;
  /** Inclusive IST midnight. */
  start: Date;
  /** Exclusive IST midnight AFTER the selected final day. */
  end: Date;
  /** Start of the immediately preceding window of the same number of days. */
  prevStart: Date;
};

export type AnalyticsRange = MetricWindow & {
  mode: "preset" | "custom" | "month" | "year";
  fromYmd: string;
  toYmd: string;
  label: string;
  previousLabel: string;
  granularity: AnalyticsGranularity;
  query: string;
  /** Invalid URLs use a clearly reported fallback; never silently clip dates. */
  error?: string;
};

export type AnalyticsSearchParams = Record<string, string | string[] | undefined>;

export function analyticsWindow(days: number, now = new Date()): MetricWindow {
  if (!Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) {
    throw new RangeError(`Choose between 1 and ${MAX_WINDOW_DAYS} days (up to 10 years).`);
  }
  const end = addUtcDays(istDayStart(now), 1);
  const start = addUtcDays(end, -days);
  return { days, start, end, prevStart: addUtcDays(start, -days) };
}

function humanDate(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

function periodLabel(start: Date, end: Date): string {
  const lastDay = addUtcDays(end, -1);
  return istYmd(start) === istYmd(lastDay) ? humanDate(start) : `${humanDate(start)} – ${humanDate(lastDay)}`;
}

function defaultGranularity(days: number): AnalyticsGranularity {
  return days > 2 * 366 ? "year" : days > 90 ? "month" : "day";
}

/**
 * range=N includes today. from/to are inclusive dates; month=YYYY-MM and
 * year=YYYY are full calendar periods. An explicit granularity controls chart
 * buckets independently of the filter. Invalid requests carry an error.
 */
export function parseAnalyticsRange(
  sp: AnalyticsSearchParams,
  opts: { defaultDays?: number; now?: Date } = {},
): AnalyticsRange {
  const defaultDays = opts.defaultDays ?? 30;
  const fallback = analyticsWindow(defaultDays, opts.now);
  const first = (key: string) => {
    const value = sp[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const from = first("from"), to = first("to"), month = first("month"), year = first("year");
  const range = first("range"), group = first("granularity");
  let window = fallback;
  let mode: AnalyticsRange["mode"] = "preset";
  let error: string | undefined;
  let query = defaultDays === 30 ? "" : `range=${defaultDays}`;

  const setDates = (start: Date | null, end: Date | null) => {
    if (!start || !end) { error = "Choose valid calendar dates."; return false; }
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (days < 1) { error = "The end date must be on or after the start date."; return false; }
    if (days > MAX_WINDOW_DAYS) { error = `Choose a period of up to 10 years (${MAX_WINDOW_DAYS} days).`; return false; }
    window = { days, start, end, prevStart: addUtcDays(start, -days) };
    return true;
  };

  if ([Boolean(from || to), Boolean(month), Boolean(year)].filter(Boolean).length > 1) {
    error = "Choose one date filter: custom dates, a month, or a year.";
  } else if (from || to) {
    if (!from || !to) error = "Choose both a start date and an end date.";
    else {
      const endDay = istDayStartFromYmd(to);
      if (setDates(istDayStartFromYmd(from), endDay ? addUtcDays(endDay, 1) : null)) {
        mode = "custom";
        query = `from=${from}&to=${to}`;
      }
    }
  } else if (month) {
    const start = /^\d{4}-\d{2}$/.test(month) ? istDayStartFromYmd(`${month}-01`) : null;
    const next = start ? new Date(start.getTime() + IST_OFFSET_MS) : null;
    next?.setUTCMonth(next.getUTCMonth() + 1);
    if (setDates(start, next ? new Date(next.getTime() - IST_OFFSET_MS) : null)) {
      mode = "month";
      query = `month=${month}`;
    }
  } else if (year) {
    const start = /^\d{4}$/.test(year) ? istDayStartFromYmd(`${year}-01-01`) : null;
    const next = start ? new Date(start.getTime() + IST_OFFSET_MS) : null;
    next?.setUTCFullYear(next.getUTCFullYear() + 1);
    if (setDates(start, next ? new Date(next.getTime() - IST_OFFSET_MS) : null)) {
      mode = "year";
      query = `year=${year}`;
    }
  } else if (range) {
    const days = /^\d+$/.test(range) ? Number(range) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) {
      error = `Choose between 1 and ${MAX_WINDOW_DAYS} days (up to 10 years).`;
    } else {
      window = analyticsWindow(days, opts.now);
      query = days === defaultDays ? "" : `range=${days}`;
    }
  }

  let granularity = mode === "year" ? "month" as const : defaultGranularity(window.days);
  if (group) {
    if (group === "day" || group === "month" || group === "year") granularity = group;
    else error = [error, "Group by day, month, or year."].filter(Boolean).join(" ");
  }
  const params = new URLSearchParams(query);
  params.set("granularity", granularity);
  return {
    ...window, mode, granularity, query: params.toString(),
    fromYmd: istYmd(window.start), toYmd: istYmd(addUtcDays(window.end, -1)),
    label: periodLabel(window.start, window.end),
    previousLabel: periodLabel(window.prevStart, window.start),
    ...(error ? { error: `${error} Showing the ${periodLabel(window.start, window.end)} period.` } : {}),
  };
}

export type AnalyticsBucket = { key: string; label: string; start: Date; end: Date };

/** Calendar buckets, with partial first/last buckets clipped to the selection. */
export function analyticsBuckets(window: MetricWindow, granularity: AnalyticsGranularity): AnalyticsBucket[] {
  const calendar = new Date(window.start.getTime() + IST_OFFSET_MS);
  if (granularity !== "day") calendar.setUTCDate(1);
  if (granularity === "year") calendar.setUTCMonth(0);
  const out: AnalyticsBucket[] = [];
  while (calendar.getTime() - IST_OFFSET_MS < window.end.getTime()) {
    const bucketStart = new Date(calendar.getTime() - IST_OFFSET_MS);
    const key = istYmd(bucketStart);
    const label = bucketStart.toLocaleDateString("en-IN", {
      ...(granularity === "day" ? { day: "numeric" as const } : {}),
      ...(granularity !== "year" ? { month: "short" as const } : {}),
      year: "numeric", timeZone: "Asia/Kolkata",
    });
    if (granularity === "day") calendar.setUTCDate(calendar.getUTCDate() + 1);
    else if (granularity === "month") calendar.setUTCMonth(calendar.getUTCMonth() + 1);
    else calendar.setUTCFullYear(calendar.getUTCFullYear() + 1);
    out.push({
      key, label,
      start: new Date(Math.max(bucketStart.getTime(), window.start.getTime())),
      end: new Date(Math.min(calendar.getTime() - IST_OFFSET_MS, window.end.getTime())),
    });
  }
  return out;
}

export type SalesTimePoint = { key: string; label: string; revenue: number; orders: number; customers: number };

/** Shared zero-fill, also exercised without requiring a database connection. */
export function fillSalesTimeSeries(
  window: MetricWindow,
  granularity: AnalyticsGranularity,
  sales: Array<{ key: string; revenue: number; orders: number }>,
  customers: Array<{ key: string; customers: number }>,
): SalesTimePoint[] {
  const salesByKey = new Map(sales.map((row) => [row.key, row]));
  const customersByKey = new Map(customers.map((row) => [row.key, row.customers]));
  return analyticsBuckets(window, granularity).map(({ key, label }) => ({
    key, label, revenue: salesByKey.get(key)?.revenue ?? 0,
    orders: salesByKey.get(key)?.orders ?? 0, customers: customersByKey.get(key) ?? 0,
  }));
}
