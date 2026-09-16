import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_TEXT, type Tone } from "@/lib/admin/status";

/** Overline label, 24px value, one line of context. Use sparingly. */
export function Metric({
  label,
  value,
  hint,
  hintTone,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  hintTone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-admin-line bg-white p-4", className)}>
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold leading-7 tabular-nums text-brand-ink">{value}</p>
      {hint && <p className={cn("mt-1 truncate text-xs", hintTone ? TONE_TEXT[hintTone] : "text-admin-muted")}>{hint}</p>}
    </div>
  );
}
