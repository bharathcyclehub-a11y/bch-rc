"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { FilterChip } from "./Chip";

export type FilterOption = { value: string; label: string };
export type FilterDef = {
  key: string;
  label: string;
  options: FilterOption[];
  /** The option value that means "no filter" (default ""). Never written to the URL. */
  anyValue?: string;
};

const anyOf = (f: FilterDef) => f.anyValue ?? "";

/** Desktop inline select with a muted label prefix — "Payment: All". */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (next: string) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "relative inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-admin-line-strong bg-white pl-3 text-[13px] transition-colors hover:bg-admin-subtle focus-within:ring-2 focus-within:ring-brand-red/20",
        className,
      )}
    >
      <span className="whitespace-nowrap text-admin-muted">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none bg-transparent pl-1 pr-8 font-medium text-brand-ink focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 text-admin-muted" />
    </label>
  );
}

/** Phone filter sheet: each filter as a group of radio chips; Apply / Clear all. */
export function FilterSheet({
  open,
  onClose,
  filters,
  values,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: FilterDef[];
  values: Record<string, string>;
  onApply: (next: Record<string, string>) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Filters" variant="sheet">
      <FilterSheetBody filters={filters} values={values} onApply={onApply} />
    </Dialog>
  );
}

// Mounted per open, so the draft starts from the applied values each time.
function FilterSheetBody({
  filters,
  values,
  onApply,
}: {
  filters: FilterDef[];
  values: Record<string, string>;
  onApply: (next: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState(values);
  return (
    <div className="space-y-5">
      {filters.map((f) => (
        <fieldset key={f.key}>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{f.label}</legend>
          <div className="flex flex-wrap gap-2">
            {f.options.map((o) => {
              const selected = (draft[f.key] ?? anyOf(f)) === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDraft((d) => ({ ...d, [f.key]: o.value }))}
                  className={cn(
                    "inline-flex h-10 items-center rounded-full border px-4 text-[13px] font-medium transition-colors",
                    selected ? "border-brand-ink bg-brand-ink text-white" : "border-admin-line bg-white text-brand-ink-soft",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t border-admin-line bg-white px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" className="flex-1" onClick={() => onApply(Object.fromEntries(filters.map((f) => [f.key, anyOf(f)])))}>
          Clear all
        </Button>
        <Button variant="primary" className="flex-[2]" onClick={() => onApply(draft)}>
          Show results
        </Button>
      </div>
    </div>
  );
}

/**
 * URL-driven filters for server-rendered lists. Desktop: inline selects.
 * Phones: a "Filters" button (with active count) opening a bottom sheet, plus
 * removable chips for what's applied. Changing a filter resets pagination.
 */
export function UrlFilters({ filters, className }: { filters: FilterDef[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Values not among a filter's options (hand-edited URLs) read as "no filter".
  const values: Record<string, string> = Object.fromEntries(
    filters.map((f) => {
      const v = sp.get(f.key);
      return [f.key, v !== null && f.options.some((o) => o.value === v) ? v : anyOf(f)];
    }),
  );
  const active = filters.filter((f) => values[f.key] !== anyOf(f));

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const f of filters) {
      const v = next[f.key];
      if (!v || v === anyOf(f)) params.delete(f.key);
      else params.set(f.key, v);
    }
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", pending && "opacity-70", className)} aria-busy={pending || undefined}>
      <div className="hidden items-center gap-2 md:flex">
        {filters.map((f) => (
          <FilterSelect
            key={f.key}
            label={f.label}
            value={values[f.key]}
            options={f.options}
            onChange={(v) => apply({ ...values, [f.key]: v })}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
        <Button icon={<SlidersHorizontal size={15} aria-hidden />} onClick={() => setSheetOpen(true)}>
          Filters
          {active.length > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-ink px-1 text-[11px] tabular-nums text-white">
              {active.length}
            </span>
          )}
        </Button>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto no-scrollbar">
          {active.map((f) => (
            <FilterChip
              key={f.key}
              label={`${f.label}: ${f.options.find((o) => o.value === values[f.key])?.label ?? values[f.key]}`}
              onRemove={() => apply({ ...values, [f.key]: anyOf(f) })}
            />
          ))}
        </div>
      </div>
      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        values={values}
        onApply={(v) => {
          setSheetOpen(false);
          apply(v);
        }}
      />
    </div>
  );
}
