"use client";

import { useState, useTransition } from "react";

/** One row as rendered by this list — just what the table needs. */
export interface MovementRow {
  id: string;
  type: "IN" | "OUT";
  quantity: number;
  movementDate: string;
  note: string | null;
  voidedAt: string | null;
}

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

      <table className="mt-2 hidden w-full max-w-2xl text-sm md:table">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3">Date</th>
            <th className="py-1 pr-3">Type</th>
            <th className="py-1 pr-3">Qty</th>
            <th className="py-1 pr-3">Note</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1 pr-3" />
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
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

      <div className="mt-2 flex flex-col gap-2 md:hidden">
        {movements.map((m) => {
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
