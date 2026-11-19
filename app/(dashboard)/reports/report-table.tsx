import Link from "next/link";
import { formatCurrency } from "@/lib/format";

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
            <td
              className={
                row.isCurrent
                  ? "py-2 font-bold text-brand-green"
                  : "py-2"
              }
            >
              {row.href ? (
                <Link href={row.href} className="hover:underline">
                  {row.label}
                </Link>
              ) : (
                row.label
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
