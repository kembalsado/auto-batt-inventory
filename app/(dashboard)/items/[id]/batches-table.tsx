"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SortButtonHeader } from "@/components/sortable-header";
import { useSortableData } from "@/lib/use-sortable-data";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/** One row as rendered by this table — just what it needs from `ViewerBatch` (lib/items.ts). */
export interface BatchRow {
  id: string;
  batch_date: string;
  qty_received: number;
  qty_remaining: number;
  unit_cost?: number;
  source: "purchase" | "opening_stock";
}

// Stable accessors object (module scope: none of these close over props or
// state) so `useSortableData`'s internal useMemo doesn't recompute the sort
// on every render — see Task 1's review note. Rows with no `unit_cost`
// sort predictably to the low end (-1 is never a real cost).
const sortAccessors: Record<
  "date" | "received" | "remaining" | "cost" | "source",
  (row: BatchRow) => string | number
> = {
  date: (row) => row.batch_date,
  received: (row) => row.qty_received,
  remaining: (row) => row.qty_remaining,
  cost: (row) => row.unit_cost ?? -1,
  source: (row) => row.source,
};

/**
 * This item's batch list with a client-side search, same reasoning as the
 * Items list's ItemsTable (app/(dashboard)/items/items-table.tsx) — a
 * single item's batches are already fetched in full by
 * `getItemStockSummary`, so filtering in the browser needs no extra
 * round trip.
 */
export function BatchesTable({ batches }: { batches: BatchRow[] }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const isPending = query !== debouncedQuery;
  const showCost = batches.some((b) => b.unit_cost !== undefined);

  const filteredBatches = useMemo(() => {
    const normalized = debouncedQuery.trim().toLowerCase();
    if (!normalized) return batches;
    return batches.filter(
      (b) =>
        b.batch_date.toLowerCase().includes(normalized) ||
        b.source.toLowerCase().includes(normalized)
    );
  }, [batches, debouncedQuery]);

  const { sorted, direction, sortKey, toggle } = useSortableData<
    BatchRow,
    keyof typeof sortAccessors
  >(filteredBatches, {
    accessors: sortAccessors,
    defaultKey: "date",
  });

  return (
    <div>
      <div className="relative mt-2 max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by date or source"
          aria-label="Search batches"
          className="h-9 pl-8 text-sm"
        />
      </div>

      <table
        className={`mt-2 hidden w-full max-w-2xl text-sm md:table transition-opacity${
          isPending ? " opacity-60" : ""
        }`}
      >
        <thead>
          <tr className="text-left text-muted-foreground">
            <SortButtonHeader
              label="Date"
              thClassName="py-1 pr-3"
              direction={sortKey === "date" ? direction : "none"}
              onClick={() => toggle("date")}
            />
            <SortButtonHeader
              label="Received"
              thClassName="py-1 pr-3"
              direction={sortKey === "received" ? direction : "none"}
              onClick={() => toggle("received")}
            />
            <SortButtonHeader
              label="Remaining"
              thClassName="py-1 pr-3"
              direction={sortKey === "remaining" ? direction : "none"}
              onClick={() => toggle("remaining")}
            />
            {showCost && (
              <SortButtonHeader
                label="Unit cost"
                thClassName="py-1 pr-3"
                direction={sortKey === "cost" ? direction : "none"}
                onClick={() => toggle("cost")}
              />
            )}
            <SortButtonHeader
              label="Source"
              thClassName="py-1 pr-3"
              direction={sortKey === "source" ? direction : "none"}
              onClick={() => toggle("source")}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((batch) => (
            <tr key={batch.id} className="text-brand-ink">
              <td className="py-1 pr-3">{batch.batch_date}</td>
              <td className="py-1 pr-3">{batch.qty_received}</td>
              <td className="py-1 pr-3">{batch.qty_remaining}</td>
              {showCost && (
                <td className="py-1 pr-3">
                  {batch.unit_cost !== undefined ? batch.unit_cost : ""}
                </td>
              )}
              <td className="py-1 pr-3">{batch.source}</td>
            </tr>
          ))}
          {filteredBatches.length === 0 && (
            <tr>
              <td colSpan={showCost ? 5 : 4} className="py-1 text-sm text-muted-foreground">
                No batches match your search.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div
        className={`mt-2 flex flex-col gap-2 md:hidden transition-opacity${
          isPending ? " opacity-60" : ""
        }`}
      >
        {filteredBatches.length === 0 && (
          <p className="text-sm text-muted-foreground">No batches match your search.</p>
        )}
        {sorted.map((batch) => (
          <div
            key={batch.id}
            className="rounded-lg border border-border bg-card p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-brand-ink">{batch.batch_date}</span>
              <span className="text-xs text-muted-foreground">{batch.source}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-muted-foreground">
              <span>
                {batch.qty_remaining} / {batch.qty_received} remaining
              </span>
              {batch.unit_cost !== undefined && <span>{batch.unit_cost}/unit</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
