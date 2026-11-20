"use client";

import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SortButtonHeader } from "@/components/sortable-header";
import { useSortableData } from "@/lib/use-sortable-data";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/** One row as rendered by this list — just what the table needs. */
export interface MovementRow {
  id: string;
  type: "IN" | "OUT";
  quantity: number;
  movementDate: string;
  note: string | null;
  voidedAt: string | null;
  createdAt: string;
}

// Stable accessors object (module scope: none of these close over props or
// state) so `useSortableData`'s internal useMemo doesn't recompute the sort
// on every render — see Task 1's review note / Task 4's BatchesTable.
//
// "date" is a composite string key, not a plain `movementDate` lookup:
// `movement_date` has no time component, so `created_at` is the only thing
// that orders two movements recorded on the same calendar day (see
// lib/stock.ts's default query, which orders `movement_date desc,
// created_at desc` for this exact reason — this feature must not regress
// that). `movementDate` is always a fixed-width `YYYY-MM-DD` string, so
// concatenating it with the `createdAt` ISO timestamp and comparing the
// whole thing lexicographically sorts by date first and falls back to time
// only when dates tie — one string accessor, no tuple/array comparator.
const sortAccessors: Record<
  "date" | "type" | "qty" | "note" | "status",
  (row: MovementRow) => string | number
> = {
  date: (row) => `${row.movementDate}_${row.createdAt}`,
  type: (row) => row.type,
  qty: (row) => row.quantity,
  note: (row) => row.note ?? "",
  status: (row) => (row.voidedAt ? 1 : 0),
};

/** Result shape `voidAction` resolves to — an error message, or nothing on success. */
export type VoidActionResult = { error?: string } | void;

/**
 * Renders the item's movement history with a "Void" action on each
 * non-voided row. Voided rows stay visible (struck-through) rather than
 * disappearing — voiding never deletes the ledger row, only reverses its
 * effect on batch quantities (see supabase/migrations/0008_void_movement.sql).
 *
 * `voidAction` is a Server Action bound by the page (so it can resolve the
 * current user and call `voidMovement`) — passed down as a prop since
 * Server Actions can be invoked directly from Client Component event
 * handlers, not just via a `<form action>`.
 */
export function MovementsList({
  movements,
  voidAction,
}: {
  movements: MovementRow[];
  voidAction: (movementId: string) => Promise<VoidActionResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorByRow, setErrorByRow] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const isFiltering = query !== debouncedQuery;

  const filteredMovements = useMemo(() => {
    const normalized = debouncedQuery.trim().toLowerCase();
    if (!normalized) return movements;
    return movements.filter(
      (m) =>
        m.movementDate.toLowerCase().includes(normalized) ||
        m.type.toLowerCase().includes(normalized) ||
        (m.note ?? "").toLowerCase().includes(normalized)
    );
  }, [movements, debouncedQuery]);

  const { sorted, direction, sortKey, toggle } = useSortableData<
    MovementRow,
    keyof typeof sortAccessors
  >(filteredMovements, {
    accessors: sortAccessors,
    defaultKey: "date",
    defaultDirection: "desc",
  });

  function handleVoid(movementId: string) {
    if (
      !window.confirm(
        "Void this movement? This cannot be undone — record a new entry afterward if a correction is needed."
      )
    ) {
      return;
    }

    setPendingId(movementId);
    startTransition(async () => {
      const result = await voidAction(movementId);
      setPendingId(null);
      if (result && "error" in result && result.error) {
        setErrorByRow((prev) => ({ ...prev, [movementId]: result.error! }));
      } else {
        setErrorByRow((prev) => {
          const next = { ...prev };
          delete next[movementId];
          return next;
        });
      }
    });
  }

  if (movements.length === 0) {
    return <p className="mt-6 text-sm text-muted-foreground">No movements yet.</p>;
  }

  function VoidControl({ m }: { m: MovementRow }) {
    const voided = m.voidedAt != null;
    if (voided) return null;
    return (
      <>
        <button
          type="button"
          onClick={() => handleVoid(m.id)}
          disabled={isPending && pendingId === m.id}
          className="text-sm text-destructive underline disabled:opacity-50"
        >
          {isPending && pendingId === m.id ? "Voiding…" : "Void"}
        </button>
        {errorByRow[m.id] && (
          <p className="mt-1 text-xs text-destructive">{errorByRow[m.id]}</p>
        )}
      </>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="text-lg font-medium text-brand-ink">Movement history</h2>

      <div className="relative mt-2 max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by date, type, or note"
          aria-label="Search movement history"
          className="h-9 pl-8 text-sm"
        />
      </div>

      <table
        className={`mt-2 hidden w-full max-w-2xl text-sm md:table transition-opacity${
          isFiltering ? " opacity-60" : ""
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
              label="Type"
              thClassName="py-1 pr-3"
              direction={sortKey === "type" ? direction : "none"}
              onClick={() => toggle("type")}
            />
            <SortButtonHeader
              label="Qty"
              thClassName="py-1 pr-3"
              direction={sortKey === "qty" ? direction : "none"}
              onClick={() => toggle("qty")}
            />
            <SortButtonHeader
              label="Note"
              thClassName="py-1 pr-3"
              direction={sortKey === "note" ? direction : "none"}
              onClick={() => toggle("note")}
            />
            <SortButtonHeader
              label="Status"
              thClassName="py-1 pr-3"
              direction={sortKey === "status" ? direction : "none"}
              onClick={() => toggle("status")}
            />
            <th className="py-1 pr-3" />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="py-1 text-sm text-muted-foreground">
                No movements match your search.
              </td>
            </tr>
          )}
          {sorted.map((m) => {
            const voided = m.voidedAt != null;
            return (
              <tr
                key={m.id}
                className={
                  voided
                    ? "text-muted-foreground"
                    : "text-brand-ink transition-colors hover:bg-muted/40"
                }
              >
                <td className={`py-1 pr-3 ${voided ? "line-through" : ""}`}>{m.movementDate}</td>
                <td className={`py-1 pr-3 ${voided ? "line-through" : ""}`}>{m.type}</td>
                <td className={`py-1 pr-3 ${voided ? "line-through" : ""}`}>{m.quantity}</td>
                <td className={`py-1 pr-3 ${voided ? "line-through" : ""}`}>{m.note ?? ""}</td>
                <td className="py-1 pr-3">{voided ? "Voided" : ""}</td>
                <td className="py-1 pr-3">
                  <VoidControl m={m} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div
        className={`mt-2 flex flex-col gap-2 md:hidden transition-opacity${
          isFiltering ? " opacity-60" : ""
        }`}
      >
        {sorted.length === 0 && (
          <p className="text-sm text-muted-foreground">No movements match your search.</p>
        )}
        {sorted.map((m) => {
          const voided = m.voidedAt != null;
          return (
            <div
              key={m.id}
              className={`rounded-lg border border-border bg-card p-3 text-sm ${voided ? "text-muted-foreground" : "text-brand-ink"}`}
            >
              <div className={`flex items-center justify-between ${voided ? "line-through" : ""}`}>
                <span className="font-medium">
                  {m.type} · {m.quantity}
                </span>
                <span className="text-xs">{m.movementDate}</span>
              </div>
              {m.note && (
                <p className={`mt-1 text-xs ${voided ? "line-through" : "text-muted-foreground"}`}>
                  {m.note}
                </p>
              )}
              <div className="mt-2">
                {voided ? "Voided" : <VoidControl m={m} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
