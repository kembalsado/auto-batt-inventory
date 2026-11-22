# Movement History Ledger Columns + Future-Date Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the item detail page's Movement History table into a debit/credit-style IN/OUT column layout, and block entering a future date on either stock form.

**Architecture:** A small pure date helper (`lib/date.ts`) backs a server-side guard added to both existing stock-in/stock-out Server Actions (reusing their existing `inError`/`outError` redirect convention); `movements-list.tsx`'s two merged "Type"/"Qty" columns become two single-purpose "IN"/"OUT" columns sharing one sort key.

**Tech Stack:** Next.js App Router, React Testing Library, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-movement-history-ledger-design.md`

## Global Constraints

- "Today" is always `manilaToday()` (`lib/date.ts`) — Asia/Manila calendar date, never `new Date()` directly.
- `movement_date`/`batch_date` are plain `YYYY-MM-DD` strings — safe to compare lexicographically.
- The future-date rejection must happen server-side (not just via the `<input max>` attribute) — both Server Actions are reachable without the form, per their own existing comments.
- No color-coding; the IN/OUT split is columns only.
- Sorting by amount must still work after the Type+Qty merge into IN/OUT — collapse both into one shared `"amount"` sort key.

## Review Focus

- **A future date entered via a route that bypasses the `<input max>` attribute (e.g. a replayed form POST) must still be rejected.** The spec explicitly calls out that validation must not be client-only. (Covered by Task 2's `isFutureDate` test plus the server-side wiring; verified manually in Task 2 since no test harness in this codebase unit-tests inline page Server Actions — see Task 2's note.)
- **A voided row's quantity must still be visually struck through in whichever of the two new columns it occupies**, not lost when Type+Qty collapse into IN/OUT. (Covered by Task 3's new voided-row test.)
- **Today itself must be selectable** (not just dates strictly before it) — an off-by-one here would block the single most common case (recording today's stock). (Covered by Task 2's `isFutureDate` test: today is false.)
- **Sorting by amount must survive the Type+Qty merge** — a naive refactor could drop the "qty" sort key entirely instead of renaming/sharing it. (Covered by Task 3's rewritten sort tests, which assert on amount-column content after a date-sort toggle, implicitly proving the accessor still exists and still works.)
- **A row where quantity happens to be a value that's falsy-ish in JS when miscoded (e.g. a bug rendering `0` as blank via `||` instead of a type check)** — not a real data case here (quantities are always `> 0`, enforced elsewhere), but the implementation must branch on `m.type`, not on `m.quantity`'s truthiness, so the blank-other-column logic can't ever hide a non-zero value. (Covered by Task 3's IN/OUT split test, which asserts the *other* column is empty, not just that the populated one is correct.)

---

## Task 1: `isFutureDate` in `lib/date.ts`

**Files:**
- Modify: `lib/date.ts`
- Test: `tests/lib/date.test.ts`

**Interfaces:**
- Consumes: `manilaToday` (already in this file, used as the default for `today`).
- Produces: `isFutureDate(dateStr: string, today?: string): boolean` — Task 2 imports and calls this from both stock forms.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/date.test.ts` (extend the existing `import { manilaToday, manilaTime, SHOP_TIME_ZONE } from "@/lib/date";` to add `isFutureDate`):

```ts
test("isFutureDate is true for a date after today", () => {
  expect(isFutureDate("2026-11-24", "2026-11-23")).toBe(true);
});

test("isFutureDate is false for today itself", () => {
  expect(isFutureDate("2026-11-23", "2026-11-23")).toBe(false);
});

test("isFutureDate is false for a date before today", () => {
  expect(isFutureDate("2026-11-22", "2026-11-23")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/date.test.ts -t "isFutureDate"`
Expected: FAIL — `isFutureDate is not a function` / not exported.

- [ ] **Step 3: Implement `isFutureDate(dateStr: string, today: string = manilaToday()): boolean` in `lib/date.ts`**

Plain string comparison (`dateStr > today`) — both are `YYYY-MM-DD`, which sorts lexicographically the same as chronologically. Place after `manilaToday`, before `manilaTime`. One line on why `today` defaults to `manilaToday()` rather than being required: production callers (Task 2) call it with just the date they're validating; tests pin `today` explicitly instead of relying on the real clock, the same pattern `manilaToday`'s own `now` parameter already uses.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/date.test.ts`
Expected: PASS (11 tests — 8 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add lib/date.ts tests/lib/date.test.ts
git commit -m "feat: add isFutureDate to lib/date.ts"
```

