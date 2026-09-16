import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page title + one line of live context + actions (max one primary). On
 * phones the actions wrap under the title instead of squeezing it.
 */
export function PageHeader({
  title,
  description,
  back,
  backLink,
  media,
  badges,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  /** Custom back control (e.g. one that restores list filters); overrides `back`. */
  backLink?: ReactNode;
  media?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-4 md:mb-6", className)}>
      {backLink}
      {!backLink && back && (
        <Link
          href={back.href}
          className="-ml-1 mb-2 inline-flex h-8 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-admin-muted hover:text-brand-ink max-md:h-10"
        >
          <ArrowLeft size={15} aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {media && <div className="shrink-0">{media}</div>}
        <div className="min-w-0 flex-1 basis-44 sm:basis-60">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="break-words text-xl font-semibold leading-7 text-brand-ink md:text-[22px]">{title}</h1>
            {badges}
          </div>
          {description && <div className="mt-1 text-[13px] leading-5 text-admin-muted">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
