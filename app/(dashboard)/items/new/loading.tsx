import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton } from "@/components/skeletons";

export default function NewItemLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-28" />
      <FormSkeleton fields={5} />
    </div>
  );
}
