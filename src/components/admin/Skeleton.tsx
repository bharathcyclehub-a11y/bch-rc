import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-[#eeeae4]", className)} />;
}

/** Title + context line + actions, matching <PageHeader>. */
export function PageHeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-4 flex items-start gap-4 md:mb-6">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      {Array.from({ length: actions }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-28 max-md:h-11 max-md:w-11" />
      ))}
    </div>
  );
}

/** List page skeleton: tabs, filter row, then table rows (cards on phones). */
export function ListPageSkeleton({ rows = 8, withTabs = true }: { rows?: number; withTabs?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <PageHeaderSkeleton actions={2} />
      {withTabs && (
        <div className="mb-4 flex gap-6 border-b border-admin-line pb-3">
          {["w-16", "w-20", "w-14", "w-16", "w-10"].map((w, i) => (
            <Skeleton key={i} className={`h-4 ${w}`} />
          ))}
        </div>
      )}
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-9 flex-1 max-md:h-11" />
        <Skeleton className="h-9 w-32 max-md:h-11 max-md:w-24" />
      </div>
      <div className="overflow-hidden rounded-xl border border-admin-line bg-white">
        <div className="hidden border-b border-admin-line bg-admin-subtle/70 px-4 py-3 md:block">
          <Skeleton className="h-3 w-1/3" />
        </div>
        <div className="divide-y divide-admin-line">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
