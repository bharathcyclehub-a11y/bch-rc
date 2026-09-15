"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = {
  key: string;
  label: string;
  count?: number | null;
  /** When set the tab navigates (URL-driven state); otherwise it calls onSelect. */
  href?: string;
};

/**
 * Underline tabs with counts. Scrolls sideways (edge to edge) on phones; the
 * selected tab gets ink text and the 2px Pocket RC red underline.
 */
export function Tabs({
  items,
  active,
  onSelect,
  ariaLabel,
  className,
}: {
  items: TabItem[];
  active: string;
  onSelect?: (key: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={cn("-mx-4 overflow-x-auto no-scrollbar px-4 md:mx-0 md:px-0", className)}>
      <div className="flex w-max min-w-full items-center gap-6 border-b border-admin-line">
        {items.map((t) => {
          const selected = t.key === active;
          const cls = cn(
            "relative inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-colors",
            selected
              ? "text-brand-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-red"
              : "text-admin-muted hover:text-brand-ink",
          );
          const body = (
            <>
              {t.label}
              {t.count != null && (
                <span
                  className={cn(
                    "rounded-md px-1.5 text-[11px] leading-5 tabular-nums",
                    selected ? "bg-brand-ink text-white" : "bg-admin-subtle text-brand-ink-soft",
                  )}
                >
                  {t.count.toLocaleString("en-IN")}
                </span>
              )}
            </>
          );
          return t.href ? (
            <Link key={t.key} href={t.href} scroll={false} aria-current={selected ? "page" : undefined} className={cls}>
              {body}
            </Link>
          ) : (
            <button key={t.key} type="button" aria-pressed={selected} onClick={() => onSelect?.(t.key)} className={cls}>
              {body}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
