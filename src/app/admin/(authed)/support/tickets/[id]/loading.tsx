import { PageHeaderSkeleton, Skeleton } from "@/components/admin/Skeleton";

/** Ticket detail skeleton: header, conversation column, sidebar panels. */
export default function TicketDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-4 w-16" />
      <PageHeaderSkeleton actions={3} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-xl border border-admin-line bg-white">
          <div className="border-b border-admin-line px-5 py-4">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="divide-y divide-admin-line">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-5 py-4">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-admin-line p-5">
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
        <div className="space-y-4">
          {[3, 5, 4].map((rows, i) => (
            <div key={i} className="rounded-xl border border-admin-line bg-white p-5">
              <Skeleton className="h-4 w-28" />
              <div className="mt-4 space-y-2.5">
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
