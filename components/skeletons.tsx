import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared building blocks for every route's `loading.tsx`. Each one
 * mirrors the breakpoint structure of the real content it stands in for
 * (e.g. `TableSkeleton` is `hidden md:table` exactly like the tables in
 * items/page.tsx, stock-list/page.tsx, activity/page.tsx) so swapping the
 * skeleton for real data doesn't reflow the page at any width.
 */

export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <Skeleton className="h-8 w-40" />
      {withAction && <Skeleton className="h-11 w-28 rounded-lg" />}
    </div>
  );
}

export function StatTilesSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="mb-2 size-5 rounded" />
          <Skeleton className="h-7 w-10" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({
  columns = 4,
  rows = 5,
  /**
   * true (default): `hidden md:table`, paired with `CardListSkeleton`
   * below it — matches items/stock-list's table-on-desktop,
   * cards-on-mobile split. false: stays visible at every width, for a
   * table that scrolls horizontally on mobile instead of collapsing
   * (activity/page.tsx, import/page.tsx).
   */
  responsive = true,
}: {
  columns?: number;
  rows?: number;
  responsive?: boolean;
}) {
  return (
    <table
      className={
        responsive
          ? "mt-6 hidden w-full text-left text-sm md:table"
          : "w-full text-left text-sm"
      }
    >
      <thead>
        <tr className="border-b border-border">
          {Array.from({ length: columns }).map((_, i) => (
            <th key={i} className="py-2">
              <Skeleton className="h-3 w-16" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: columns }).map((_, c) => (
              <td key={c} className="py-3">
                <Skeleton className="h-4 w-20" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CardListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="mt-4 flex flex-col gap-2 md:hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="mt-6 flex max-w-md flex-col gap-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="mt-2 h-11 w-28 rounded-lg" />
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div className="mt-6 max-w-3xl overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between bg-brand-green px-4 py-3">
        <Skeleton className="h-9 w-9 rounded-md bg-white/15" />
        <Skeleton className="h-5 w-32 bg-white/15" />
        <Skeleton className="h-9 w-9 rounded-md bg-white/15" />
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="min-h-[76px] bg-card p-1.5">
            <Skeleton className="h-3 w-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
