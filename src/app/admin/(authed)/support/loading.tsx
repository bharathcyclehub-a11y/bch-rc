import { PageHeaderSkeleton, Skeleton } from "@/components/admin/Skeleton";

/** Support dashboard skeleton: metric rows, then the two panels. */
export default function SupportDashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <PageHeaderSkeleton actions={2} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-admin-line bg-white p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-12" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-admin-line bg-white">
          <div className="border-b border-admin-line px-5 py-4">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="divide-y divide-admin-line">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-admin-line bg-white p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-32 w-full" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </div>
      </div>
    </div>
  );
}
