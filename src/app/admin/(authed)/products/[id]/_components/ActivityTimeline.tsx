import { History } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/admin/EmptyState";
import { TONE_DOT } from "@/lib/admin/status";
import { formatDateTimeShort, formatRelative } from "@/lib/admin/format";
import type { ProductActivity } from "@/lib/admin/catalog";

/** Who changed what, when — from the `events` audit log. */
export function ActivityTimeline({ items, now, emptyText }: { items: ProductActivity[]; now: number; emptyText: string }) {
  if (items.length === 0) return <EmptyState compact icon={History} title="No activity yet" description={emptyText} />;
  return (
    <ol className="space-y-4 px-4 py-4 sm:px-5">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT[item.tone])} />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-brand-ink">{item.title}</p>
            {item.detail && <p className="break-words text-xs text-brand-ink-soft">{item.detail}</p>}
            <p className="mt-0.5 text-xs text-admin-muted">
              {item.by && <span>{item.by.split("@")[0]} · </span>}
              <time dateTime={item.at} title={formatDateTimeShort(item.at)}>
                {formatRelative(item.at, now)}
              </time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
