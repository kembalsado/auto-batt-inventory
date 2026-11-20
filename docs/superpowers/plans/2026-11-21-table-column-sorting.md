# Column Sorting (+ Search Debounce) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every data table in the app (Items, Batches, Movements, Stock
List, Users, Reports, Activity) gets clickable ascending/descending sort
on every real column, and the five tables with a search box debounce
their filtering so typing doesn't recompute on every keystroke.

**Architecture:** Two small shared client hooks
(`useSortableData`, `useDebouncedValue`) and one shared presentational
header component (`SortButtonHeader`/`SortLinkHeader`/`SortIcon`) get
wired into each of the 7 table files. Six tables (Items, Batches,
Movements, Stock List, Users, Reports) sort fully-loaded arrays in
memory via the button-header + hook combo. Activity is different on
purpose — it stays server-rendered with zero client JS, so its sort
lives in the URL (`?sort=&dir=`) and is applied with a plain
`Array.prototype.sort()` inside the Server Component, reusing the
link-header variant.

**Tech Stack:** Next.js 16 (App Router) + React 19, TypeScript, Tailwind
v4, lucide-react icons, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-21-table-column-sorting-design.md`

## Global Constraints

- Click toggles ascending ↔ descending only — no third "unsorted" state;
  clicking a column that isn't active switches to it ascending.
- `aria-sort="ascending"|"descending"` on the active column's `<th>`;
  the attribute is omitted (not set to `"none"`) on every other column.
- Debounce delay is 200ms, trailing (resets on every keystroke).
- While a debounced table's raw query differs from its debounced query,
  the table and its mobile card list both get `opacity-60
  transition-opacity` appended to their existing `className` — no
  skeleton, no wrapper element, no layout shift.
- Reuse the app's existing focus-visible classes verbatim on every new
  interactive header: `focus-visible:border-ring focus-visible:ring-3
  focus-visible:ring-ring/50`.
- lucide-react icons only: `ArrowUp`, `ArrowDown`, `ArrowUpDown`. No new
  dependency (no table/data-grid library).
- Activity gets no client JS and no new network round trips beyond the
  page navigation its existing filter form already does the same way.
- The six in-memory tables sort with zero extra network requests.
- Every new/changed sortable table's **default** display order must be
  unchanged from today until a user clicks a header.

## Review Focus

- Movements: two rows sharing the same `movementDate` must keep their
  relative time order (by `created_at`) both ascending and descending —
  `movement_date` has no time component, so a naive single-field sort
  would make same-day ordering arbitrary. (Task 6)
- Reports' Month-view day labels are the strings `"1"`.."31"` — sorting
  by the label text directly would put `"10"` before `"2"`. The label
  column must sort by the row's original position, not its text. (Task 9)
- Batches'/Stock List's optional cost columns (`unit_cost`/`unitCost`,
  `inventoryValue`) are `undefined` on some rows — sorting must not
  throw or produce `NaN`-driven ordering; undefined values need a
  defined fallback so they land predictably at one end. (Tasks 5, 7)
