import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  orderStatusMeta,
  PRODUCT_STATUS_META,
  SEGMENT_META,
  STOCK_META,
  TONE_CLASS,
  TONE_DOT,
  type CustomerSegment,
  type ProductStatus,
  type StockState,
  type Tone,
} from "@/lib/admin/status";

/** Status pill: 6px dot + label on the tone's tint. Never wraps. */
export function Badge({
  tone = "neutral",
  dot = true,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

/** Square neutral tag for attributes (scale "1:64", "Manual", "Edited"). */
export function Tag({
  mono,
  className,
  children,
}: {
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border border-admin-line bg-admin-subtle px-1.5 py-px text-[11px] font-medium leading-4 text-brand-ink-soft",
        mono && "font-mono",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const m = orderStatusMeta(status);
  return (
    <Badge tone={m.tone} className={className}>
      {m.label}
    </Badge>
  );
}

export function ProductStatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  const m = PRODUCT_STATUS_META[status];
  return (
    <Badge tone={m.tone} className={className}>
      {m.label}
    </Badge>
  );
}

export function StockBadge({
  state,
  className,
  children,
}: {
  state: StockState;
  className?: string;
  children?: ReactNode;
}) {
  const m = STOCK_META[state];
  return (
    <Badge tone={m.tone} className={className}>
      {children ?? m.label}
    </Badge>
  );
}

export function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  const m = SEGMENT_META[segment];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
