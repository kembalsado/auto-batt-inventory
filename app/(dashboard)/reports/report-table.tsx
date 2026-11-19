import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { PendingLabel } from "./pending-indicators";

export interface ReportTableRow {
  label: string;
  isCurrent?: boolean;
  purchases: number;
  stockOutValue: number;
  /**
   * When set, `label` renders as a link to this href (Month view's day
   * rows, linking to that day's per-item drill-down modal). Left unset by
   * Year view's rows, which keep rendering as plain text — this component
   * has no idea what period it's showing, so it can't build the URL
   * itself; the caller (app/(dashboard)/reports/page.tsx) always passes a
   * ready-made href instead.
   */
  href?: string;
}

/**
 * Plain day-by-day or month-by-month breakdown table for the Reports page.
 * Simpler than StockListTable (app/(dashboard)/stock-list/stock-list-table.tsx):
 * no search box and no cost-visibility branching, since by the time this is
 * rendered the caller has already decided cost is visible. No "use client"
 * — this is static markup, server-renderable like the rest of the page.
 *
 * `isCurrent` rows are marked the same way Calendar marks "today"
 * (app/(dashboard)/calendar/page.tsx): `text-brand-green font-bold` on the
 * label cell.
 *
 * `labelHeader` names what `row.label` actually is for this table (e.g.
 * "Day" for a Month view's day-by-day breakdown, "Month" for a Year
 * view's month-by-month one) — the caller decides, since this component
 * has no way to know on its own.
 */
export function ReportTable({
  rows,
  labelHeader,
}: {
  rows: ReportTableRow[];
  labelHeader: string;
}) {
  return (
    <table className="mt-6 w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th className="py-2 font-medium">{labelHeader}</th>
          <th className="py-2 font-medium">Purchases</th>
          <th className="py-2 font-medium">Stock-out value</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr key={row.label} className="text-brand-ink">
            <td className={row.isCurrent ? "font-bold text-brand-green" : ""}>
              {row.href ? (
                // The link's own padding (expanded with a matching negative
                // margin so it doesn't grow the row) fills the whole cell
                // rather than just the 1-2 digit label, so the tap target
                // is meaningfully bigger than the glyph on mobile. The
                // visible border + persistent (non-hover) underline +
                // ChevronRight are all cues that don't depend on hover
                // (useless on touch) and don't reuse `text-brand-green` —
                // this theme's `--accent`/`--muted` tokens are both
                // near-white, too low-contrast for a background tint alone
                // to read as "clickable," and `text-brand-green` is already
                // `isCurrent`'s "today" signal, so borrowing it here would
                // make a non-today linked day look like today and vice
                // versa. `has-[[data-pending=true]]:*` reacts to
                // `PendingLabel`'s own `data-pending` attribute (set via
                // `useLinkStatus`, see pending-indicators.tsx) purely in
                // CSS: once a click sends this link's navigation in
                // flight, the whole link becomes unclickable and dims
                // until it resolves, so a second click on the same day
                // can't stack a second navigation.
                <Link
                  href={row.href}
                  className="-mx-1 -my-2 flex items-center gap-1 rounded-md border border-border px-1.5 py-2 underline decoration-muted-foreground/50 underline-offset-2 hover:bg-accent hover:decoration-foreground has-[[data-pending=true]]:pointer-events-none has-[[data-pending=true]]:opacity-60"
                >
                  <PendingLabel>{row.label}</PendingLabel>
                  <ChevronRight className="size-3 text-muted-foreground" aria-hidden="true" />
                </Link>
              ) : (
                <span className="block py-2">{row.label}</span>
              )}
            </td>
            <td className="py-2">{formatCurrency(row.purchases)}</td>
            <td className="py-2">{formatCurrency(row.stockOutValue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
