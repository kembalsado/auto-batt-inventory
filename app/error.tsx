"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Root-level fallback for anything not already caught by a more specific
 * boundary (app/(dashboard)/error.tsx covers the authenticated app) —
 * mainly /login and any top-level rendering error. Does not cover the
 * root layout itself throwing (that needs global-error.tsx, which
 * replaces <html>/<body> entirely) — not added here since layout.tsx
 * does no data fetching and essentially can't throw.
 */
export default function RootError({
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
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <TriangleAlert className="size-8 text-brand-gold-dark" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-brand-ink">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That didn&apos;t load right. Try again in a moment.
      </p>
      <Button size="touch" onClick={() => reset()} className="mt-2">
        Try again
      </Button>
    </div>
  );
}
