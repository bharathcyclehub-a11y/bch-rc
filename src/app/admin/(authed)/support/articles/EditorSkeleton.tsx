import { PageHeaderSkeleton, Skeleton } from "@/components/admin/Skeleton";

/** Article editor skeleton: main fields + steps, publishing sidebar. */
export function ArticleEditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-4 w-24" />
      <PageHeaderSkeleton actions={1} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {[4, 6].map((rows, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-admin-line bg-white p-5">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: rows }).map((_, j) => (
                <Skeleton key={j} className="h-9 w-full" />
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[2, 6].map((rows, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-admin-line bg-white p-5">
              <Skeleton className="h-4 w-20" />
              {Array.from({ length: rows }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

