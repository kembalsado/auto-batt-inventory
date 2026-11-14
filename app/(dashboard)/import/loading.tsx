import { Skeleton } from "@/components/ui/skeleton";

/**
 * Import's own grid (unlike every other table in the app) stays a table
 * at every width — it's a dense bulk-entry sheet, not a list meant to
 * collapse into cards on mobile — so this skips the shared TableSkeleton
 * (which hides below `md`) for one that stays visible throughout.
 */
export default function ImportLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
      <Skeleton className="mt-1 h-4 w-2/3 max-w-2xl" />
      <div className="mt-6 overflow-x-auto">
        <div className="flex min-w-[720px] gap-2 border-b border-border pb-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
        <div className="mt-3 flex min-w-[720px] gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20" />
          ))}
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <Skeleton className="h-11 w-24 rounded-lg" />
        <Skeleton className="h-11 w-24 rounded-lg" />
      </div>
    </div>
  );
}
