import { Skeleton } from "@/components/ui/skeleton";
import { ReportsSkeleton } from "@/components/skeletons";

export default function ReportsLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-28" />
      <ReportsSkeleton />
    </div>
  );
}
