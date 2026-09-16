"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseAnalyticsRange } from "@/lib/analytics-range";

const LABELS: Record<number, string> = {
  1: "Today", 7: "7 days", 14: "14 days", 30: "30 days", 90: "90 days", 365: "365 days",
};
const DATE_KEYS = ["range", "from", "to", "month", "year", "window"];
const INPUT = "min-h-11 min-w-0 rounded-xl border border-brand-line bg-white px-2 py-1.5 text-sm text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink";

/** Shared date control. Calendar/granularity are opt-in for fully bounded reports. */
export function RangeTabs({
  presets = [1, 7, 14, 30],
  defaultRange = 1,
  custom = false,
  calendar = false,
  granularity = false,
}: {
  presets?: readonly number[];
  defaultRange?: number;
  custom?: boolean;
  /** Enable month/year selection on pages using parseAnalyticsRange. */
  calendar?: boolean;
  /** Enable day/month/year chart buckets; the date filter stays unchanged. */
  granularity?: boolean;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const activeMode = sp.has("month") ? "month" : sp.has("year") ? "year" : sp.has("from") || sp.has("to") ? "custom" : null;
  // Draft fields are local; URL-backed values are read afresh on browser navigation.
  const [panel, setPanel] = useState<"custom" | "month" | "year" | null | undefined>(undefined);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const open = panel === undefined ? activeMode : panel;
  const current = Number(sp.get("range")) || defaultRange;
  const resolved = parseAnalyticsRange(Object.fromEntries(sp.entries()), { defaultDays: defaultRange });
  const value = (key: string) => draft[key] ?? sp.get(key) ?? "";
  const change = (key: string, val: string) => { setDraft((d) => ({ ...d, [key]: val })); setError(""); };

  function push(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    params.delete("page");
    mutate(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function goPreset(days: number) {
    setPanel(null);
    setDraft({});
    setError("");
    push((p) => {
      DATE_KEYS.forEach((key) => p.delete(key));
      if (days !== defaultRange) p.set("range", String(days));
    });
  }

  function apply(mode: "custom" | "month" | "year") {
    const fields = mode === "custom" ? { from: value("from"), to: value("to") } : { [mode]: value(mode) };
    const parsed = parseAnalyticsRange(fields, { defaultDays: defaultRange });
    if (parsed.error) { setError(parsed.error.split(" Showing the ")[0]); return; }
    // Finance/returns still use the legacy one-year parser until migrated.
    if (!calendar && parsed.days > 366) { setError("Choose a period of up to 366 days on this page."); return; }
    setError("");
    push((p) => {
      DATE_KEYS.forEach((key) => p.delete(key));
      Object.entries(fields).forEach(([key, val]) => p.set(key, val));
    });
  }

  const tabClass = (active: boolean) => `min-h-11 rounded-full px-2.5 sm:px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink ${active ? "bg-brand-ink text-white" : "text-brand-ink-soft hover:text-brand-ink"}`;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap gap-1 rounded-2xl bg-brand-cream p-1 sm:justify-end">
        {presets.map((days) => (
          <button key={days} type="button" onClick={() => goPreset(days)} aria-pressed={!activeMode && current === days} className={tabClass(!activeMode && current === days)}>
            {LABELS[days] ?? `${days} days`}
          </button>
        ))}
        {([...(custom ? ["custom"] : []), ...(calendar ? ["month", "year"] : [])] as Array<"custom" | "month" | "year">).map((mode) => (
          <button key={mode} type="button" onClick={() => { setPanel(open === mode ? null : mode); setError(""); }} aria-pressed={activeMode === mode} aria-expanded={open === mode} className={tabClass(activeMode === mode)}>
            {mode === "custom" ? "Custom / day" : mode === "month" ? "Month" : "Year"}
          </button>
        ))}
      </div>

      {open && ((open === "custom" && custom) || (open !== "custom" && calendar)) && (
        <form onSubmit={(event) => { event.preventDefault(); apply(open); }} className="w-full rounded-2xl border border-brand-line bg-white p-3">
          <div className="flex flex-wrap items-end gap-2 sm:justify-end">
            {open === "custom" ? (
              <>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-brand-ink-soft">
                  From (IST)
                  <input type="date" required value={value("from")} onChange={(e) => change("from", e.target.value)} className={INPUT} />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-brand-ink-soft">
                  Through (IST)
                  <input type="date" required value={value("to")} min={value("from") || undefined} onChange={(e) => change("to", e.target.value)} className={INPUT} />
                </label>
              </>
            ) : (
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-brand-ink-soft">
                {open === "month" ? "Calendar month (IST)" : "Calendar year (IST)"}
                <input type={open === "month" ? "month" : "number"} required {...(open === "year" ? { min: 1900, max: 9999, step: 1, placeholder: "2026" } : {})} value={value(open)} onChange={(e) => change(open, e.target.value)} className={INPUT} />
              </label>
            )}
            <button type="submit" className="min-h-11 rounded-xl bg-brand-ink px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink">Apply</button>
          </div>
          {open === "custom" && <p className="mt-2 text-xs text-brand-ink-soft">Use the same date for a single day. {calendar ? "Up to 10 years per report." : "Up to 366 days per report."}</p>}
          {error && <p role="alert" className="mt-2 text-sm text-brand-red">{error}</p>}
        </form>
      )}

      {granularity && (
        <label className="flex items-center gap-2 text-xs text-brand-ink-soft">
          Group chart by
          <select value={resolved.granularity} onChange={(event) => push((params) => params.set("granularity", event.target.value))} className={INPUT}>
            <option value="day">Day</option><option value="month">Month</option><option value="year">Year</option>
          </select>
        </label>
      )}
    </div>
  );
}
