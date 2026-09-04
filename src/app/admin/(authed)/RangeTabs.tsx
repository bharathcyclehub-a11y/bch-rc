"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const LABELS: Record<number, string> = {
  1: "Today",
  7: "7 days",
  14: "14 days",
  30: "30 days",
  90: "90 days",
};

/**
 * The one time-window control for the whole admin.
 *
 * Path-aware on purpose: it pushes back to `usePathname()` rather than a
 * hardcoded /admin, so the same component drives Overview, Finance and
 * Returns without a per-page copy (the previous version was hardwired to the
 * dashboard, which is why three other pages had no filter at all).
 *
 * Preset pills write `?range=N`. "Custom" reveals two date inputs and writes
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD`; the server parses both shapes through
 * resolveAdminRange() in src/lib/admin-range.ts, so the pill state and the
 * numbers below it can never disagree.
 *
 * Every other query param (tab, q, view…) is preserved across a switch, and
 * `page` is dropped so changing the window never strands you on page 7 of a
 * shorter list.
 */
export function RangeTabs({
  presets = [1, 7, 14, 30],
  defaultRange = 1,
  custom = false,
}: {
  presets?: readonly number[];
  /** Window used when no param is present. Selecting it clears ?range=. */
  defaultRange?: number;
  /** Show the Custom from/to option. Only enable on pages whose queries
   *  actually honour an upper bound. */
  custom?: boolean;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const fromParam = sp.get("from") ?? "";
  const toParam = sp.get("to") ?? "";
  const isCustom = Boolean(fromParam && toParam);
  const current = Number(sp.get("range")) || defaultRange;

  const [open, setOpen] = useState(isCustom);
  const [from, setFrom] = useState(fromParam);
  const [to, setTo] = useState(toParam);

  function push(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    // A window change always resets pagination — page 7 of "today" is nothing.
    params.delete("page");
    mutate(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function goPreset(days: number) {
    setOpen(false);
    push((p) => {
      p.delete("from");
      p.delete("to");
      if (days === defaultRange) p.delete("range");
      else p.set("range", String(days));
    });
  }

  function applyCustom() {
    if (!from || !to) return;
    // Guard the inverted case in the UI too, so the user sees the swap rather
    // than a silent fallback to the preset window on the server.
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    setFrom(lo);
    setTo(hi);
    push((p) => {
      p.delete("range");
      p.set("from", lo);
      p.set("to", hi);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2 shrink-0">
      <div className="flex gap-1 bg-brand-cream rounded-full p-1 shrink-0">
        {presets.map((d) => {
          const active = !isCustom && current === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => goPreset(d)}
              aria-pressed={active}
              className={`px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-ink text-white"
                  : "text-brand-ink-soft hover:text-brand-ink"
              }`}
            >
              {LABELS[d] ?? `${d} days`}
            </button>
          );
        })}
        {custom && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-pressed={isCustom}
            aria-expanded={open}
            className={`px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-full text-sm font-medium transition-colors ${
              isCustom
                ? "bg-brand-ink text-white"
                : "text-brand-ink-soft hover:text-brand-ink"
            }`}
          >
            Custom
          </button>
        )}
      </div>

      {custom && open && (
        <div className="flex flex-wrap items-center justify-end gap-2 bg-white border border-brand-line rounded-2xl p-2">
          <label className="flex items-center gap-1.5 text-xs text-brand-ink-soft">
            <span className="font-mono uppercase tracking-widest">From</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-brand-line px-2 py-1.5 text-sm text-brand-ink focus:outline-none focus:border-brand-ink"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-brand-ink-soft">
            <span className="font-mono uppercase tracking-widest">To</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-brand-line px-2 py-1.5 text-sm text-brand-ink focus:outline-none focus:border-brand-ink"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to}
            className="bg-brand-ink text-white text-xs font-semibold uppercase tracking-widest px-3 py-2 rounded-xl disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