- Activity's "User" column must sort by the resolved display name
  (including the "System" / "Unknown (id)" fallbacks for a null or
  unmatched `actorId`), not the raw `actorId` — the two can disagree
  (e.g. two unnamed actors with different ids both render "Unknown
  (...)", or a named actor sorts by name while `actorId` is a UUID).
  (Task 10)
- Debounced search must actually reset its timer on every keystroke, not
  just delay the first one — typing a full word quickly must produce
  exactly one recompute at the end, not one per keystroke after the
  first 200ms. (Task 2, exercised again in Task 4)

---

## Task 1: `useSortableData` hook

**Files:**
- Create: `lib/use-sortable-data.ts`
- Test: `tests/lib/use-sortable-data.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SortDirection = "asc" | "desc";

  export interface UseSortableDataConfig<Row, Key extends string> {
    accessors: Record<Key, (row: Row, index: number) => string | number>;
    defaultKey: Key;
    defaultDirection?: SortDirection; // defaults to "asc"
  }

  export interface UseSortableDataResult<Row, Key extends string> {
    sorted: Row[];
    sortKey: Key;
    direction: SortDirection;
    toggle: (key: Key) => void;
  }

  export function useSortableData<Row, Key extends string>(
    rows: Row[],
    config: UseSortableDataConfig<Row, Key>
  ): UseSortableDataResult<Row, Key>;
  ```
  `accessors` receives each row's index in the *input* `rows` array (not
  the sorted output) — this is what lets a caller sort by original
  position (Task 9's Reports label column) instead of by a row's own
  field.

- [ ] **Step 1: Write the failing tests**

```ts
import { renderHook, act } from "@testing-library/react";
import { useSortableData } from "@/lib/use-sortable-data";

test("sorts rows ascending by the default key", () => {
  const rows = [{ name: "Charlie" }, { name: "Alice" }, { name: "Bob" }];
  const { result } = renderHook(() =>
    useSortableData(rows, { accessors: { name: (r) => r.name }, defaultKey: "name" })
  );
  expect(result.current.sorted.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  expect(result.current.direction).toBe("asc");
});

test("toggling the active key flips direction", () => {
  const rows = [{ name: "Charlie" }, { name: "Alice" }, { name: "Bob" }];
  const { result } = renderHook(() =>
    useSortableData(rows, { accessors: { name: (r) => r.name }, defaultKey: "name" })
  );
  act(() => result.current.toggle("name"));
  expect(result.current.direction).toBe("desc");
  expect(result.current.sorted.map((r) => r.name)).toEqual(["Charlie", "Bob", "Alice"]);
  act(() => result.current.toggle("name"));
  expect(result.current.direction).toBe("asc");
});

test("toggling a different key switches to that key ascending", () => {
  const rows = [{ name: "Bob", age: 30 }, { name: "Alice", age: 20 }];
  const { result } = renderHook(() =>
    useSortableData(rows, {
      accessors: { name: (r) => r.name, age: (r) => r.age },
      defaultKey: "name",
    })
  );
  act(() => result.current.toggle("age"));
  expect(result.current.sortKey).toBe("age");
  expect(result.current.direction).toBe("asc");
  expect(result.current.sorted.map((r) => r.age)).toEqual([20, 30]);
});

test("accessor receives the row's original index, for position-based sorting", () => {
  const rows = [{ label: "10" }, { label: "2" }];
  const { result } = renderHook(() =>
    useSortableData(rows, {
      accessors: { position: (_row, index) => index },
      defaultKey: "position",
    })
  );
  expect(result.current.sorted.map((r) => r.label)).toEqual(["10", "2"]);
  act(() => result.current.toggle("position"));
  expect(result.current.sorted.map((r) => r.label)).toEqual(["2", "10"]);
});

test("does not mutate the input array", () => {
  const rows = [{ name: "Charlie" }, { name: "Alice" }];
  const { result } = renderHook(() =>
    useSortableData(rows, { accessors: { name: (r) => r.name }, defaultKey: "name" })
  );
  expect(result.current.sorted).not.toBe(rows);
  expect(rows.map((r) => r.name)).toEqual(["Charlie", "Alice"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/use-sortable-data.test.ts`
Expected: FAIL — `useSortableData` not defined / module not found.

- [ ] **Step 3: Implement `useSortableData` in `lib/use-sortable-data.ts`**

`"use client"` at the top. Internal `useState` holds `{ sortKey, direction }`,
initialized from `config.defaultKey`/`config.defaultDirection ?? "asc"`.
`sorted` is computed with `useMemo` (deps: `rows`, `sortKey`, `direction`,
`config.accessors`): copy `rows` into a new array, sort with a comparator
that calls `accessors[sortKey](row, originalIndex)` for both sides
(capture original index via `rows.map((row, index) => ({ row, index }))`
before copying, so `.sort()`'s own in-place reordering doesn't corrupt
which index belongs to which row), compares numbers with subtraction and
strings with `localeCompare`, and negates the result when
`direction === "desc"`. `toggle(key)` flips `direction` when `key ===
sortKey`, otherwise sets `sortKey = key` and `direction = "asc"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/use-sortable-data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/use-sortable-data.ts tests/lib/use-sortable-data.test.ts
git commit -m "feat: add useSortableData hook for in-memory table sorting"
```

---

## Task 2: `useDebouncedValue` hook

**Files:**
- Create: `lib/use-debounced-value.ts`
- Test: `tests/lib/use-debounced-value.test.ts`

**Interfaces:**
- Produces: `export function useDebouncedValue<T>(value: T, delayMs?: number): T`
  (`delayMs` defaults to `200`, per Global Constraints).

- [ ] **Step 1: Write the failing tests**

```ts
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "@/lib/use-debounced-value";

test("returns the initial value immediately", () => {
  const { result } = renderHook(() => useDebouncedValue("a"));
  expect(result.current).toBe("a");
});

test("does not update until delayMs has passed with no further changes", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ value }) => useDebouncedValue(value, 200),
    { initialProps: { value: "a" } }
  );
  rerender({ value: "ab" });
  expect(result.current).toBe("a");
  act(() => vi.advanceTimersByTime(199));
  expect(result.current).toBe("a");
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe("ab");
  vi.useRealTimers();
});

test("resets the timer on every change within the delay window", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ value }) => useDebouncedValue(value, 200),
    { initialProps: { value: "a" } }
  );
  rerender({ value: "ab" });
  act(() => vi.advanceTimersByTime(150));
  rerender({ value: "abc" });
  act(() => vi.advanceTimersByTime(150));
  expect(result.current).toBe("a");
  act(() => vi.advanceTimersByTime(50));
  expect(result.current).toBe("abc");
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/use-debounced-value.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useDebouncedValue` in `lib/use-debounced-value.ts`**

`"use client"` at the top. `useState` seeded with `value`; `useEffect`
(deps: `value`, `delayMs`) sets a `setTimeout(() =>
setDebounced(value), delayMs)` and returns a cleanup that clears it —
the standard trailing-debounce pattern, so a change inside the delay
window cancels the pending update and restarts the clock.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/use-debounced-value.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/use-debounced-value.ts tests/lib/use-debounced-value.test.ts
git commit -m "feat: add useDebouncedValue hook"
```

---

## Task 3: Shared sortable header components

**Files:**
- Create: `components/sortable-header.tsx`
- Test: `tests/components/sortable-header.test.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (pure presentation).
- Produces:
  ```ts
  export function SortIcon(props: { direction: "asc" | "desc" | "none" }): JSX.Element;

  export function SortButtonHeader(props: {
    label: string;
    direction: "asc" | "desc" | "none";
    onClick: () => void;
    thClassName?: string;
  }): JSX.Element;

  export function SortLinkHeader(props: {
    label: string;
    direction: "asc" | "desc" | "none";
    href: string;
    thClassName?: string;
  }): JSX.Element;
  ```
  Both header components render the full `<th>` (with `aria-sort` set
  when `direction !== "none"`, omitted otherwise) — callers pass their
  table's existing header-cell classes via `thClassName` rather than
  wrapping the result in another `<th>`. `SortButtonHeader` renders a
  real `<button type="button">`; `SortLinkHeader` renders a `next/link`
  `<Link>`. Both show `{label}` then `<SortIcon direction={direction} />`
  and carry
  `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { SortIcon, SortButtonHeader, SortLinkHeader } from "@/components/sortable-header";

test("SortIcon renders the up arrow when ascending", () => {
  const { container } = render(<SortIcon direction="asc" />);
  expect(container.querySelector("svg")?.getAttribute("class")).toContain("arrow-up");
});

test("SortIcon renders the down arrow when descending", () => {
  const { container } = render(<SortIcon direction="desc" />);
  expect(container.querySelector("svg")?.getAttribute("class")).toContain("arrow-down");
});

test("SortIcon renders the up-down arrow when not sorted by this column", () => {
  const { container } = render(<SortIcon direction="none" />);
  expect(container.querySelector("svg")?.getAttribute("class")).toContain("arrow-up-down");
});

test("SortButtonHeader sets aria-sort=\"ascending\" and calls onClick when clicked", () => {
  const onClick = vi.fn();
  render(
    <table><thead><tr>
      <SortButtonHeader label="Name" direction="asc" onClick={onClick} />
    </tr></thead></table>
  );
  expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute(
    "aria-sort",
    "ascending"
  );
  fireEvent.click(screen.getByRole("button", { name: /name/i }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("SortButtonHeader omits aria-sort when direction is \"none\"", () => {
  render(
    <table><thead><tr>
      <SortButtonHeader label="Name" direction="none" onClick={() => {}} />
    </tr></thead></table>
  );
  expect(screen.getByRole("columnheader")).not.toHaveAttribute("aria-sort");
});

test("SortLinkHeader renders a link with the given href and aria-sort=\"descending\"", () => {
  render(
    <table><thead><tr>
      <SortLinkHeader label="Date" direction="desc" href="/activity?sort=date&dir=desc" />
    </tr></thead></table>
  );
  expect(screen.getByRole("link", { name: /date/i })).toHaveAttribute(
    "href",
    "/activity?sort=date&dir=desc"
  );
  expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/sortable-header.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/sortable-header.tsx`**

No `"use client"` directive needed at the module level — `SortLinkHeader`
has no hooks, and `SortButtonHeader`'s `onClick` prop works from a client
parent without the component itself needing the directive (it's only
required for files using hooks/browser APIs directly). Map
`direction` to the ARIA value with `direction === "asc" ? "ascending" :
direction === "desc" ? "descending" : undefined`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/sortable-header.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/sortable-header.tsx tests/components/sortable-header.test.tsx
git commit -m "feat: add shared SortButtonHeader/SortLinkHeader/SortIcon components"
```

---

## Task 4: Items table — sort + debounce

**Files:**
- Modify: `app/(dashboard)/items/items-table.tsx`
- Test: `tests/components/items-table.test.tsx`

**Interfaces:**
- Consumes: `useSortableData` (Task 1), `useDebouncedValue` (Task 2),
  `SortButtonHeader` (Task 3).
- `StockListRow` (unchanged, from `@/lib/stock-list`): `{ id, sku, name,
  category, qtyOnHand, unit, isLowStock, isActive, vehicle }`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ItemsTable } from "@/app/(dashboard)/items/items-table";
import type { StockListRow } from "@/lib/stock-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const rows: StockListRow[] = [
  { id: "1", sku: "B", name: "Charlie Battery", category: "Cat", qtyOnHand: 5, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—" },
  { id: "2", sku: "A", name: "Alice Battery", category: "Cat", qtyOnHand: 20, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—" },
  { id: "3", sku: "C", name: "Bob Battery", category: "Cat", qtyOnHand: 1, unit: "pcs", isLowStock: true, isActive: true, vehicle: "—" },
];

function nameColumn() {
  return screen.getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
}

test("defaults to Name ascending, matching today's query order", () => {
  render(<ItemsTable rows={rows} />);
  const names = nameColumn();
  expect(names[0]).toContain("Alice");
  expect(names[2]).toContain("Charlie");
});

test("clicking Qty on hand sorts ascending, clicking again sorts descending", () => {
  render(<ItemsTable rows={rows} />);
  fireEvent.click(screen.getByRole("button", { name: /qty on hand/i }));
  expect(nameColumn()[0]).toContain("Bob"); // qty 1
  fireEvent.click(screen.getByRole("button", { name: /qty on hand/i }));
  expect(nameColumn()[0]).toContain("Alice"); // qty 20
});

test("search filtering waits for the debounce delay, and dims the table meanwhile", () => {
  vi.useFakeTimers();
  render(<ItemsTable rows={rows} />);
  fireEvent.change(screen.getByLabelText(/search items/i), { target: { value: "alice" } });
  expect(nameColumn()).toHaveLength(3); // not filtered yet
  expect(screen.getByRole("table")).toHaveClass("opacity-60");
  act(() => vi.advanceTimersByTime(200));
  expect(nameColumn()).toHaveLength(1);
  expect(screen.getByRole("table")).not.toHaveClass("opacity-60");
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/items-table.test.tsx`
Expected: FAIL (no sort buttons/debounce exist yet).

- [ ] **Step 3: Wire sort + debounce into `items-table.tsx`**

- `const debouncedQuery = useDebouncedValue(query, 200);` — `filteredRows`'s
  `useMemo` depends on `debouncedQuery` instead of `query`.
- `const isPending = query !== debouncedQuery;`
- `const { sorted, direction, sortKey, toggle } = useSortableData(filteredRows, { accessors: { sku: (r) => r.sku, name: (r) => r.name, category: (r) => r.category, vehicle: (r) => r.vehicle, unit: (r) => r.unit, qtyOnHand: (r) => r.qtyOnHand }, defaultKey: "name" });`
  (matches `lib/stock-list.ts:136`'s/`lib/items.ts:127`'s existing `name`
  ascending order).
- Replace the 6 static `<th>` cells with `<SortButtonHeader>`, each
  `thClassName="py-2 font-medium"` (the table's existing header class),
  `direction={sortKey === "<col>" ? direction : "none"}`,
  `onClick={() => toggle("<col>")}`.
- Both the `<table>` and the `.map(filteredRows...)` calls (desktop table
  body + mobile card list) switch to iterating `sorted` instead of
  `filteredRows`.
- Append `` `${isPending ? " opacity-60 transition-opacity" : ""}` `` to
  the existing `<table className="...">` and mobile-card `<div
  className="...">` strings.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/items-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/items/items-table.tsx tests/components/items-table.test.tsx
git commit -m "feat: add sort and debounced search to Items table"
```

---

## Task 5: Batches table — sort + debounce

**Files:**
- Modify: `app/(dashboard)/items/[id]/batches-table.tsx`
- Test: `tests/components/batches-table.test.tsx`

**Interfaces:**
- Consumes: `useSortableData`, `useDebouncedValue`, `SortButtonHeader`
  (Tasks 1–3).
- `BatchRow` (unchanged): `{ id, batch_date, qty_received, qty_remaining,
  unit_cost?, source }`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BatchesTable, type BatchRow } from "@/app/(dashboard)/items/[id]/batches-table";

const batches: BatchRow[] = [
  { id: "1", batch_date: "2026-02-01", qty_received: 10, qty_remaining: 4, unit_cost: 500, source: "purchase" },
  { id: "2", batch_date: "2026-01-01", qty_received: 5, qty_remaining: 5, source: "opening_stock" },
];

test("defaults to Date ascending, matching today's query order", () => {
  render(<BatchesTable batches={batches} />);
  const dates = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(dates[0]).toContain("2026-01-01");
});

test("clicking Unit cost sorts rows with no cost predictably to one end", () => {
  render(<BatchesTable batches={batches} />);
  fireEvent.click(screen.getByRole("button", { name: /unit cost/i }));
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2); // no crash on the undefined unit_cost row
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<BatchesTable batches={batches} />);
  fireEvent.change(screen.getByLabelText(/search batches/i), { target: { value: "purchase" } });
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2, unchanged yet
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2); // header + 1
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/batches-table.test.tsx`

- [ ] **Step 3: Wire sort + debounce into `batches-table.tsx`**

Same pattern as Task 4. Accessors: `date: (r) => r.batch_date, received:
(r) => r.qty_received, remaining: (r) => r.qty_remaining, cost: (r) =>
r.unit_cost ?? -1, source: (r) => r.source`. `defaultKey: "date"` (matches
`lib/stock-list.ts:162-163`'s `batch_date` ascending order). The cost
column (and its header) stays conditional on `showCost`, as today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/batches-table.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/items/[id]/batches-table.tsx" tests/components/batches-table.test.tsx
git commit -m "feat: add sort and debounced search to Batches table"
```

---

## Task 6: Movements table — thread `createdAt` + sort + debounce

**Files:**
- Modify: `app/(dashboard)/items/[id]/movements-list.tsx`
- Modify: `app/(dashboard)/items/[id]/page.tsx:180-187`
- Test: `tests/components/movements-list.test.tsx`

**Interfaces:**
- Consumes: `useSortableData`, `useDebouncedValue`, `SortButtonHeader`
  (Tasks 1–3).
- Produces (changed): `MovementRow` gains a `createdAt: string` field:
  ```ts
  export interface MovementRow {
    id: string;
    type: "IN" | "OUT";
    quantity: number;
    movementDate: string;
    note: string | null;
    voidedAt: string | null;
    createdAt: string; // new
  }
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MovementsList, type MovementRow } from "@/app/(dashboard)/items/[id]/movements-list";

const movements: MovementRow[] = [
  { id: "1", type: "IN", quantity: 5, movementDate: "2026-01-01", note: null, voidedAt: null, createdAt: "2026-01-01T08:00:00Z" },
  { id: "2", type: "OUT", quantity: 2, movementDate: "2026-01-01", note: null, voidedAt: null, createdAt: "2026-01-01T14:00:00Z" },
];

function typeColumn() {
  return screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
}

test("defaults to Date descending, keeping same-day rows in reverse time order", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  // id 2 (created 14:00) is newer than id 1 (created 08:00) on the same movement_date.
  expect(typeColumn()[0]).toContain("OUT");
  expect(typeColumn()[1]).toContain("IN");
});

test("toggling Date to ascending reverses same-day rows by time, not arbitrarily", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^date$/i }));
  expect(typeColumn()[0]).toContain("IN");
  expect(typeColumn()[1]).toContain("OUT");
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/search movement history/i), {
    target: { value: "out" },
  });
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2, unchanged yet
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2); // header + 1
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/movements-list.test.tsx`

- [ ] **Step 3: Add `createdAt` to `MovementRow` and thread it through `page.tsx`**

In `app/(dashboard)/items/[id]/page.tsx:180-187`, add `createdAt:
m.createdAt,` to the object literal mapped from `summary.movements`
(`StockMovement.createdAt` already exists per `lib/stock.ts:11-22`/`101-104`).

- [ ] **Step 4: Wire sort + debounce into `movements-list.tsx`**

Accessors: `` date: (r) => `${r.movementDate}_${r.createdAt}` `` (fixed-
width `YYYY-MM-DD` prefix makes this a correct composite sort key via
plain string comparison — `movementDate` decides first, `createdAt`
breaks ties), `type: (r) => r.type`, `qty: (r) => r.quantity`, `note: (r)
=> r.note ?? ""`, `status: (r) => (r.voidedAt ? 1 : 0)`. `defaultKey:
"date"`, `defaultDirection: "desc"` (matches `lib/stock.ts:101-104`'s
`movement_date desc, created_at desc`). Same debounce/dim wiring as
Task 4. The blank Void-action `<th>` stays a plain `<th />`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/movements-list.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/items/[id]/movements-list.tsx" "app/(dashboard)/items/[id]/page.tsx" tests/components/movements-list.test.tsx
git commit -m "feat: add sort and debounced search to Movements list, carrying createdAt for same-day ordering"
```