---

## Task 2: Future-date guard on both stock forms

**Files:**
- Modify: `app/(dashboard)/items/[id]/stock-in-form.tsx`
- Modify: `app/(dashboard)/items/[id]/stock-out-form.tsx`
- Modify: `app/(dashboard)/items/[id]/page.tsx`

**Interfaces:**
- Consumes: `isFutureDate` (Task 1).
- Produces: nothing a later task imports — this task's deliverable is the end-to-end behavior itself, verified manually (see Step 2's note).

**Note on testing this task:** this codebase has no precedent for unit-testing an inline page-level Server Action directly (`addStockIn`/`addStockOut` are plain unexported functions with a `"use server"` directive, not exported for import, and no existing test file attempts it for any of this page's other validation branches like `invalid-qty`/`invalid-cost` either). The real decision logic (`isFutureDate`) is fully unit-tested in Task 1; this task is wiring it into two redirect call sites plus one `<input>` attribute plus one error-message map entry, all a few lines each. Verify by hand per Step 2 below, and actually run it — don't just write the step and move on.

- [ ] **Step 1: Wire the guard into `stock-in-form.tsx`**

In the `addStockIn` Server Action, after the existing `if (!batchDate || !Number.isFinite(qty) || qty <= 0) { redirect(...) }` check and before the `unitCost` check, add:

```ts
if (isFutureDate(batchDate)) {
  redirect(`/items/${itemId}?inError=future-date`);
}
```

Add `isFutureDate` to the existing `import { manilaToday } from "@/lib/date";` line. On the `<Input id="in-batchDate" type="date" ...>` element, add `max={today}` (the component already computes `const today = manilaToday()`).

- [ ] **Step 2: Wire the guard into `stock-out-form.tsx`**

In the `addStockOut` Server Action, after the existing `if (!movementDate || !Number.isFinite(qty) || qty <= 0) { redirect(...) }` check, add:

```ts
if (isFutureDate(movementDate)) {
  redirect(`/items/${itemId}?outError=future-date`);
}
```

Same import addition as Step 1. On the `<Input id="out-movementDate" type="date" ...>` element, add `max={today}`.

- [ ] **Step 3: Add the error message**

In `app/(dashboard)/items/[id]/page.tsx`, add to `STOCK_ERROR_MESSAGES`:

```ts
"future-date": "Date can't be in the future.",
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification (run it, don't just plan it)**

Run `npm run dev` (reuse a running instance if one already is), open any item's detail page signed in, and for **both** the stock-IN and stock-OUT forms:
1. Confirm the date picker's native UI refuses to open on a date after today (the `max` attribute).
2. Submit the form with a future date by editing the `<input>`'s value via devtools or typing past the picker's block, to prove the server-side check independently catches it — confirm the page reloads with "Date can't be in the future." shown inline (via `inError`/`outError`).
3. Confirm today's date and a past date both still submit normally.

Record the actual result of this check (not "should work") before moving to Step 6.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/items/[id]/stock-in-form.tsx" "app/(dashboard)/items/[id]/stock-out-form.tsx" "app/(dashboard)/items/[id]/page.tsx"
git commit -m "feat: reject a future date on both stock forms, client and server"
```

---

## Task 3: Movement History IN/OUT ledger columns

**Files:**
- Modify: `app/(dashboard)/items/[id]/movements-list.tsx`
- Test: `tests/components/movements-list.test.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (independent change).
- Produces: nothing a later task relies on.

- [ ] **Step 1: Rewrite the failing/changed tests**

In `tests/components/movements-list.test.tsx`, replace the `typeColumn()` helper and the two tests that use it, and add one new test. Add `within` to the existing `import { render, screen, fireEvent, act } from "@testing-library/react";` line.

```tsx
function rowAmounts() {
  return screen.getAllByRole("row").slice(1).map((row) => {
    const cells = within(row).getAllByRole("cell");
    return { in: cells[1].textContent ?? "", out: cells[2].textContent ?? "" };
  });
}

test("defaults to Date descending, keeping same-day rows in reverse time order", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  // id 2 (OUT, qty 2, created 14:00) is newer than id 1 (IN, qty 5, created 08:00) on the same movement_date.
  expect(rowAmounts()[0]).toEqual({ in: "", out: "2" });
  expect(rowAmounts()[1]).toEqual({ in: "5", out: "" });
});

