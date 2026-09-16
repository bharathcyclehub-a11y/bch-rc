import { Skeleton } from "@/components/admin/Skeleton";

/** Profile skeleton: header, metric row, then order history + side panels. */
export default function CustomerProfileLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-4 w-24" />
      <div className="mb-4 flex items-start gap-4 md:mb-6">
        <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-48 max-w-full" />
          <Skeleton className="h-4 w-36 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 max-md:h-11 max-md:w-11" />
        <Skeleton className="h-9 w-20 max-md:h-11 max-md:w-11" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:mb-6 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-admin-line bg-white p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-7 w-24 max-w-full" />
            <Skeleton className="mt-2 h-3 w-20 max-w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="overflow-hidden rounded-xl border border-admin-line bg-white lg:col-span-2">
          <div className="border-b border-admin-line px-4 py-4 sm:px-5">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="divide-y divide-admin-line">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {[3, 4].map((rows, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-admin-line bg-white">
              <div className="border-b border-admin-line px-4 py-4 sm:px-5">
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="space-y-3 p-4 sm:p-5">
                {Array.from({ length: rows }).map((_, j) => (
                  <Skeleton key={j} className="h-3.5 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
