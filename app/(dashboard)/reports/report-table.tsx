import { formatCurrency } from "@/lib/format";

export interface ReportTableRow {
  label: string;
  isCurrent?: boolean;
  purchases: number;
  stockOutValue: number;
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
 */
export function ReportTable({ rows }: { rows: ReportTableRow[] }) {
  return (
    <table className="mt-6 w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th className="py-2 font-medium">Label</th>
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
              {row.label}
            </td>
            <td className="py-2">{formatCurrency(row.purchases)}</td>
            <td className="py-2">{formatCurrency(row.stockOutValue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
