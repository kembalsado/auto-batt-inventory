"use client";

import { Button } from "@/components/ui/button";

/**
 * Triggers the browser's native print dialog for the stock list page.
 * A client component only because `window.print()` needs one — the page
 * itself (page.tsx) stays a Server Component for its data fetch.
 *
 * Hidden itself when printing (`print:hidden`) — it has nothing to do
 * once the print dialog is already open.
 */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      onClick={() => window.print()}
      className="print:hidden"
    >
      Print
    </Button>
  );
}
