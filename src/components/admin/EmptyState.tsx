import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Muted icon circle, title, one sentence, one action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 text-center", compact ? "py-10" : "py-14 md:py-16", className)}>
      <div className="grid h-10 w-10 place-items-center rounded-full bg-admin-subtle text-admin-muted">
        <Icon size={18} aria-hidden />
      </div>
      <p className="mt-3 text-sm font-semibold text-brand-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-5 text-admin-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