---

## Task 7: Stock List table — sort + debounce

**Files:**
- Modify: `app/(dashboard)/stock-list/stock-list-table.tsx`
- Test: `tests/components/stock-list-table.test.tsx`

**Interfaces:**
- Consumes: `useSortableData`, `useDebouncedValue`, `SortButtonHeader`
  (Tasks 1–3). `StockListRow` as in Task 4, plus optional `unitCost?:
  number` and `inventoryValue?: number`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { StockListTable } from "@/app/(dashboard)/stock-list/stock-list-table";
import type { StockListRow } from "@/lib/stock-list";

const rows: StockListRow[] = [
  { id: "1", sku: "B", name: "Charlie", category: "Cat", qtyOnHand: 5, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—", unitCost: 100, inventoryValue: 500 },
  { id: "2", sku: "A", name: "Alice", category: "Cat", qtyOnHand: 20, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—" },
];

test("defaults to Name ascending", () => {
  render(<StockListTable rows={rows} showCost />);
  const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(names[0]).toContain("Alice");
});

test("clicking Inventory value does not crash on a row with no cost", () => {
  render(<StockListTable rows={rows} showCost />);
  fireEvent.click(screen.getByRole("button", { name: /inventory value/i }));
  expect(screen.getAllByRole("row")).toHaveLength(3);
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<StockListTable rows={rows} showCost={false} />);
  fireEvent.change(screen.getByLabelText(/search stock list/i), { target: { value: "alice" } });
  expect(screen.getAllByRole("row")).toHaveLength(3);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/stock-list-table.test.tsx`

- [ ] **Step 3: Wire sort + debounce into `stock-list-table.tsx`**

Same pattern as Task 4. Accessors: `sku, name, category, vehicle,
qtyOnHand, unit` same as Items; plus, only relevant when `showCost`:
`cost: (r) => r.unitCost ?? -1`, `value: (r) => r.inventoryValue ?? -1`.
`defaultKey: "name"` (matches `lib/stock-list.ts:136`). The two cost
headers/columns stay conditional on `showCost`, as today. `print:hidden`
stays only on the search box; the debounce dim class applies to the
table/card list the same as Task 4 (it's harmless under print since the
search box — the only thing that can trigger it — is itself
`print:hidden`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/stock-list-table.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/stock-list/stock-list-table.tsx tests/components/stock-list-table.test.tsx
git commit -m "feat: add sort and debounced search to Stock List table"
```

---

## Task 8: Users table — sort + debounce

**Files:**
- Modify: `app/(dashboard)/users/users-table.tsx`
- Test: `tests/components/users-table.test.tsx`

**Interfaces:**
- Consumes: `useSortableData`, `useDebouncedValue`, `SortButtonHeader`
  (Tasks 1–3). `UserListItem` (unchanged): `{ id, email, fullName, role,
  isActive, createdAt }`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UsersTable } from "@/app/(dashboard)/users/users-table";
import type { UserListItem } from "@/lib/users";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const users: UserListItem[] = [
  { id: "1", email: "charlie@example.com", fullName: "Charlie", role: "assistant", isActive: true, createdAt: "2026-01-01" },
  { id: "2", email: "alice@example.com", fullName: "Alice", role: "owner", isActive: true, createdAt: "2026-01-02" },
  { id: "3", email: "nameless@example.com", fullName: null, role: "assistant", isActive: false, createdAt: "2026-01-03" },
];

test("defaults to Name ascending (no prior order to preserve, per design)", () => {
  render(<UsersTable users={users} currentUserId="1" />);
  const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(names[0]).toContain("Alice");
});

test("clicking Email sorts ascending by email", () => {
  render(<UsersTable users={users} currentUserId="1" />);
  fireEvent.click(screen.getByRole("button", { name: /email/i }));
  const emails = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(emails[0]).toContain("alice@example.com");
});

test("a null fullName does not crash Name sorting", () => {
  render(<UsersTable users={users} currentUserId="1" />);
  expect(screen.getAllByRole("row")).toHaveLength(4);
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<UsersTable users={users} currentUserId="1" />);
  fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: "alice" } });
  expect(screen.getAllByRole("row")).toHaveLength(4);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/users-table.test.tsx`

- [ ] **Step 3: Wire sort + debounce into `users-table.tsx`**

Same pattern as Task 4 (no mobile card list exists here — only the
`opacity-60` dim on the one `<table>`, and the `isPending` check still
guards the `useMemo`/`useSortableData` chain the same way). Accessors:
`name: (r) => r.fullName ?? "￿", email: (r) => r.email, role: (r) =>
r.role, status: (r) => (r.isActive ? 1 : 0)`. The `"￿"` fallback
sorts a blank name after every real name ascending (and before them
descending), rather than first ascending — matters here specifically
because a fresh owner-only user list can plausibly have a no-name row
and it shouldn't dominate the top of the default view. `defaultKey:
"name"` — no existing `.order()` to preserve (`lib/users.ts:102-106`), so
this is a free choice per the design doc, not a behavior change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/users-table.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/users/users-table.tsx tests/components/users-table.test.tsx
git commit -m "feat: add sort and debounced search to Users table"
```

