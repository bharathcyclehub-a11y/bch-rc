"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, CircleAlert, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Label above, control, then an error (negative tone) or a muted hint. */
export function Field({
  label,
  hint,
  error,
  optional,
  htmlFor,
  action,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  htmlFor?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-brand-ink">
            {label}
            {optional && <span className="ml-1 font-normal text-admin-muted">(optional)</span>}
          </label>
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-xs leading-4 text-tone-neg" role="alert">
          <CircleAlert size={13} className="mt-px shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-4 text-admin-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "block w-full rounded-lg border border-admin-line-strong bg-white text-sm text-brand-ink placeholder:text-admin-muted transition-shadow focus:border-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-red/20 aria-[invalid=true]:border-tone-neg aria-[invalid=true]:focus:ring-tone-neg/15 disabled:cursor-not-allowed disabled:bg-admin-subtle disabled:text-admin-muted read-only:cursor-default read-only:bg-admin-subtle/60 read-only:text-brand-ink-soft read-only:focus:border-admin-line-strong read-only:focus:ring-0";

export function Input({ invalid, className, ...rest }: { invalid?: boolean } & ComponentProps<"input">) {
  return (
    <input aria-invalid={invalid || undefined} className={cn(CONTROL, "h-9 px-3 max-md:h-11", className)} {...rest} />
  );
}

export function Textarea({ invalid, className, ...rest }: { invalid?: boolean } & ComponentProps<"textarea">) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, "min-h-24 px-3 py-2 leading-5", className)}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: { invalid?: boolean } & ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(CONTROL, "h-9 cursor-pointer appearance-none pl-3 pr-9 max-md:h-11", className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-admin-muted"
      />
    </div>
  );
}

/** Input with a fixed prefix ("₹"). Numeric keyboards on phones. */
export function PrefixInput({
  prefix = "₹",
  invalid,
  className,
  ...rest
}: { prefix?: string; invalid?: boolean } & ComponentProps<"input">) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-admin-muted">
        {prefix}
      </span>
      <input
        inputMode="numeric"
        aria-invalid={invalid || undefined}
        className={cn(CONTROL, "h-9 pl-7 pr-3 tabular-nums max-md:h-11", className)}
        {...rest}
      />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-brand-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-4 text-admin-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-brand-ink" : "bg-admin-line-strong",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className={cn("h-4 w-4 shrink-0 cursor-pointer rounded border-admin-line-strong accent-brand-ink", className)}
    />
  );
}

/** – value + stepper with 44px touch buttons on phones. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 100_000,
  label,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  label: string;
  className?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const btn =
    "grid w-9 shrink-0 place-items-center text-brand-ink-soft transition-colors hover:bg-admin-subtle hover:text-brand-ink disabled:pointer-events-none disabled:opacity-40 max-md:w-11";
  return (
    <div
      className={cn(
        "inline-flex h-9 items-stretch overflow-hidden rounded-lg border border-admin-line-strong bg-white focus-within:ring-2 focus-within:ring-brand-red/20 max-md:h-11",
        className,
      )}
    >
      <button type="button" aria-label={`Decrease ${label}`} className={btn} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Minus size={14} aria-hidden />
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(clamp(digits === "" ? 0 : parseInt(digits, 10)));
        }}
        className="w-14 border-x border-admin-line bg-transparent text-center text-sm font-semibold tabular-nums text-brand-ink focus:outline-none"
      />
      <button type="button" aria-label={`Increase ${label}`} className={btn} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Plus size={14} aria-hidden />
      </button>
    </div>
  );
}
