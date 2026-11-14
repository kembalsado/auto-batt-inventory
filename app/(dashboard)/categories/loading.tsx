import { Skeleton } from "@/components/ui/skeleton";

export default function CategoriesLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-32" />
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-11 w-full rounded-lg sm:w-64" />
        <Skeleton className="h-11 w-32 rounded-lg" />
      </div>
      <div className="mt-6 flex flex-col divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="my-2 h-4 w-40" />
        ))}
      </div>
    </div>
  );
}
