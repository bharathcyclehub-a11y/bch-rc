import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Horizontal chip row that scrolls edge-to-edge on phones. */
export function ChipRow({ className, children, ariaLabel }: { className?: string; children: ReactNode; ariaLabel?: string }) {
  return (
    <div
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "-mx-4 flex items-center gap-2 overflow-x-auto no-scrollbar px-4 md:mx-0 md:px-0",
        // Fade the right edge where the row scrolls, so cut-off chips read as "more".
        "max-xl:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2.5rem),transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Filter chip. Selected = black fill (never red). `dashed` = empty category. */
export function Chip({
  active,
  dashed,
  href,
  onClick,
  count,
  media,
  className,
  children,
}: {
  active?: boolean;
  dashed?: boolean;
  href?: string;
  onClick?: () => void;
  count?: number;
  media?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const cls = cn(
    "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border text-[13px] font-medium transition-colors max-md:h-10",
    media ? "pl-1 pr-3.5" : "px-3.5",
    active
      ? "border-brand-ink bg-brand-ink text-white"
      : dashed
        ? "border-dashed border-admin-line-strong bg-transparent text-admin-muted hover:text-brand-ink"
        : "border-admin-line bg-white text-brand-ink-soft hover:border-admin-line-strong hover:text-brand-ink",
    className,
  );
  const body = (
    <>
      {media}
      {children}
      {count != null && (
        <span className={cn("text-xs tabular-nums", active ? "text-white/70" : "text-admin-muted")}>{count}</span>
      )}
    </>
  );
  if (href)
    return (
      <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={cls}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls}>
      {body}
    </button>
  );
}

/** Removable active-filter chip. */
export function FilterChip({ label, onRemove, href }: { label: string; onRemove?: () => void; href?: string }) {
  const cls =
    "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-admin-line bg-admin-subtle pl-3 pr-1.5 text-xs font-medium text-brand-ink max-md:h-9";
  const x = (
    <span className="grid h-6 w-6 place-items-center rounded-full text-admin-muted hover:bg-white hover:text-brand-ink">
      <X size={12} aria-hidden />
    </span>
  );
  if (href)
    return (
      <Link href={href} scroll={false} className={cls} aria-label={`Remove filter ${label}`}>
        {label}
        {x}
      </Link>
    );
  return (
    <button type="button" onClick={onRemove} className={cls} aria-label={`Remove filter ${label}`}>
      {label}
      {x}
    </button>
  );
}
