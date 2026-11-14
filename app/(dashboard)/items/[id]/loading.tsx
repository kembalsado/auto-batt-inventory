import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton, TableSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function ItemDetailLoading() {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="mt-2 h-4 w-20" />
      <Skeleton className="mt-3 h-4 w-32" />

      <Skeleton className="mt-6 h-6 w-36" />
      <FormSkeleton fields={4} />

      <Skeleton className="mt-6 h-6 w-36" />
      <FormSkeleton fields={3} />

      <Skeleton className="mt-6 h-6 w-20" />
      <TableSkeleton columns={5} rows={3} />
      <CardListSkeleton rows={3} />

      <Skeleton className="mt-6 h-6 w-36" />
      <TableSkeleton columns={5} rows={4} />
      <CardListSkeleton rows={4} />
    </div>
  );
}
