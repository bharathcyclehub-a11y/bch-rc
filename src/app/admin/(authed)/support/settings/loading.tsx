import { PageHeaderSkeleton, Skeleton } from "@/components/admin/Skeleton";

export default function SupportSettingsLoading() {
  return (
    <div className="max-w-4xl" aria-busy="true" aria-label="Loading">
      <PageHeaderSkeleton actions={0} />
      <div className="space-y-4">
        {[5, 6, 8, 6].map((rows, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-admin-line bg-white">
            <div className="border-b border-admin-line px-5 py-4">
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="space-y-3 p-5">
              {Array.from({ length: rows }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
