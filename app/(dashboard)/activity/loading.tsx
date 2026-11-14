import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/skeletons";

export default function ActivityLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-24" />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-11 w-40 rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-11 w-20 rounded-lg" />
      </div>
      <div className="mt-6 overflow-x-auto">
        <TableSkeleton columns={4} rows={6} responsive={false} />
      </div>
    </div>
  );
}
