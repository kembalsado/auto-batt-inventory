# Reports Per-Item Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reports' Day view gains an inline per-item list (item, qty in/out, cost in/out) and Month view's existing day-by-day table becomes drill-down-able (click a day to see that same per-item list in a modal) — Year view and the Calendar page are untouched.

**Architecture:** One new data function (`getItemActivityByDate`, `lib/reports.ts`) extends the existing two-step cost-computation pattern (`getPurchasesByDate`/`getStockOutValueByDate`) by carrying `item_id` through the grouping instead of collapsing straight to a date total. One new presentational component (`ItemActivityList`) renders the resulting rows; Day view embeds it inline, Month view embeds it in a modal reached via a `date` query param, mirroring Calendar's own URL-driven modal exactly.

**Tech Stack:** Next.js 16 App Router (server components, URL-driven state, no new client JS), Supabase/PostgREST, Vitest + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-11-20-reports-per-item-drilldown-design.md`

## Global Constraints

- The per-item list/modal must only ever render where the page has already confirmed `canSeeCost(role, settings)` — no new permission surface.
- The per-item list does **not** filter by `is_active` — it must sum to the same totals as the Purchases/Stock-out-value tiles already on the page, which never filter by `is_active` either.
- List inclusion is "had any non-voided IN or OUT movement that day," not "cost > 0" — an opening-stock import (cost 0 by design) still appears.
- Month view's day-by-day table keeps its current visual shape; every day becomes a link (not just days with nonzero cost), consistent with the inclusion rule above.
- No changes to `app/(dashboard)/calendar/*`, `lib/calendar.ts`, `lib/email/dailySummary.ts`, or Year view.

## Review Focus

- An item deactivated after it moved stock must still appear in the per-item list for the day it moved (no `is_active` filter) — covered in Task 1.
- A day whose only movement is a zero-cost opening-stock import must still be a clickable Month-table link and must still list that item with `costIn: 0` — covered in Task 1 (function) and Task 4 (link always present).
- A voided movement must contribute zero qty and zero cost to any item it would otherwise touch — covered in Task 1.
- An item with both an IN and an OUT movement on the same date must report correct, independent `qtyIn`/`costIn` and `qtyOut`/`costOut` — covered in Task 1.
- Cost must never leak to a viewer without `canSeeCost` through the new Day-view list or Month-view modal, same as it already can't through the stat tiles — covered in Task 3.

---

## Task 1: `getItemActivityByDate` data function

**Files:**
- Modify: `lib/reports.ts`
- Test: `tests/lib/reports.test.ts`

**Interfaces:**
- Consumes: `fetchAllPages`/`fetchAllForIds`/`chunk` (internal to `lib/reports.ts`, already defined) — **not required here**: this function queries a single date, not a range, so it follows `lib/email/dailySummary.ts`'s `buildDailySummary` precedent of one unpaged query per table instead (a single day's row count doesn't approach PostgREST's 1000-row cap at this app's scale).
- Produces:
  ```ts
  export interface ItemActivity {
    itemId: string;
    sku: string;
    name: string;
    vehicle: string; // [makeName, model, variant, year].filter(Boolean).join(" ") || "—"
    unit: string;
    qtyIn: number;
    qtyOut: number;
    costIn: number;
    costOut: number;
  }

  export async function getItemActivityByDate(
    supabase: SupabaseClient,
    adminSupabase: SupabaseClient,
    date: string
  ): Promise<ItemActivity[]>
  ```
  Sorted by `name` (matches `lib/stock-list.ts`'s `.order("name")` convention). Returns `[]` for a date with no qualifying movement — never throws on empty input, same convention as every other function in this file.

- [ ] **Step 1: Write the failing tests**

Add a `describe("getItemActivityByDate", ...)` block to `tests/lib/reports.test.ts`, inside the existing outer `describe` (reuse its `admin`, `ownerClient`, `OWNER_ID`, `itemId`, `createdItemIds`, `createdCategoryIds` — same setup/teardown already in that file):

```ts
test("reports qty and cost per item, separating IN and OUT on the same date", async () => {
  const runId = randomUUID().slice(0, 8);
  const category = await createCategory(admin, OWNER_ID, `ItemActivity-${runId}`);
  createdCategoryIds.push(category.id);
  const item = await createItem(admin, OWNER_ID, {
    sku: `IA-${runId}`,
    name: "Item Activity Test Item",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  await recordStockIn(admin, OWNER_ID, {
    itemId: item.id,
    qty: 10,
    unitCost: 100,
    batchDate: "2026-11-20",
  });
  await recordStockOut(admin, OWNER_ID, {
    itemId: item.id,
    qty: 3,
    movementDate: "2026-11-20",
  });

  const result = await getItemActivityByDate(ownerClient, admin, "2026-11-20");
  const row = result.find((r) => r.itemId === item.id)!;
  expect(row.qtyIn).toBe(10);
  expect(row.costIn).toBe(1000);
  expect(row.qtyOut).toBe(3);
  expect(row.costOut).toBe(300); // FIFO: 3 * 100
  expect(row.name).toBe("Item Activity Test Item");
  expect(row.sku).toBe(`IA-${runId}`);
});

test("a day with no qualifying movement returns an empty array", async () => {
  const result = await getItemActivityByDate(ownerClient, admin, "2020-01-01");
  expect(result).toEqual([]);
});

test("a voided movement contributes nothing", async () => {
  const { movementId } = await recordStockIn(admin, OWNER_ID, {
    itemId,
    qty: 7,
    unitCost: 10,
    batchDate: "2026-11-21",
  });
  await voidMovement(admin, OWNER_ID, movementId);

  const result = await getItemActivityByDate(ownerClient, admin, "2026-11-21");
  expect(result.find((r) => r.itemId === itemId)).toBeUndefined();
});

test("an opening-stock import shows qty with zero cost, not excluded", async () => {
  const openingStockDate = "2026-11-22";
  const { data: batch, error: batchError } = await admin
    .from("batches")
    .insert({
      item_id: itemId,
      batch_date: openingStockDate,
      qty_received: 5,
      qty_remaining: 5,
      unit_cost: 77,
      source: "opening_stock",
      created_by: OWNER_ID,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  const { error: movementError } = await admin.from("stock_movements").insert({
    item_id: itemId,
    type: "IN",
    quantity: 5,
    batch_id: batch.id,
    movement_date: openingStockDate,
    created_by: OWNER_ID,
  });
  if (movementError) throw movementError;

  const result = await getItemActivityByDate(ownerClient, admin, openingStockDate);
  const row = result.find((r) => r.itemId === itemId)!;
  expect(row.qtyIn).toBe(5);
  expect(row.costIn).toBe(0);
});

test("a deactivated item that moved stock still appears", async () => {
  const runId = randomUUID().slice(0, 8);
  const category = await createCategory(admin, OWNER_ID, `ItemActivity-Deact-${runId}`);
  createdCategoryIds.push(category.id);
  const item = await createItem(admin, OWNER_ID, {
    sku: `IA-DEACT-${runId}`,
    name: "Deactivated Item",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  await recordStockIn(admin, OWNER_ID, {
    itemId: item.id,
    qty: 2,
    unitCost: 50,
    batchDate: "2026-11-23",
  });
  await admin.from("items").update({ is_active: false }).eq("id", item.id);

  const result = await getItemActivityByDate(ownerClient, admin, "2026-11-23");
  const row = result.find((r) => r.itemId === item.id)!;
  expect(row.qtyIn).toBe(2);
  expect(row.costIn).toBe(100);
});
```

`recordStockOut` and `voidMovement` are already imported from `@/lib/movements` in this file (line 6) — only add `getItemActivityByDate` to the existing `@/lib/reports` import line (line 7-13).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/reports.test.ts -t "getItemActivityByDate"`
Expected: FAIL with "getItemActivityByDate is not a function" (or a TypeScript error if it's not exported yet)

- [ ] **Step 3: Implement `getItemActivityByDate` in `lib/reports.ts`**

Add below `getStockOutValueByDate` and above the `AmountTotals` interface. Shape:

1. Fetch every non-voided movement on `date` in one unpaged query via `supabase`: `.from("stock_movements").select("id, item_id, type, quantity, batch_id").eq("movement_date", date).is("voided_at", null)` (mirrors `buildDailySummary`'s single-day, unpaged read — no `fetchAllPages` needed at this volume).
2. Split into IN and OUT rows. For IN: collect distinct `batch_id`s, look them up via `batches_for_viewer` (`id, unit_cost, source`) using `supabase` — same lookup `getPurchasesByDate` already does — and accumulate `qtyIn` (every IN movement's quantity, unconditionally) and `costIn` (only when `batch.source === "purchase" && batch.unit_cost != null`) per `item_id`.
3. For OUT: collect the OUT movement ids, look up `movement_allocations` (`movement_id, qty_allocated, unit_cost_at_allocation`) using `adminSupabase` — same lookup `getStockOutValueByDate` already does — and accumulate `qtyOut` (every OUT movement's quantity, unconditionally) and `costOut` (`qty_allocated * unit_cost_at_allocation`, summed per the OUT movement's `item_id`) per `item_id`.
4. Collect the distinct `item_id`s with any accumulated total, fetch their `items` row via `supabase`: `.select("id, sku, name, unit, model, variant, year, car_makes(name)").in("id", itemIds)` — **no `.eq("is_active", true)`** (see Global Constraints).
5. Map each item to an `ItemActivity`, with `vehicle` built the same way `lib/stock-list.ts:198-201` does. Sort by `name`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/reports.test.ts`
Expected: PASS (every test in the file, not just the new block — confirms no regression to `getPurchasesByDate`/`getStockOutValueByDate`)

- [ ] **Step 5: Commit**

```bash
git add lib/reports.ts tests/lib/reports.test.ts
git commit -m "feat: add getItemActivityByDate for per-item cost/qty breakdown"
```

---

## Task 2: `ItemActivityList` component

**Files:**
- Create: `app/(dashboard)/reports/item-activity-list.tsx`
- Test: `tests/components/item-activity-list.test.tsx`

**Interfaces:**
- Consumes: `ItemActivity` (Task 1, `@/lib/reports`), `formatCurrency` (`@/lib/format`).
- Produces: `ItemActivityList({ items }: { items: ItemActivity[] })` — a plain function component (no `"use client"`, no async, server-renderable), default-exported... actually named export to match the project's convention (`ReportTable` is a named export in `report-table.tsx`):
  ```ts
  export function ItemActivityList({ items }: { items: ItemActivity[] }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/components/item-activity-list.test.tsx`, following `tests/components/sidebar.test.tsx`'s plain-RTL style (no mocks needed — this component takes no hooks, no router, no context):

```tsx
import { render, screen } from "@testing-library/react";
import { ItemActivityList } from "@/app/(dashboard)/reports/item-activity-list";
import type { ItemActivity } from "@/lib/reports";

const baseItem: ItemActivity = {
  itemId: "item-1",
  sku: "SKU-1",
  name: "Amaron N50",
  vehicle: "Toyota Vios 2020",
  unit: "pcs",
  qtyIn: 20,
  qtyOut: 0,
  costIn: 45000,
  costOut: 0,
};

test("renders each item's name, sku, vehicle, qty, and formatted cost", () => {
  render(<ItemActivityList items={[baseItem]} />);
  expect(screen.getByText("Amaron N50")).toBeInTheDocument();
  expect(screen.getByText("SKU-1")).toBeInTheDocument();
  expect(screen.getByText("Toyota Vios 2020")).toBeInTheDocument();
  expect(screen.getByText("+20")).toBeInTheDocument();
  expect(screen.getByText("45,000.00")).toBeInTheDocument();
});

test("shows only the OUT pill/cost when qtyIn is 0", () => {
  render(<ItemActivityList items={[{ ...baseItem, qtyIn: 0, costIn: 0, qtyOut: 3, costOut: 6000 }]} />);
  expect(screen.queryByText("+0")).toBeNull();
  expect(screen.getByText("−3")).toBeInTheDocument();
  expect(screen.getByText("6,000.00")).toBeInTheDocument();
});

test("shows an empty state when there are no items", () => {
  render(<ItemActivityList items={[]} />);
  expect(screen.getByText("No activity this day.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/item-activity-list.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `ItemActivityList` in `app/(dashboard)/reports/item-activity-list.tsx`**

Follow Calendar's day-modal row markup (`app/(dashboard)/calendar/page.tsx:175-197`) exactly for the name/SKU/qty-pill layout, adding two more pills after the qty pills for `costIn`/`costOut` (rendered via `formatCurrency`, shown only when `> 0`, same `qtyIn > 0`/`qtyOut > 0` conditional pattern). Add the `vehicle` line beneath the name the way `stock-list-table.tsx:136-138` does (`row.vehicle !== "—" && <div className="mt-1 text-sm text-muted-foreground">{row.vehicle}</div>`). Empty state: `items.length === 0 ? <p className="text-sm text-muted-foreground">No activity this day.</p> : ...`, same copy Calendar's modal already uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/item-activity-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/reports/item-activity-list.tsx tests/components/item-activity-list.test.tsx
git commit -m "feat: add ItemActivityList component for per-item qty/cost rows"
```

---

## Task 3: Day view integration

**Files:**
- Modify: `app/(dashboard)/reports/page.tsx`
- Test: `tests/auth/reports-gating.test.ts`

**Interfaces:**
- Consumes: `getItemActivityByDate` (Task 1), `ItemActivityList` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `tests/auth/reports-gating.test.ts` (extends the existing `beforeAll`-seeded item/purchase — reuse `item.id`, `SEEDED_UNIT_COST`, `today`, `OWNER_ID`/owner sign-in; add an owner `signInCookieHeader` call the same way the assistant one already works, using the owner's email/password from `beforeAll`):

```ts
test("an owner sees the per-item list on Day view, with cost", async () => {
  const cookie = await signInCookieHeader(ownerEmail, PASSWORD);
  const res = await fetch(`${BASE_URL}/reports?view=day&date=${today}`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("Reports Gating Test Item");
  expect(body).toContain("12,345.00");
});

test("an assistant with cost hidden never sees the per-item list's cost on Day view", async () => {
  const cookie = await signInCookieHeader(ASSISTANT_EMAIL, PASSWORD);
  const res = await fetch(`${BASE_URL}/reports?view=day&date=${today}`, {
    headers: { Cookie: cookie },
  });
  const body = await res.text();
  expect(body).toContain(
    "Ask the owner to turn on cost visibility in Settings to see this page."
  );
  expect(body).not.toContain("12345");
  expect(body).not.toContain("12,345.00");
});
```

(`ownerEmail` and `today` are currently local `const`s inside `beforeAll` in that file — promote both to file-level `let` declarations, alongside the existing `OWNER_ID`/`ASSISTANT_EMAIL` ones, so every `test()` block in the file can read them, the same way `ASSISTANT_EMAIL` is already hoisted. `beforeAll` then assigns into them instead of declaring them locally. This hoist happens once, in this task; Task 4 reuses both without re-hoisting.)

- [ ] **Step 2: Run tests to verify the owner one fails**

Run: `npx vitest run tests/auth/reports-gating.test.ts` (requires `npm run dev` already running on :3000, per this file's existing precedent)
Expected: the new owner-facing test FAILs (item name/cost not yet rendered on Day view); the assistant-facing one already passes today since nothing new renders yet.

- [ ] **Step 3: Wire `ItemActivityList` into Day view in `page.tsx`**

After the stat-tile `<div className="grid grid-cols-2 ...">` block (page.tsx:312-327), when `view === "day"`: call `await getItemActivityByDate(supabase, adminSupabase, date)` alongside the existing `getDailyReport` call (`Promise.all` the two, both already use the same `supabase`/`adminSupabase` pair) and render `<ItemActivityList items={itemActivity} />` directly beneath the stat-tile grid, inside the same rounded card (`<div className="bg-card px-4 pb-2">`, matching how the Month/Year table is already wrapped at page.tsx:329-336).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/auth/reports-gating.test.ts`
Expected: PASS (both new tests, and the pre-existing assistant-gating test)

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/reports/page.tsx tests/auth/reports-gating.test.ts
git commit -m "feat: show per-item activity list on Reports Day view"
```

---

## Task 4: Month view drill-down

**Files:**
- Modify: `app/(dashboard)/reports/report-table.tsx`
- Modify: `app/(dashboard)/reports/page.tsx`
- Test: `tests/auth/reports-gating.test.ts`

**Interfaces:**
- Consumes: `getItemActivityByDate` (Task 1), `ItemActivityList` (Task 2), `ReportTableRow` (existing, this task adds an optional field to it).
- Produces: `ReportTableRow` gains `href?: string` — Year view's `tableRows` (page.tsx:185-190) is unaffected since it never sets this field, so `ReportTable` keeps rendering plain text for those rows.

- [ ] **Step 1: Write the failing test**

Add to `tests/auth/reports-gating.test.ts`, reusing the same seeded item/purchase/`today`:

```ts
test("an owner can click a Month-view day to see that day's per-item list", async () => {
  const cookie = await signInCookieHeader(ownerEmail, PASSWORD);
  const [year, month] = today.split("-");
  const res = await fetch(
    `${BASE_URL}/reports?view=month&year=${year}&month=${Number(month)}&date=${today}`,
    { headers: { Cookie: cookie } }
  );
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("Reports Gating Test Item");
  expect(body).toContain("12,345.00");
});

test("a Month-view day with zero cost (opening stock) is still a clickable link", async () => {
  // Opening-stock import: zero Purchases-tile cost, but a real movement —
  // the day's table-row link must still be present and reachable.
  const openingStockDate = today;
  const { data: batch } = await createAdminClient()
    .from("batches")
    .insert({
      item_id: createdItemIds[0],
      batch_date: openingStockDate,
      qty_received: 1,
      qty_remaining: 1,
      unit_cost: 1,
      source: "opening_stock",
      created_by: OWNER_ID,
    })
    .select("id")
    .single();
  await createAdminClient().from("stock_movements").insert({
    item_id: createdItemIds[0],
    type: "IN",
    quantity: 1,
    batch_id: batch!.id,
    movement_date: openingStockDate,
    created_by: OWNER_ID,
  });

  const cookie = await signInCookieHeader(ownerEmail, PASSWORD);
  const [year, month] = today.split("-");
  const monthRes = await fetch(
    `${BASE_URL}/reports?view=month&year=${year}&month=${Number(month)}`,
    { headers: { Cookie: cookie } }
  );
  const monthBody = await monthRes.text();
  expect(monthBody).toContain(`date=${openingStockDate}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/auth/reports-gating.test.ts`
Expected: FAIL — no `date=` query param exists in Month-view day links yet, and no item list renders for `?date=`.

- [ ] **Step 3: Add `href` to `ReportTableRow` and make day rows links in `report-table.tsx`**

Add `href?: string` to the `ReportTableRow` interface (not `date` — `report-table.tsx` doesn't know the current month/year, so it can't build a URL itself; the caller passes a ready-made href, keeping this component the same kind of dumb renderer it already is, per its "no cost-visibility branching" simplicity note at report-table.tsx:14). In the row's `<td>` for `row.label` (report-table.tsx:45-53), when `row.href` is set, wrap the label in a `<Link href={row.href}>` (import `Link` from `next/link`); otherwise render the label as today (plain text) — this keeps Year-view rows (which never set `href`) unchanged.

- [ ] **Step 4: Wire the Month-view modal into `page.tsx`**

In the `view === "month"` branch (page.tsx:163-179), set each row's `href` field to `` `${monthHref(year, month)}&date=${d.date}` `` (unconditionally — see Global Constraints). Below the existing `{view !== "day" && (...)}` table block, when `view === "month" && dateParam` and `dateParam` falls within the viewed month (same `dateParam.startsWith(...)` guard Calendar uses, `calendar/page.tsx:73`), call `getItemActivityByDate(supabase, adminSupabase, dateParam)` and render the same `fixed inset-0` modal markup Calendar's own modal uses (`calendar/page.tsx:158-202`), with `<ItemActivityList items={itemActivity} />` inside and a close `<Link>` back to `monthHref(year, month)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/auth/reports-gating.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/reports/report-table.tsx app/\(dashboard\)/reports/page.tsx tests/auth/reports-gating.test.ts
git commit -m "feat: add per-item drill-down modal to Reports Month view"
```
