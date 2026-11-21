"use client";

import { Button } from "@/components/ui/button";

/**
 * Opens the Export PDF at `href` in a new tab and triggers the browser's
 * print dialog there, once it loads. Unlike Stock List's `PrintButton`
 * (app/(dashboard)/stock-list/print-button.tsx), which prints the live
 * page itself, Reports' Month/Year views only ever render one day's
 * per-item list at a time (the click-to-open modal) — the full day-by-day
 * breakdown this feature wants printed only exists in the PDF, so Print
 * routes through that document instead of the page.
 *
 * Best-effort: if the popup is blocked, `window.open` returns `null` and
 * this does nothing further — same degradation any `window.open`-based
 * flow has. If the browser's built-in PDF viewer doesn't fire the `load`
 * event (or doesn't honor `.print()`) the tab still opens with the right
 * PDF, so the viewer can print from there manually.
 */
export function PrintExportButton({ href }: { href: string }) {
  function handlePrint() {
    const printWindow = window.open(href, "_blank");
    printWindow?.addEventListener("load", () => printWindow.print());
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      onClick={handlePrint}
      className="print:hidden"
    >
      Print
    </Button>
  );
}
