# Reports Export (Print / PDF / Excel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Print, Export PDF, and Export Excel to the Reports page, with per-item/per-movement detail included for Day and Month exports (Year stays totals-only).

**Architecture:** One new range-query data function (`getItemActivityByDateRange`) extends `lib/reports.ts`'s existing two-step application-joined pattern with a date-grouping level. Two new Route Handlers (`app/api/reports/pdf`, `app/api/reports/excel`) read the same `?view=&date=&year=&month=` params the page already does (via a new shared parser), re-derive the `canSeeCost` gate independently, and branch into Day/Month/Year document builders. The page gets three buttons mirroring Stock List's existing pattern, with Print opening the PDF in a new tab and triggering its print dialog there instead of printing the live page.

**Tech Stack:** Next.js 16 Route Handlers, `@react-pdf/renderer` (already a dependency), `exceljs` (already a dependency), Supabase (`@supabase/supabase-js`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-22-reports-export-design.md`

## Global Constraints

- Export routes re-derive `canSeeCost(role, settings)` and return `NextResponse.json({ error: "Forbidden" }, { status: 403 })` before touching `adminSupabase` or any report function — never trust a client-supplied flag.
- `getItemActivityByDateRange` buckets by `movement_date`, not `created_at` — same field every other date-bucketed function in `lib/reports.ts` uses.
- Month export omits days with zero qualifying movement; if the whole month has zero qualifying movement, render "No activity this month" instead of an empty section.
- Day export shows "No activity this day" for a day with zero qualifying movement — same literal text `ItemActivityList` already renders on screen.
- Year export is totals + month-by-month table only — no day-level or item-level content.
- Filenames: `reports-day-YYYY-MM-DD.{pdf,xlsx}`, `reports-month-YYYY-MM.{pdf,xlsx}`, `reports-year-YYYY.{pdf,xlsx}`.
- No explicit `export const runtime` on the new routes (Node.js is already the Route Handler default; `next.config.ts`'s `cacheComponents: true` rejects that route segment config) — document via comment only, matching `app/api/stock-list/{pdf,excel}`'s existing routes.
- Print button opens the matching PDF href in a new tab (`window.open`) and calls `.print()` on it once loaded — best-effort, no fallback beyond the tab staying open for a manual print.

## Review Focus

- A cost-hidden assistant hitting `/api/reports/pdf` or `/api/reports/excel` directly (bypassing the UI, which hides the buttons) must get 403, never a document containing cost data.
- A Day export for a date with zero qualifying movement renders "No activity this day," not an omitted section or a crash on an empty items array.
- A Month export for a month where every day has zero qualifying movement renders "No activity this month," not a silently empty/missing Item Detail section.
- `getItemActivityByDateRange` must exclude voided movements and still include opening-stock imports at zero cost, same as `getItemActivityByDate` — easy to regress since the range function duplicates that function's logic rather than calling it.
- `getItemActivityByDateRange`'s per-item cost sums across a range must equal `getPurchasesByDate`/`getStockOutValueByDate`'s totals for that same range (the same sum-equality invariant already proven for the single-date function) — otherwise a Month export's Item Detail sheet could silently disagree with the Summary totals sitting right above it.

---

### Task 1: `getItemActivityByDateRange` (data layer)

**Files:**
- Modify: `lib/reports.ts`
- Test: `tests/lib/reports.test.ts`

**Interfaces:**
- Consumes: `fetchAllPages`, `fetchAllForIds`, `ItemActivity`, `ItemActivityMovement` (all existing, same file).
- Produces:
  ```ts
  export interface DailyItemActivity {
    date: string; // "YYYY-MM-DD"
    items: ItemActivity[];
  }

  export async function getItemActivityByDateRange(
    supabase: SupabaseClient,
    adminSupabase: SupabaseClient,
    startDate: string,
    endDate: string
  ): Promise<DailyItemActivity[]>
  ```
  Chronologically sorted by `date`; only dates with at least one qualifying movement appear (sparse — same convention `getPurchasesByDate` uses).

- [ ] **Step 1: Write the failing tests** in `tests/lib/reports.test.ts`, new `describe("getItemActivityByDateRange", ...)` block near the existing `getItemActivityByDate` block, reusing this file's existing `admin`/`ownerClient`/`createCategory`/`createItem`/`recordStockIn`/`recordStockOut`/`voidMovement` fixtures:
  - `"groups each date in the range separately, chronologically ordered"` — create one item, `recordStockIn` on day 1 of a range and `recordStockOut` (different item or same item, either works) on day 3, call `getItemActivityByDateRange(ownerClient, admin, day1, day3)`, assert `result.length === 2`, `result[0].date === day1`, `result[1].date === day3`, and each entry's `items` contains the expected item with the expected movement.
  - `"a date in the range with no qualifying movement is absent from the result"` — call over a range known to have no seeded activity, assert `result` is `[]`; and in the multi-day test above, assert the middle day (with no activity) has no corresponding entry at all.
  - `"a voided movement contributes nothing"` — mirror the existing `getItemActivityByDate` voided test: `recordStockIn` then `voidMovement`, call the range function over a range containing that date, assert no entry for that item on that date.
  - `"an opening-stock import shows qty with zero cost, not excluded"` — mirror the existing single-date test's direct `batches`/`stock_movements` insert with `source: "opening_stock"`, call the range function, assert the item's movement has the right quantity and `cost: 0`.
  - `"per-item cost sums across the range equal getPurchasesByDate/getStockOutValueByDate's totals for the same range"` — mirror the existing single-date sum-equality test (two items, each with an IN and an OUT, on different dates within the range), call `getItemActivityByDateRange` plus `getPurchasesByDate`/`getStockOutValueByDate` over the same `[startDate, endDate]`, sum every movement's cost by type across every date's every item, and assert those sums equal the two totals functions' summed values over the range.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/reports.test.ts -t "getItemActivityByDateRange"`
Expected: FAIL — `getItemActivityByDateRange is not a function` (or import error).

- [ ] **Step 3: Implement `getItemActivityByDateRange` in `lib/reports.ts`**

Same two-step shape as `getItemActivityByDate` (IN movements → `batches_for_viewer` for purchase cost; OUT movements → `movement_allocations` for FIFO cost; both resolved once across the whole range, not per day — same reasoning `getPurchasesByDate`/`getStockOutValueByDate` already use for their own range queries), with one added grouping level: after computing `costByMovementId` the same way, bucket movements first by `movement_date` into a `Map<string, DayMovementRow[]>`, then for each date bucket repeat `getItemActivityByDate`'s existing item-grouping/sort logic (group by `item_id`, sort each item's movements by `occurredAt`, join `items` once — using the distinct item ids across *every* date in the range, not per date, to avoid redundant lookups — then sort each date's items by `name`). Build the final array from the date buckets in ascending date order. Reuse the existing `DayMovementRow`/`DayViewerBatchRow`/`DayAllocationRow`/`ItemActivityItemRow`/`ItemActivityItemQueryRow` types (just query `movement_date` in addition to the existing columns for the movements select).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/reports.test.ts -t "getItemActivityByDateRange"`
Expected: PASS (all 5 new tests).

- [ ] **Step 5: Run the full reports test file to check for regressions**

Run: `npx vitest run tests/lib/reports.test.ts`
Expected: PASS (every existing test still passes).

- [ ] **Step 6: Commit**

```bash
git add lib/reports.ts tests/lib/reports.test.ts
git commit -m "feat: add getItemActivityByDateRange for multi-day per-item breakdowns"
```

---

### Task 2: Shared view-param parsing + `page.tsx` refactor

**Files:**
- Modify: `lib/reports.ts`
- Modify: `app/(dashboard)/reports/page.tsx:93-131`
- Test: `tests/lib/reports.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReportsViewParams {
    view: "day" | "month" | "year";
    date: string;   // always a valid "YYYY-MM-DD", defaulted to `today`
    year: number;
    month: number;  // 1-12
  }

  export function parseReportsViewParams(
    searchParams: { view?: string; date?: string; year?: string; month?: string },
    today: string // "YYYY-MM-DD"
  ): ReportsViewParams
  ```
  Consumed by Task 3/4's routes and by `page.tsx`.

- [ ] **Step 1: Write the failing tests** in `tests/lib/reports.test.ts`, a new top-level `describe("parseReportsViewParams", ...)` block (pure function — no DB fixtures needed):
  - `"defaults to month view, today's year/month/date, when no params are given"` — call with `{}` and `today = "2026-11-22"`, assert `{ view: "month", date: "2026-11-22", year: 2026, month: 11 }`.
  - `"an invalid or missing view falls back to \"month\""` — `{ view: "bogus" }` and `{}` both → `view === "month"`; `{ view: "day" }` → `"day"`; `{ view: "year" }` → `"year"`.
  - `"an invalid year falls back to today's year, a valid one is parsed"` — `{ year: "not-a-number" }` → today's year; `{ year: "2020" }` → `2020`.
  - `"an out-of-range or invalid month falls back to today's month, a valid one is parsed"` — `{ month: "0" }`, `{ month: "13" }`, `{ month: "x" }` all → today's month; `{ month: "3" }` → `3`.
  - `"an invalid date format falls back to today, a valid one is parsed"` — `{ date: "11-22-2026" }` → today; `{ date: "2026-01-05" }` → `"2026-01-05"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/reports.test.ts -t "parseReportsViewParams"`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement `parseReportsViewParams` in `lib/reports.ts`**

Move `page.tsx`'s existing lines 124-131 logic in verbatim (same `view === "day" || view === "year" ? view : "month"`, same `Number.isFinite(Number(yearParam)) && yearParam` guard, same month range check, same `/^\d{4}-\d{2}-\d{2}$/` date regex), deriving `todayYear`/`todayMonth` internally from the `today` parameter the same way `page.tsx` does today.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/reports.test.ts -t "parseReportsViewParams"`
Expected: PASS.

- [ ] **Step 5: Refactor `page.tsx` to call `parseReportsViewParams`**

In `app/(dashboard)/reports/page.tsx`, replace lines 121-131 (the `manilaToday()` call through the `date` derivation) with a call to `parseReportsViewParams(await searchParams, manilaToday())`, destructuring `{ view, date, year, month }` from the result. Leave the `todayYear`/`todayMonth` values (still needed for the tab-link logic further down) derived from `manilaToday()`'s own split, same as today — only the four lines this task's function replaces change; the tab-href logic (lines 133-153) is untouched.

- [ ] **Step 6: Start the dev server and Supabase, run the existing end-to-end Reports gating tests to confirm no regression**

Run: `npx supabase start` (if not already running), then `npm run dev &` (background, port 3000), then:
`npx vitest run tests/auth/reports-gating.test.ts`
Expected: PASS (every existing test in this file still passes against the refactored `page.tsx`).

- [ ] **Step 7: Commit**

```bash
git add lib/reports.ts app/\(dashboard\)/reports/page.tsx tests/lib/reports.test.ts
git commit -m "refactor: extract parseReportsViewParams from Reports page.tsx"
```

---

### Task 3: `GET /api/reports/pdf`

**Files:**
- Create: `app/api/reports/pdf/route.tsx`
- Modify: `tests/auth/reports-gating.test.ts`

**Interfaces:**
- Consumes: `parseReportsViewParams`, `getDailyReport`, `getItemActivityByDate`, `getMonthlyReport`, `getItemActivityByDateRange`, `getAnnualReport` (`lib/reports.ts`); `firstDayOfMonth`/`lastDayOfMonth` (`lib/calendar.ts`); `getRole`/`canSeeCost` (`lib/permissions.ts`); `getSettings` (`lib/settings.ts`); `formatCurrency` (`lib/format.ts`); `manilaTime` (`lib/date.ts`); `createServerClient`/`createAdminClient`.
- Produces: `GET` handler at `/api/reports/pdf?view=&date=&year=&month=` returning `application/pdf`.

- [ ] **Step 1: Write the failing tests** in `tests/auth/reports-gating.test.ts` (same file, same `beforeAll`/`afterAll` fixtures — owner + assistant with cost hidden, a seeded item with `SEEDED_UNIT_COST` on `today`), new `describe("GET /api/reports/pdf", ...)` block:
  - `"an assistant with cost hidden gets 403, not a PDF"` — `fetch` with the assistant's cookie, no query params; assert `res.status === 403`.
  - `"an owner gets a PDF for Day view containing the seeded item's activity"` — `fetch(\`/api/reports/pdf?view=day&date=${today}\`)` with the owner's cookie; assert `res.status === 200`, `res.headers.get("content-type") === "application/pdf"`, `res.headers.get("content-disposition")` contains `reports-day-${today}.pdf`, and the response body (`await res.arrayBuffer()`) has `byteLength > 0`.
  - `"an owner gets a PDF for Month view"` — `fetch(\`/api/reports/pdf?view=month&year=${year}&month=${month}\`)`; assert `200`, `content-type`, and `content-disposition` contains `reports-month-${year}-${pad2(month)}.pdf`.
  - `"an owner gets a PDF for Year view"` — `fetch(\`/api/reports/pdf?view=year&year=${year}\`)`; assert `200`, `content-type`, and `content-disposition` contains `reports-year-${year}.pdf`.
  - `"a Day export with zero activity still returns 200 with a non-empty PDF"` — pick a date known to have no seeded movement (e.g. `"2020-01-01"`), `fetch(\`/api/reports/pdf?view=day&date=2020-01-01\`)` with the owner's cookie; assert `200` and `byteLength > 0` (proves the "No activity this day" branch doesn't throw).
  - `"a Month export where the whole month has zero activity still returns 200 with a non-empty PDF"` — pick a year/month known to have no seeded movement (e.g. `year: 2019, month: 1`), `fetch(\`/api/reports/pdf?view=month&year=2019&month=1\`)` with the owner's cookie; assert `200` and `byteLength > 0` (proves the "No activity this month" branch doesn't throw).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/auth/reports-gating.test.ts -t "GET /api/reports/pdf"`
Expected: FAIL — 404 (route doesn't exist yet).

- [ ] **Step 3: Implement `app/api/reports/pdf/route.tsx`**

Follow `app/api/stock-list/pdf/route.tsx`'s existing shape (same imports, same Node-runtime comment convention, same `renderToBuffer`/`Response(new Uint8Array(buffer), ...)` wrap-up):

```ts
export async function GET(request: Request): Promise<Response>
```

1. Resolve `supabase`/`user`/`profile`/`role` the same way `page.tsx` does; resolve `settings` via `getSettings(supabase)`. If `!canSeeCost(role, settings)`, return `NextResponse.json({ error: "Forbidden" }, { status: 403 })` immediately — before creating `adminSupabase` or calling anything else.
2. `const { view, date, year, month } = parseReportsViewParams(Object.fromEntries(new URL(request.url).searchParams), manilaToday());`
3. Create `adminSupabase = createAdminClient()`.
4. Branch on `view` to fetch data:
   - `"day"`: `Promise.all([getDailyReport(supabase, adminSupabase, date), getItemActivityByDate(supabase, adminSupabase, date)])`.
   - `"month"`: `firstDayOfMonth(year, month)`/`lastDayOfMonth(year, month)`, then `Promise.all([getMonthlyReport(supabase, adminSupabase, year, month), getItemActivityByDateRange(supabase, adminSupabase, startDate, endDate)])`.
   - `"year"`: `getAnnualReport(supabase, adminSupabase, year)`.
5. Render a `ReportsDocument` component (defined in this same file, following `StockListDocument`'s `StyleSheet`/brand-header/title conventions) that branches on `view`:
   - `day`: title + period label (reuse `page.tsx`'s `MONTH_NAMES`-based format, or inline the date), two stat lines (Purchases/Stock-out value via `formatCurrency`), then either the item-list table (name, SKU, vehicle, then one row per movement: `manilaTime(occurredAt)`, type, quantity, `formatCurrency(cost)`) or, when `itemActivity.length === 0`, the text "No activity this day."
   - `month`: title + period label, two stat lines, the day-by-day table (label = day-of-month, Purchases, Stock-out value — same fields `ReportTable` shows), then either a "Day" heading + item-list table per `DailyItemActivity` entry returned by `getItemActivityByDateRange` (skip dates absent from that sparse array — they're already omitted), or, when the array is `[]`, the text "No activity this month."
   - `year`: title + period label, two stat lines, the month-by-month table only (label = month name, Purchases, Stock-out value).
6. Filename: `reports-day-${date}.pdf` / `reports-month-${year}-${pad2(month)}.pdf` / `reports-year-${year}.pdf` (reuse or re-declare the existing `pad2` helper already in `lib/reports.ts`/`page.tsx`).
7. Return the PDF buffer with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="<name>"`, same wrap-up as the Stock List route.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/auth/reports-gating.test.ts -t "GET /api/reports/pdf"`
Expected: PASS (requires the dev server + Supabase running from Task 2 Step 6, or restarted if stopped).

- [ ] **Step 5: Commit**

```bash
git add app/api/reports/pdf/route.tsx tests/auth/reports-gating.test.ts
git commit -m "feat: add GET /api/reports/pdf export route"
```

---

### Task 4: `GET /api/reports/excel`

**Files:**
- Create: `app/api/reports/excel/route.ts`
- Modify: `tests/auth/reports-gating.test.ts`

**Interfaces:**
- Consumes: same as Task 3, plus `ExcelJS`.
- Produces: `GET` handler at `/api/reports/excel?view=&date=&year=&month=` returning `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

