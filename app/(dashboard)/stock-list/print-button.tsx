"use client";

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
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-md border border-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-accent"
    >
      Print
    </button>
  );
}
