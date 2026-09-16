import { Skeleton } from "@/components/admin/Skeleton";

/** Control-centre skeleton: header with thumbnail, tabs, metric row, two panels. */
export default function ProductLoading() {
  return (
    <div aria-busy="true" aria-label="Loading product">
      <Skeleton className="mb-3 h-4 w-24" />
      <div className="mb-5 flex items-start gap-4">
        <Skeleton className="h-14 w-14 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 max-md:hidden" />
      </div>
      <div className="mb-5 flex gap-6 border-b border-admin-line pb-3">
        {["w-16", "w-20", "w-20", "w-14", "w-16"].map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-admin-line bg-white p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-admin-line bg-white">
          <div className="border-b border-admin-line px-5 py-4">
            <Skeleton className="h-4 w-32" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-admin-line px-5 py-3.5 last:border-0">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-admin-line bg-white p-5">
          <Skeleton className="h-4 w-20" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