test("toggling Date to ascending reverses same-day rows by time, not arbitrarily", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^date$/i }));
  expect(rowAmounts()[0]).toEqual({ in: "5", out: "" });
  expect(rowAmounts()[1]).toEqual({ in: "", out: "2" });
});

test("a voided row shows its quantity struck through in the populated column, and the other column stays blank", () => {
  const voidedMovements: MovementRow[] = [
    {
      id: "3",
      type: "IN",
      quantity: 7,
      movementDate: "2026-02-01",
      note: null,
      voidedAt: "2026-02-02T00:00:00Z",
      createdAt: "2026-02-01T08:00:00Z",
    },
  ];
  render(<MovementsList movements={voidedMovements} voidAction={vi.fn()} />);
  const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
  expect(cells[1]).toHaveTextContent("7");
  expect(cells[1].className).toContain("line-through");
  expect(cells[2]).toHaveTextContent("");
});
```

The existing third test (`"search debounces before re-filtering"`) is unaffected — leave it as-is.

- [ ] **Step 2: Run tests to verify the changed/new ones fail**

Run: `npx vitest run tests/components/movements-list.test.tsx`
Expected: FAIL — the rewritten sort tests fail because the current table has no column at cell index 2 carrying an OUT-only value (today's layout is Date/Type/Qty/Note/Status/Action, so `cells[1]` is "Type" text and `cells[2]` is the merged Qty, not an OUT-only value); the new voided-row test fails the same way.

- [ ] **Step 3: Implement the column swap in `movements-list.tsx`**

Replace the `sortAccessors` object's `"type" | "qty"` keys with a single `"amount"` key (same accessor the old `"qty"` key used: `(row) => row.quantity`), keeping `"date" | "note" | "status"` unchanged:

```ts
const sortAccessors: Record<
  "date" | "amount" | "note" | "status",
  (row: MovementRow) => string | number
> = {
  date: (row) => `${row.movementDate}_${row.createdAt}`,
  amount: (row) => row.quantity,
  note: (row) => row.note ?? "",
  status: (row) => (row.voidedAt ? 1 : 0),
};
```

Update `useSortableData`'s type parameter and `defaultKey` reference accordingly (still `"date"`).

In the `<thead>`, replace the "Type" and "Qty" `SortButtonHeader`s with two headers both driving the same `"amount"` key:

```tsx
<SortButtonHeader
  label="IN"
  thClassName="py-1 pr-3"
  direction={sortKey === "amount" ? direction : "none"}
  onClick={() => toggle("amount")}
/>
<SortButtonHeader
  label="OUT"
  thClassName="py-1 pr-3"
  direction={sortKey === "amount" ? direction : "none"}
  onClick={() => toggle("amount")}
/>
```

In `<tbody>`, replace the old `<td>{m.type}</td><td>{m.quantity}</td>` pair with:

```tsx
<td className={`py-1 pr-3 ${voided ? "line-through" : ""}`}>
  {m.type === "IN" ? m.quantity : ""}
</td>
<td className={`py-1 pr-3 ${voided ? "line-through" : ""}`}>
  {m.type === "OUT" ? m.quantity : ""}
</td>
```

In the mobile card view, replace the existing `<span className="font-medium">{m.type} · {m.quantity}</span>` + date span with a three-slot row (IN left, date middle, OUT right):

```tsx
<div className={`flex items-center justify-between gap-2 ${voided ? "line-through" : ""}`}>
  <span className="font-medium">{m.type === "IN" ? m.quantity : ""}</span>
  <span className="text-xs text-muted-foreground">{m.movementDate}</span>
  <span className="font-medium">{m.type === "OUT" ? m.quantity : ""}</span>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/movements-list.test.tsx`
Expected: PASS (4 tests — 3 rewritten/kept + 1 new)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open an item with at least one IN and one OUT movement, and confirm: IN quantities appear on the left, OUT on the right, both columns' headers say "IN"/"OUT", clicking either sorts by amount, and a voided row's quantity is struck through in its column with the other column blank. Check both desktop (table) and a narrow viewport (mobile card) layout. Record the actual result before moving to Step 7.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/items/[id]/movements-list.tsx" tests/components/movements-list.test.tsx
git commit -m "feat: split Movement History into IN/OUT ledger columns"
```
