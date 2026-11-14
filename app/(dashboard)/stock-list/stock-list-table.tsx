"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { StockListRow } from "@/lib/stock-list";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Client-side search for the Stock List, same reasoning as the Items
 * list's ItemsTable (app/(dashboard)/items/items-table.tsx):
 * `buildStockListRows` already fetches every active item in fixed bulk
 * queries, so filtering `rows` in the browser needs no extra round trip.
 *
 * The search box itself carries `print:hidden` — the printed/exported
 * page should show the full list regardless of whatever the owner last
 * typed on screen, matching the sidebar/action-bar's own print:hidden
 * treatment in page.tsx.
 */
export function StockListTable({
  rows,
  showCost,
}: {
  rows: StockListRow[];
  showCost: boolean;
}) {
  const [query, setQuery] = useState("");
  const columnCount = showCost ? 7 : 5;

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter(
      (row) =>
        row.sku.toLowerCase().includes(normalized) ||
        row.name.toLowerCase().includes(normalized) ||
        row.category.toLowerCase().includes(normalized)
    );
  }, [rows, query]);

  return (
    <div>
      <div className="relative mt-4 max-w-sm print:hidden">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by SKU, name, or category"
          aria-label="Search stock list"
          className="h-11 pl-8"
        />
      </div>

      {/* Table at md and up; a card list below that for phone width —
          same split as the Items list, same reason (a 7-column table
          doesn't fit a phone). Print output always uses the table (the
          print stylesheet only hides the sidebar/action bar, not this),
          since a printed page has the table's full width available
          regardless of screen size. */}
      <table className="mt-6 hidden w-full text-left text-sm md:table print:table">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Category</th>
            <th className="py-2 font-medium">Qty on hand</th>
            <th className="py-2 font-medium">Unit</th>
            {showCost && <th className="py-2 font-medium">Unit cost</th>}
            {showCost && (
              <th className="py-2 font-medium">Inventory value</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {filteredRows.map((row) => (
            <tr key={row.sku} className="text-brand-ink transition-colors hover:bg-muted/40 print:hover:bg-transparent">
              <td className="py-2">{row.sku}</td>
              <td className="py-2">{row.name}</td>
              <td className="py-2">{row.category}</td>
              <td className="py-2">{row.qtyOnHand}</td>
              <td className="py-2">{row.unit}</td>
              {showCost && (
                <td className="py-2">
                  {row.unitCost !== undefined
                    ? formatCurrency(row.unitCost)
                    : ""}
                </td>
              )}
              {showCost && (
                <td className="py-2">
                  {row.inventoryValue !== undefined
                    ? formatCurrency(row.inventoryValue)
                    : ""}
                </td>
              )}
            </tr>
          ))}
          {filteredRows.length === 0 && (
            <tr>
              <td
                colSpan={columnCount}
                className="py-2 text-sm text-muted-foreground"
              >
                {rows.length === 0 ? "No active items." : "No items match your search."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-4 flex flex-col gap-2 md:hidden print:hidden">
        {filteredRows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "No active items." : "No items match your search."}
          </p>
        )}
        {filteredRows.map((row) => (
          <div key={row.sku} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-brand-ink">{row.name}</span>
              <span className="text-xs text-muted-foreground">{row.sku}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{row.category}</span>
              <span className="text-brand-ink">
                {row.qtyOnHand} {row.unit}
              </span>
            </div>
            {showCost && row.unitCost !== undefined && (
              <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
                <span>Unit cost: {formatCurrency(row.unitCost)}</span>
                <span>
                  Value:{" "}
                  {row.inventoryValue !== undefined
                    ? formatCurrency(row.inventoryValue)
                    : ""}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
