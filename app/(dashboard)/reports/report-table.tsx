"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { PendingLabel } from "./pending-indicators";
import { SortButtonHeader } from "@/components/sortable-header";
import { useSortableData } from "@/lib/use-sortable-data";

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

// Stable accessors object (module scope: doesn't close over props or
// state) so `useSortableData`'s internal useMemo doesn't recompute the
// sort on every render — see Task 1's review note.
//
// `label` deliberately ignores `row.label` and sorts by the row's
// original position (`index`) instead. Month view's `row.label` values
// are day-of-month strings ("1".."31") where a string sort puts "10"
// before "2"; Year view's are month names, which aren't alphabetically
// chronological either. Rows always arrive already in correct
// chronological order from the caller (app/(dashboard)/reports/page.tsx),
// so sorting by index preserves/reverses that order correctly regardless
// of what the label text looks like.
const sortAccessors: Record<
  "label" | "purchases" | "stockOutValue",
  (row: ReportTableRow, index: number) => string | number
> = {
  label: (_row, index) => index,
  purchases: (row) => row.purchases,
  stockOutValue: (row) => row.stockOutValue,
};

/**
 * Plain day-by-day or month-by-month breakdown table for the Reports page.
 * Simpler than StockListTable (app/(dashboard)/stock-list/stock-list-table.tsx):
 * no search box and no cost-visibility branching, since by the time this is
 * rendered the caller has already decided cost is visible. Still a client
 * component (useSortableData is useState-backed) even though there's
 * nothing to debounce.
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
  const { sorted, sortKey, direction, toggle } = useSortableData<
    ReportTableRow,
    keyof typeof sortAccessors
  >(rows, {
    accessors: sortAccessors,
    defaultKey: "label",
  });

  return (
    <table className="mt-6 w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <SortButtonHeader
            label={labelHeader}
            direction={sortKey === "label" ? direction : "none"}
            onClick={() => toggle("label")}
            thClassName="py-2 font-medium"
          />
          <SortButtonHeader
            label="Purchases"
            direction={sortKey === "purchases" ? direction : "none"}
            onClick={() => toggle("purchases")}
            thClassName="py-2 font-medium"
          />
          <SortButtonHeader
            label="Stock-out value"
            direction={sortKey === "stockOutValue" ? direction : "none"}
            onClick={() => toggle("stockOutValue")}
            thClassName="py-2 font-medium"
          />
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {sorted.map((row) => (
          <tr key={row.label} className="text-brand-ink">
            <td className={row.isCurrent ? "font-bold text-brand-green" : ""}>
              {row.href ? (
                // A visible border + persistent (non-hover) underline +
                // ChevronRight are all cues that don't depend on hover
                // (useless on touch) and don't reuse `text-brand-green` —
                // this theme's `--accent`/`--muted` tokens are both
                // near-white, too low-contrast for a background tint alone
                // to read as "clickable," and `text-brand-green` is already
                // `isCurrent`'s "today" signal, so borrowing it here would
                // make a non-today linked day look like today and vice
                // versa.
                //
                // No negative margin here (an earlier version used
                // `-mx-1 -my-2` to expand the tap target without growing
                // the row) — a *border* under negative margin draws
                // outside the link's own box, spilling into the row above
                // and below it (visible as a box straddling two rows,
                // overlapping the Purchases column's text). Padding alone,
                // with no negative margin, keeps the border inside this
                // cell: still a meaningfully bigger tap target than the
                // bare 1-2 digit glyph, just without the overflow bug.
                // `has-[[data-pending=true]]:*` reacts to `PendingLabel`'s
                // own `data-pending` attribute (set via `useLinkStatus`,
                // see pending-indicators.tsx) purely in CSS: once a click
                // sends this link's navigation in flight, the whole link
                // becomes unclickable and dims until it resolves, so a
                // second click on the same day can't stack a second
                // navigation.
                <Link
                  href={row.href}
                  className="flex w-fit items-center gap-1 rounded-md border border-border px-1.5 py-1.5 underline decoration-muted-foreground/50 underline-offset-2 hover:bg-accent hover:decoration-foreground has-[[data-pending=true]]:pointer-events-none has-[[data-pending=true]]:opacity-60"
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