---

## Task 9: Reports table — client-side sort (no debounce, no search box)

**Files:**
- Modify: `app/(dashboard)/reports/report-table.tsx`
- Test: `tests/components/report-table.test.tsx`

**Interfaces:**
- Consumes: `useSortableData`, `SortButtonHeader` (Tasks 1, 3) — no
  `useDebouncedValue` (this table has no search box).
- `ReportTableRow` (unchanged): `{ label, isCurrent?, purchases,
  stockOutValue, href? }`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportTable, type ReportTableRow } from "@/app/(dashboard)/reports/report-table";

// Mimics Month view: labels are day-of-month strings, already in
// chronological (index) order, where "10" would sort before "2" as text.
const rows: ReportTableRow[] = [
  { label: "2", purchases: 100, stockOutValue: 0 },
  { label: "10", purchases: 50, stockOutValue: 0 },
];

function labelColumn() {
  return screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
}

test("defaults to today's chronological order (index), not sorted by label text", () => {
  render(<ReportTable rows={rows} labelHeader="Day" />);
  expect(labelColumn()[0]).toContain("2");
  expect(labelColumn()[1]).toContain("10");
});

test("toggling the label header reverses chronological order, not string order", () => {
  render(<ReportTable rows={rows} labelHeader="Day" />);
  fireEvent.click(screen.getByRole("button", { name: /^day$/i }));
  expect(labelColumn()[0]).toContain("10");
  expect(labelColumn()[1]).toContain("2");
});