- [ ] **Step 1: Write the failing tests** in `tests/auth/reports-gating.test.ts`, new `describe("GET /api/reports/excel", ...)` block, mirroring Task 3's six tests exactly (same fixtures, same dates/views, including the Day-zero-activity and Month-zero-activity cases) but against `/api/reports/excel`, asserting `content-type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` and `content-disposition` containing the `.xlsx` filename variants (`reports-day-${today}.xlsx`, etc.).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/auth/reports-gating.test.ts -t "GET /api/reports/excel"`
Expected: FAIL — 404.

- [ ] **Step 3: Implement `app/api/reports/excel/route.ts`**

Follow `app/api/stock-list/excel/route.ts`'s existing shape (same `ExcelJS.Workbook`/`writeBuffer`/`Response` wrap-up). Same gate, param-parsing, and data-fetching as Task 3 Steps 1-4 (identical branching, reusable almost verbatim since both routes fetch the same data per view). Build the workbook:
- `"day"`: one sheet `"Day Activity"` — first two rows the Purchases/Stock-out-value totals (label + `formatCurrency` value, or raw number — builder's call, match the existing Stock List Excel route's convention of writing plain numbers, not pre-formatted currency strings, into cells so the sheet stays sortable/summable), then a header row (`Time`, `SKU`, `Name`, `Vehicle`, `Type`, `Qty`, `Cost`) and one row per movement across every item; when `itemActivity.length === 0`, write a single row with the text "No activity this day" instead of the header+movement rows.
- `"month"`: two sheets. `"Summary"` — header row (`Day`, `Purchases`, `Stock-out value`) + one row per day of the month (same shape `ReportTable`'s rows use). `"Item Detail"` — header row (`Date`, `Time`, `SKU`, `Name`, `Vehicle`, `Type`, `Qty`, `Cost`) + one row per movement, flattened across every `DailyItemActivity` entry (already sparse/sorted from `getItemActivityByDateRange`) and every item within each; when the array from `getItemActivityByDateRange` is `[]`, write a single row with the text "No activity this month" instead of the header+movement rows.
- `"year"`: one sheet `"Summary"` — header row (`Month`, `Purchases`, `Stock-out value`) + one row per month.
Filenames: same scheme as Task 3, `.xlsx` extension.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/auth/reports-gating.test.ts -t "GET /api/reports/excel"`
Expected: PASS.

- [ ] **Step 5: Run the full gating test file to check for regressions**

Run: `npx vitest run tests/auth/reports-gating.test.ts`
Expected: PASS (every test in the file, old and new).

- [ ] **Step 6: Commit**

```bash
git add app/api/reports/excel/route.ts tests/auth/reports-gating.test.ts
git commit -m "feat: add GET /api/reports/excel export route"
```

---

### Task 5: Page buttons (Print / Export PDF / Export Excel)

**Files:**
- Create: `app/(dashboard)/reports/print-export-button.tsx`
- Modify: `app/(dashboard)/reports/page.tsx`
- Test: `tests/components/print-export-button.test.tsx`

**Interfaces:**
- Consumes: `parseReportsViewParams`'s already-resolved `view`/`date`/`year`/`month` from `page.tsx`; `Button` (`components/ui/button.tsx`).
- Produces:
  ```tsx
  export function PrintExportButton({ href }: { href: string }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test** in `tests/components/print-export-button.test.tsx`:
  ```tsx
  import { render, screen, fireEvent } from "@testing-library/react";
  import { PrintExportButton } from "@/app/(dashboard)/reports/print-export-button";

  test("clicking Print opens the given href and calls print() on the new window once it loads", () => {
    const addEventListener = vi.fn((_event: string, cb: () => void) => cb());
    const print = vi.fn();
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue({ addEventListener, print } as unknown as Window);

    render(<PrintExportButton href="/api/reports/pdf?view=day&date=2026-11-22" />);
    fireEvent.click(screen.getByRole("button", { name: /print/i }));

    expect(openSpy).toHaveBeenCalledWith("/api/reports/pdf?view=day&date=2026-11-22", "_blank");
    expect(addEventListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(print).toHaveBeenCalled();
  });

  test("does nothing further when the popup is blocked (window.open returns null)", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<PrintExportButton href="/api/reports/pdf?view=day&date=2026-11-22" />);
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: /print/i }))
    ).not.toThrow();
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/print-export-button.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/(dashboard)/reports/print-export-button.tsx`**

`"use client"` component, same `Button variant="outline" size="touch"` styling as `app/(dashboard)/stock-list/print-button.tsx`. `onClick` does `const w = window.open(href, "_blank"); w?.addEventListener("load", () => w.print());`. Label: "Print". Same `print:hidden` class as the existing `PrintButton`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/print-export-button.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the button row to `app/(dashboard)/reports/page.tsx`**

Inside the existing `canSeeCost` branch (i.e., below the early-return for `!canSeeCost`, so the buttons only ever render when the page itself does), add a button row near the view tabs (same `flex flex-wrap gap-2` pattern Stock List uses):

```tsx
<PrintExportButton href={pdfHref} />
<Button asChild variant="outline" size="touch">
  <a href={pdfHref}>Export PDF</a>
</Button>
<Button asChild variant="outline" size="touch">
  <a href={excelHref}>Export Excel</a>
</Button>
```

Where `pdfHref`/`excelHref` are built from the page's own already-resolved `view`/`date`/`year`/`month` (same values `parseReportsViewParams` returned in Task 2): `/api/reports/pdf?view=day&date=${date}` for Day, `/api/reports/pdf?view=month&year=${year}&month=${month}` for Month, `/api/reports/pdf?view=year&year=${year}` for Year — and the `/api/reports/excel` equivalent for `excelHref`. Import `PrintExportButton` from `./print-export-button`.

- [ ] **Step 6: Manually verify in the browser**

Start the dev server (`npm run dev`) if not already running, sign in as the owner, visit `/reports` in each of the three views (Day/Month/Year, including navigating to a date with seeded activity and one without), and for each: confirm the three buttons render, "Export PDF"/"Export Excel" download a file matching the expected filename pattern and open correctly, and "Print" opens a new tab showing the PDF and triggers the print dialog (or, if the browser's built-in PDF viewer doesn't auto-print, confirm the tab at least opened with the right PDF). Also confirm the buttons are absent entirely when signed in as an assistant with cost hidden.

- [ ] **Step 7: Commit**

```bash
git add app/\(dashboard\)/reports/print-export-button.tsx app/\(dashboard\)/reports/page.tsx tests/components/print-export-button.test.tsx
git commit -m "feat: add Print/Export PDF/Export Excel buttons to Reports page"
```

---

### Task 6: Whole-feature verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions anywhere (including the pre-existing dev-server-dependent files from Tasks 2-4).

- [ ] **Step 2: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Request code review**

Invoke the superpowers:requesting-code-review skill for the whole branch/diff before considering this feature done.
