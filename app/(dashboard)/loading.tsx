import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, StatTilesSkeleton } from "@/components/skeletons";

/**
 * Dashboard's own loading UI — Next.js shows this instantly (via the
 * Suspense boundary it wraps this route segment in) while the real
 * page's Supabase queries are still in flight, rather than leaving
 * whatever route you navigated from frozen on screen with no feedback.
 * Shape matches app/(dashboard)/page.tsx: header, four stat tiles, one
 * list card below.
 */
export default function DashboardLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <StatTilesSkeleton />
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-4 w-20" />
        <div className="mt-3 flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
