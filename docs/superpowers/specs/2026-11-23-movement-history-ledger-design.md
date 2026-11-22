# Movement history ledger columns + future-date guard — design

## Intent

Two small, independent UI/behavior changes to the item detail page, requested directly:
1. Restructure the Movement History table into a debit/credit-style ledger: IN quantities on the left, OUT quantities on the right, instead of today's single Type+Qty columns.
2. Disable selecting a future date in both stock-in and stock-out date fields.

## Why

Requested directly — makes the ledger read at a glance the way a debit/credit book does, and prevents an everyday typo (picking the wrong day on a date picker) from recording stock on a date that hasn't happened yet.

## Goals

- `MovementsList` (`app/(dashboard)/items/[id]/movements-list.tsx`): replace the "Type" + "Qty" columns with "IN" and "OUT" columns. A row's quantity appears in whichever column matches its `type`; the other is blank. Same for the mobile card view (IN left-aligned, OUT right-aligned). Voided rows keep their existing struck-through treatment, just in the new column.
- `StockInForm`/`StockOutForm` (`stock-in-form.tsx`/`stock-out-form.tsx`): the date `<input>` gets `max={today}` (same `manilaToday()` already used for `defaultValue`). Their Server Actions (`addStockIn`/`addStockOut`) reject a date after `manilaToday()` server-side too, redirecting back with a new `future-date` error — matching the existing `invalid-qty`/`invalid-cost` pattern (same `inError`/`outError` query params, `STOCK_ERROR_MESSAGES` on the item detail page).

## Non-goals

- No color-coding (e.g. green/red) — not asked for, columns alone carry the left/right meaning.
- No change to the opening-stock import's dates, or the Reports page's date-range filters — "IN/OUT date entry" means these two forms only.
- No change to sorting by date/note/status, or to how voided rows are found/handled.

## Anti-goals

- Must not silently drop the existing "sort by amount" capability — merging Type+Qty into IN/OUT columns must not lose the ability to sort the table by quantity.
- Must not let the future-date rejection happen only client-side — this app's established convention (see both forms' existing comments) is that a Server Action is reachable without the form, so invalid input must be rejected server-side regardless of what the `<input>` attributes allow.

## Constraints

- `manilaToday()` (`lib/date.ts`) is the app's single source of truth for "today" — both the `max` attribute and the server-side check must compare against it, not `new Date()`.
- `movement_date`/`batch_date` are plain dates (`YYYY-MM-DD`), always comparable as strings.
- `tests/components/movements-list.test.tsx`'s existing three tests assert sort order via `row.textContent` containing the literal string "IN"/"OUT" — that literal text moves from a "Type" cell into which of the two new columns is populated, so these tests need rewriting to check cell position/content instead of a substring, not just porting as-is.

## Approaches

**Movement history columns** — one sensible way: two columns (IN, OUT), one populated per row. The only real choice is what happens to sorting, since "Type" and "Qty" were two independently-sortable columns before:
1. Keep three sort keys (date, type, qty/amount) and give both new headers their own sort toggle, confusingly sorting the same two underlying values two different ways depending on which header was clicked last.
2. **(Chosen)** Collapse "type" and "qty" into one "amount" sort key (the existing quantity accessor, unchanged), shared by both the IN and OUT column headers — clicking either toggles the same sort, since both columns really represent one "transaction size" concept split by sign. Matches how a real debit/credit ledger is usually sorted (by amount, not by which side it's on).

**Future-date guard** — one sensible way: `max` attribute (user can't pick it in the native picker) plus a server-side check (can't be bypassed), both compared against `manilaToday()`. No real alternative given the app's established "validate server-side too" convention.

## What's left to the builder

- Exact Tailwind classes for the mobile card's left/right split.
- Whether the new "amount" sort toggles from both headers show the sort arrow on both th elements simultaneously (reasonable default: yes, since they share one sort key) or only on whichever was clicked most recently (not meaningful here since they're the same key).
