import { Skeleton } from "@/components/ui/skeleton";

export default function LoginLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        <Skeleton className="mx-auto mb-6 h-20 w-20 rounded-lg" />
        <Skeleton className="mb-6 h-6 w-20" />
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
          <Skeleton className="mt-2 h-11 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
