"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Floating black bar shown while rows are selected. Centred over the content
 * column (offset by the nav width) and lifted above the phone tab bar.
 */
export function BulkActionBar({
  count,
  noun = "selected",
  onClear,
  children,
}: {
  count: number;
  noun?: string;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="pointer-events-none fixed right-0 z-40 flex justify-center px-3"
      style={{ left: "var(--admin-sidebar-w)", bottom: "calc(var(--admin-bottom-offset) + 16px)" }}
    >
      <div className="admin-anim-pop pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-xl bg-brand-ink p-1.5 pl-3.5 text-white shadow-[0_12px_32px_-8px_rgba(10,10,10,0.45)]">
        <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums">
          {count} {noun}
        </span>
        <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-white/20" />
        {children}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="ml-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white max-md:h-10 max-md:w-10"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function BulkAction({
  onClick,
  icon,
  disabled,
  children,
}: {
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 max-md:h-10"
    >
      {icon}
      {children}
    </button>
  );
}
