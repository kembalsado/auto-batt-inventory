import { Skeleton } from "@/components/ui/skeleton";
import { CalendarSkeleton } from "@/components/skeletons";

export default function CalendarLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-28" />
      <CalendarSkeleton />
    </div>
  );
}
