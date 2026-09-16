import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass, ButtonLink } from "./Button";

/** Panel footer: "Showing 1–50 of 142" + Previous / Next links. */
export function Pagination({
  summary,
  prevHref,
  nextHref,
}: {
  summary: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const disabled = buttonClass({ size: "sm", className: "pointer-events-none opacity-40" });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-line px-4 py-3 sm:px-5">
      <p className="text-xs tabular-nums text-admin-muted">{summary}</p>
      <div className="flex items-center gap-2">
        {prevHref ? (
          <ButtonLink href={prevHref} size="sm" icon={<ChevronLeft size={14} aria-hidden />}>
            Previous
          </ButtonLink>
        ) : (
          <span className={disabled} aria-disabled="true">
            <ChevronLeft size={14} aria-hidden /> Previous
          </span>
        )}
        {nextHref ? (
          <ButtonLink href={nextHref} size="sm">
            Next <ChevronRight size={14} aria-hidden />
          </ButtonLink>
        ) : (
          <span className={disabled} aria-disabled="true">
            Next <ChevronRight size={14} aria-hidden />
          </span>
        )}
      </div>
    </div>
  );
}
