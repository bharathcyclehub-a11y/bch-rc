"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 2–4 mutually exclusive options (Grid | Table, Set | Add | Remove). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; icon?: ReactNode; iconOnly?: boolean }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex shrink-0 rounded-lg bg-admin-subtle p-0.5", className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.iconOnly ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors max-md:h-10",
              o.iconOnly ? "w-8 max-md:w-10" : "px-2.5",
              selected
                ? "bg-white text-brand-ink shadow-[0_1px_2px_rgba(10,10,10,0.08)] ring-1 ring-admin-line"
                : "text-admin-muted hover:text-brand-ink",
            )}
          >
            {o.icon}
            {!o.iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}
