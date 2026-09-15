import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Flat white panel (1px hairline, 12px radius, no shadow). `overflow-clip`
 * rounds child tables without creating a scroll container.
 */
export function Panel({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cn("overflow-clip rounded-xl border border-admin-line bg-white", className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 border-b border-admin-line px-4 py-3.5 sm:px-5", className)}>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold leading-5 text-brand-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-4 text-admin-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("p-4 sm:p-5", className)}>{children}</div>;
}

/** Label/value rows for detail sidebars. */
export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-admin-line">
      {items.map((it) => (
        <div key={it.label} className="flex items-start justify-between gap-4 px-4 py-2.5 text-[13px] sm:px-5">
          <dt className="shrink-0 text-admin-muted">{it.label}</dt>
          <dd className="min-w-0 text-right font-medium text-brand-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
