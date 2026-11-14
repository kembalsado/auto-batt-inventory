import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function StockListLoading() {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-32" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-11 w-20 rounded-lg" />
          <Skeleton className="h-11 w-28 rounded-lg" />
          <Skeleton className="h-11 w-28 rounded-lg" />
        </div>
      </div>
      <TableSkeleton columns={5} rows={6} />
      <CardListSkeleton rows={6} />
    </div>
  );
}
