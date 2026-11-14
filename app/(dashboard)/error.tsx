"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Catches any error thrown while rendering a dashboard route (a failed
 * Supabase query, a thrown Postgres error that isn't a handled case,
 * etc.) so it lands on an on-brand screen instead of Next's generic
 * error page — the sidebar/layout around this stays mounted, only the
 * page content is replaced. There was no error.tsx anywhere in the app
 * before this.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <TriangleAlert className="size-8 text-brand-gold-dark" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-brand-ink">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That didn&apos;t load right. Try again, and if it keeps happening, let the
        shop owner know.
      </p>
      <Button size="touch" onClick={() => reset()} className="mt-2">
        Try again
      </Button>
    </div>
  );
}
