import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton, TableSkeleton } from "@/components/skeletons";

export default function UsersLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-28" />
      <FormSkeleton fields={4} />
      <Skeleton className="mt-10 h-6 w-24" />
      <div className="mt-4 overflow-x-auto">
        <TableSkeleton columns={5} rows={4} responsive={false} />
      </div>
    </div>
  );
}
