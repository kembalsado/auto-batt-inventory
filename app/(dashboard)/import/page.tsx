"use client";

import { Fragment, useState } from "react";
import { submitOpeningStockImport } from "./actions";
import type { OpeningStockRow } from "@/lib/import";

interface DraftRow {
  sku: string;
  name: string;
  category: string;
  qty: string;
  lastKnownUnitCost: string;
  lowStockThreshold: string;
}

function emptyRow(): DraftRow {
  return { sku: "", name: "", category: "", qty: "", lastKnownUnitCost: "", lowStockThreshold: "" };
}

/**
 * Owner-only opening-stock import screen (gated by `isOwnerOnlyRoute` in
 * the dashboard layout, not re-checked here — same convention as
 * app/(dashboard)/activity and app/(dashboard)/settings).
 *
 * A manual entry grid, not a CSV upload: the plan's historical data is a
 * one-time, short, hand-curated list (the owner's existing stock on the
 * day they adopt this app), so a small add/remove-row grid is enough —
 * YAGNI on a CSV parser until a real need for bulk file import shows up.
 *
 * Submits the whole grid to `submitOpeningStockImport` (./actions.ts),
 * which forwards to `importOpeningStock` (lib/import.ts), and renders the
 * per-row error list for anything that failed rather than only a pass/
 * fail summary — a duplicate SKU or bad category for one row shouldn't
 * hide what happened to the rest of the batch.
 */
export default function ImportPage() {
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);

  function updateRow(index: number, field: keyof DraftRow, value: string) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSucceeded(null);
    setErrors([]);

    const payload: OpeningStockRow[] = rows.map((row) => ({
      sku: row.sku.trim(),
      name: row.name.trim(),
      category: row.category.trim(),
      qty: Number(row.qty),
      lastKnownUnitCost: Number(row.lastKnownUnitCost),
      lowStockThreshold:
        row.lowStockThreshold.trim() === "" ? null : Number(row.lowStockThreshold),
    }));

    const result = await submitOpeningStockImport(payload);
    setSucceeded(result.succeeded);
    setErrors(result.errors);
    setSubmitting(false);

    if (result.errors.length === 0) {
      setRows([emptyRow()]);
    }
  }

  const errorsByRow = new Map(errors.map((error) => [error.row, error.message]));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Opening stock import</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        One-time import of stock that already existed before this app was
        adopted. Each row creates a new item (and its category, if new) plus
        an opening-stock batch for the quantity on hand today.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-2 pr-2 font-medium">SKU</th>
              <th className="py-2 pr-2 font-medium">Name</th>
              <th className="py-2 pr-2 font-medium">Category</th>
              <th className="py-2 pr-2 font-medium">Qty</th>
              <th className="py-2 pr-2 font-medium">Last known unit cost</th>
              <th className="py-2 pr-2 font-medium">Low stock threshold</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <Fragment key={index}>
                <tr className="border-b border-border">
                  <td className="py-2 pr-2">
                    <input
                      required
                      value={row.sku}
                      onChange={(e) => updateRow(index, "sku", e.target.value)}
                      className="w-28 rounded-md border border-border px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      required
                      value={row.name}
                      onChange={(e) => updateRow(index, "name", e.target.value)}
                      className="w-40 rounded-md border border-border px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      required
                      value={row.category}
                      onChange={(e) => updateRow(index, "category", e.target.value)}
                      className="w-32 rounded-md border border-border px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      required
                      type="number"
                      min="0"
                      step="any"
                      value={row.qty}
                      onChange={(e) => updateRow(index, "qty", e.target.value)}
                      className="w-20 rounded-md border border-border px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      required
                      type="number"
                      min="0"
                      step="any"
                      value={row.lastKnownUnitCost}
                      onChange={(e) =>
                        updateRow(index, "lastKnownUnitCost", e.target.value)
                      }
                      className="w-28 rounded-md border border-border px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={row.lowStockThreshold}
                      onChange={(e) =>
                        updateRow(index, "lowStockThreshold", e.target.value)
                      }
                      className="w-24 rounded-md border border-border px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      disabled={rows.length === 1}
                      className="text-sm text-red-600 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
                {errorsByRow.has(index) && (
                  <tr>
                    <td colSpan={7} className="pb-2 text-sm text-red-600" role="alert">
                      Row {index + 1}: {errorsByRow.get(index)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={addRow}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-accent"
        >
          Add row
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Importing…" : "Import"}
        </button>
      </div>

      {succeeded !== null && (
        <p className="mt-4 text-sm text-brand-ink">
          {succeeded} row{succeeded === 1 ? "" : "s"} imported successfully.
          {errors.length > 0 &&
            ` ${errors.length} row${errors.length === 1 ? "" : "s"} failed — see above.`}
        </p>
      )}
    </div>
  );
}
