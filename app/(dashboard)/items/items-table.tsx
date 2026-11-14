"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { StockListRow } from "@/lib/stock-list";

/**
 * Client-side search for the Items list. `buildStockListRows` already
 * fetches every item in three fixed queries regardless of catalogue size
 * (see page.tsx), so filtering the already-rendered `rows` in the browser
 * needs no extra round trip and updates as the owner/assistant types,
 * unlike the Activity page's GET-form filters which exist for a much
 * larger, append-only table.
 */
export function ItemsTable({ rows }: { rows: StockListRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

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

  // The whole row already highlights on hover (hover:bg-muted/40 below),
  // but only the item name was ever an actual <Link> — so a pointer
  // hovering the SKU/category/unit/qty cells got the highlight with no
  // pointer cursor, a mismatched affordance a user flagged directly.
  // Clicking anywhere in the row now navigates; skip when the click
  // already landed on the name's own <a> so its native behavior (e.g.
  // ctrl/cmd-click opening a new tab) isn't double-handled.
  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>, itemId: string) {
    if ((event.target as HTMLElement).closest("a")) return;
    router.push(`/items/${itemId}`);
  }

  return (
    <div>
      <div className="relative mt-4 max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by SKU, name, or category"
          aria-label="Search items"
          className="h-11 pl-8"
        />
      </div>

      {/* Table at md and up (same breakpoint the sidebar collapses at);
          a card list below that, where a 5-column table would overflow
          a phone's width. Both read the same `filteredRows` — see Stock
          List and the Activity page for the same split, all for the same
          reason. */}
      <table className="mt-4 hidden w-full text-left text-sm md:table">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Category</th>
            <th className="py-2 font-medium">Unit</th>
            <th className="py-2 font-medium">Qty on hand</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {filteredRows.map((row) => (
            <tr
              key={row.id}
              onClick={(event) => handleRowClick(event, row.id)}
              className="cursor-pointer text-brand-ink transition-colors hover:bg-muted/40"
            >
              <td className="py-2">{row.sku}</td>
              <td className="py-2">
                <Link href={`/items/${row.id}`} className="hover:underline">
                  {row.name}
                </Link>
                {!row.isActive && (
                  <Badge variant="secondary" className="ml-2">
                    Inactive
                  </Badge>
                )}
              </td>
              <td className="py-2">{row.category}</td>
              <td className="py-2">{row.unit}</td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  {row.qtyOnHand}
                  {row.isLowStock && <Badge variant="warning">Low</Badge>}
                </span>
              </td>
            </tr>
          ))}
          {filteredRows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-sm text-muted-foreground">
                {rows.length === 0 ? "No items yet." : "No items match your search."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-4 flex flex-col gap-2 md:hidden">
        {filteredRows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "No items yet." : "No items match your search."}
          </p>
        )}
        {filteredRows.map((row) => (
          <Link
            key={row.id}
            href={`/items/${row.id}`}
            className="rounded-lg border border-border bg-card p-3 transition-colors active:bg-muted/40"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-brand-ink">{row.name}</span>
              <span className="text-xs text-muted-foreground">{row.sku}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{row.category}</span>
              <span className="flex items-center gap-2 text-brand-ink">
                {row.qtyOnHand} {row.unit}
                {row.isLowStock && <Badge variant="warning">Low</Badge>}
                {!row.isActive && <Badge variant="secondary">Inactive</Badge>}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