test("clicking Purchases sorts by purchase amount", () => {
  render(<ReportTable rows={rows} labelHeader="Day" />);
  fireEvent.click(screen.getByRole("button", { name: /purchases/i }));
  expect(labelColumn()[0]).toContain("10"); // purchases: 50
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/report-table.test.tsx`

- [ ] **Step 3: Convert `report-table.tsx` to a sortable client component**

Add `"use client"` as the first line. Add `const { sorted, sortKey,
direction, toggle } = useSortableData(rows, { accessors: { label: (_row,
index) => index, purchases: (r) => r.purchases, stockOutValue: (r) =>
r.stockOutValue }, defaultKey: "label" });` — the `label` accessor uses
`index`, never `row.label`, per Review Focus. Replace the 3 static
`<th>` cells with `<SortButtonHeader thClassName="py-2 font-medium" ...
/>`. The `.map(rows...)` call switches to `.map(sorted...)`. Nothing else
about each row's rendering (the `isCurrent`/`href`/`PendingLabel`/
`ChevronRight` branch) changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/report-table.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/reports/report-table.tsx tests/components/report-table.test.tsx
git commit -m "feat: add sort to Reports breakdown table"
```

---

## Task 10: Activity page — URL-param sort (server-rendered, no client JS)

**Files:**
- Modify: `lib/activity.ts`
- Modify: `app/(dashboard)/activity/page.tsx`
- Test: `tests/lib/activity-sort.test.ts` (new — pure unit tests, no
  Supabase/DB setup, unlike the existing `tests/lib/activity.test.ts`)

**Interfaces:**
- Produces (new exports from `lib/activity.ts`):
  ```ts
  export type AuditSortKey = "date" | "user" | "action" | "summary";
  export type AuditSortDirection = "asc" | "desc";

  export function actorLabel(
    actorId: string | null,
    namesById: Map<string, string | null>
  ): string;

  export function sortAuditLog(
    entries: AuditLogEntry[],
    actorNamesById: Map<string, string | null>,
    sortKey: AuditSortKey,
    direction: AuditSortDirection
  ): AuditLogEntry[];

  export function buildActivitySortHref(
    params: {
      itemId?: string;
      actorId?: string;
      action?: string;
      q?: string;
      sort?: string;
      dir?: string;
    },
    column: AuditSortKey
  ): string;
  ```
  `buildActivitySortHref` reads `params.sort`/`params.dir` (defaulting to
  `"date"`/`"desc"` when absent or invalid), computes the next state for
  `column` (flip direction if `column` is already active, else that
  column ascending — same toggle semantics as `useSortableData.toggle`),
  and returns `/activity?...` with every other truthy param in `params`
  preserved and `sort`/`dir` set to the next state.

- [ ] **Step 1: Write the failing tests**

```ts
import { actorLabel, sortAuditLog, buildActivitySortHref, type AuditLogEntry } from "@/lib/activity";

const names = new Map([["u1", "Alice"], ["u2", null]]);

test("actorLabel returns the profile's name when known", () => {
  expect(actorLabel("u1", names)).toBe("Alice");
});

test("actorLabel falls back to System for a null actor", () => {
  expect(actorLabel(null, names)).toBe("System");
});

test("actorLabel falls back to a truncated id for an unknown/unnamed actor", () => {
  expect(actorLabel("u2", names)).toBe("Unknown (u2)");
  expect(actorLabel("u-not-in-map", names)).toBe("Unknown (u-not-in)");
});

const entries: AuditLogEntry[] = [
  { id: "1", actorId: "u1", action: "item.created", entityType: "item", entityId: "x", summary: "B", details: null, createdAt: "2026-01-02T00:00:00Z" },
  { id: "2", actorId: "u2", action: "category.created", entityType: "category", entityId: "y", summary: "A", details: null, createdAt: "2026-01-01T00:00:00Z" },
];

test("sortAuditLog sorts by date ascending without mutating the input", () => {
  const sorted = sortAuditLog(entries, names, "date", "asc");
  expect(sorted.map((e) => e.id)).toEqual(["2", "1"]);
  expect(entries.map((e) => e.id)).toEqual(["1", "2"]);
});

test("sortAuditLog sorts by user using the resolved display name, not actorId", () => {
  // Input order is [u2 (actorLabel "Unknown (u2)"), u1 ("Alice")] — the
  // reverse of ascending-by-name order, so this only passes if the
  // comparator actually resolved and compared the display names.
  const reversed = [entries[1], entries[0]];
  const sorted = sortAuditLog(reversed, names, "user", "asc");
  expect(sorted.map((e) => e.id)).toEqual(["1", "2"]); // "Alice" before "Unknown (u2)"
});

test("sortAuditLog sorts by summary ascending", () => {
  // entries is [{id: "1", summary: "B"}, {id: "2", summary: "A"}] — already
  // the reverse of ascending order, so this only passes on a real sort.
  const sorted = sortAuditLog(entries, names, "summary", "asc");
  expect(sorted.map((e) => e.id)).toEqual(["2", "1"]); // "A" before "B"
});

test("buildActivitySortHref defaults to date desc, switches a clicked column to ascending", () => {
  expect(buildActivitySortHref({}, "user")).toBe("/activity?sort=user&dir=asc");
});

test("buildActivitySortHref flips direction when the column is already active", () => {
  expect(buildActivitySortHref({ sort: "user", dir: "asc" }, "user")).toBe(
    "/activity?sort=user&dir=desc"
  );
});

test("buildActivitySortHref preserves existing filters", () => {
  const href = buildActivitySortHref({ itemId: "item-1", q: "battery" }, "action");
  expect(href).toContain("itemId=item-1");
  expect(href).toContain("q=battery");
  expect(href).toContain("sort=action");
  expect(href).toContain("dir=asc");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/activity-sort.test.ts`

- [ ] **Step 3: Move `actorLabel` into `lib/activity.ts` and add `sortAuditLog`/`buildActivitySortHref`**

Move the existing `actorLabel` function body verbatim from
`app/(dashboard)/activity/page.tsx:50-58` into `lib/activity.ts`, exported.
`sortAuditLog` copies `entries` into a new array and sorts with a
comparator keyed on: `"date"` → `createdAt` (ISO strings compare
correctly lexicographically), `"user"` → `actorLabel(actorId,
actorNamesById)`, `"action"` → `action`, `"summary"` → `summary`, each via
`localeCompare`, negated when `direction === "desc"`. `buildActivitySortHref`
parses `params.sort` against `AuditSortKey`'s 4 values (defaulting to
`"date"` if missing/invalid) and `params.dir` against `"asc"|"desc"`
(defaulting to `"desc"`), computes the next `{sortKey, direction}` for
`column` using the toggle rule above, then builds the query string with
`URLSearchParams`, copying over `itemId`/`actorId`/`action`/`q` from
`params` only when truthy.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/activity-sort.test.ts`

- [ ] **Step 5: Wire `page.tsx` to use URL-param sort**

In `app/(dashboard)/activity/page.tsx`: delete the local `actorLabel`
function (now imported from `@/lib/activity`); add `sort`/`dir` to the
`searchParams` type and destructuring; after `actorNamesById` is built,
call `const sortedEntries = sortAuditLog(entries, actorNamesById,
validatedSortKey, validatedDirection)` (validate the same way
`buildActivitySortHref` does, or reuse its internal parsing — builder's
call per "Left to the builder" in the design doc) and `.map()` over
`sortedEntries` instead of `entries`. Replace the 4 static `<th>` cells
with `<SortLinkHeader thClassName="py-2 font-medium" label="..."
direction={...} href={buildActivitySortHref({ itemId, actorId, action, q,
sort, dir }, "<column>")} />`.

- [ ] **Step 6: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: all tests pass, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add lib/activity.ts "app/(dashboard)/activity/page.tsx" tests/lib/activity-sort.test.ts
git commit -m "feat: add URL-param sort to Activity log, server-rendered with no new client JS"
```
