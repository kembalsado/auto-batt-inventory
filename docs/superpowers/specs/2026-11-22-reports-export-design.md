# Reports page: Print / Export PDF / Export Excel — design

## Intent / why

Stock List already has this exact pattern (`app/(dashboard)/stock-list/`:
`print-button.tsx`, and `app/api/stock-list/{pdf,excel}/route.ts(x)`,
built on `@react-pdf/renderer` and `exceljs`, both already installed).
Reports has no equivalent — an owner who wants a cost report outside the
app has no way to get one out. The ask: add Print, Export PDF, and
Export Excel to Reports, and unlike Stock List's flat one-table export,
Reports' export should also carry the per-item detail (which items
moved, qty, cost) per day — not just the date-bucketed totals the page
shows today.

Confirmed in conversation:

- Scope of per-item detail across the three views (**Option A**): Day
  export = totals + that day's item list (already exists on screen).
  Month export = the day-by-day totals table + every day's item list as
  sections in the same document. Year export = month-by-month totals
  only, no day-level item lines — matching the boundary the prior
  per-item-drill-down design already drew for the on-screen UI ("no
  per-item drill-down on Year view ... revisit as a separate request if
  wanted"), now carried into export for the same reason: a year's worth
  of daily item rows is a very large document nobody asked to see on
  screen either, and Year's existing month-by-month table is already a
  meaningful cost summary on its own.
- Print approach: **Print opens the Export PDF** in a new tab and
  triggers the browser's print dialog there, rather than making
  `window.print()` of the live page itself carry the full day-by-day
  item breakdown. Reports' Month/Year views only ever render one day's
  item list at a time (the click-to-open modal); making the live page
  print-capable for the full breakdown would mean always fetching every
  day's item list on every Month/Year page load just to support a
  button most visits never click. Routing Print through the PDF reuses
  that document's layout entirely — no second print-only markup to
  build and keep in sync with the PDF.

## Goals

- Reports page gets three buttons — Print, Export PDF, Export Excel —
  visible on Day, Month, and Year views alike (matching Stock List's
  button row), hidden from a viewer `!canSeeCost` sees (no buttons
  render — same as today's whole-page gate) and rejected server-side if
  requested anyway.
- Export PDF / Export Excel reflect whatever view/date/year/month the
  page is currently showing (same `?view=&date=&year=&month=` state the
  page itself reads) — exporting "this page," not a fixed report.
- Day export: Purchases/Stock-out-value totals + that date's per-item
  activity list (name, SKU, vehicle, per-movement time/qty/cost) — same
  data `ItemActivityList` already renders on screen, including its
  empty state: a day with no qualifying movement shows the same literal
  "No activity this day" text the screen shows, since Day export is a
  single section and there's nothing to declutter by omitting it.
- Month export: the month's totals + the existing day-by-day
  Purchases/Stock-out-value table + every day-with-activity's per-item
  list, as sections in the same document. Days with zero qualifying
  movement are omitted (cleaner output; a 30-section document with
  "No activity" repeated for empty days serves no one) — except when
  *no* day in the month qualifies, where the section is replaced with a
  single "No activity this month" line rather than silently vanishing
  (so an all-quiet month's export doesn't read as broken/truncated).
- Year export: the year's totals + the existing month-by-month table.
  No day-level or item-level content.
- Print opens the matching Export PDF in a new tab and calls `.print()`
  on it once loaded.

## Non-goals

- No change to Calendar, no change to Stock List's own export routes.
- No CSV export — PDF and Excel only, matching the ask.
- No per-item drill-down added to Year view's on-screen UI — this is an
  export-only extension of the existing Day/Month on-screen behavior,
  not a revisit of the prior design's Year non-goal for the page itself.
- No change to the existing Month-view click-to-open per-day modal, or
  to `getItemActivityByDate`'s single-date signature — a new function
  is added for the range case (below), the existing one is untouched.

## Constraints / findings (from reading the code)

- `lib/reports.ts`'s `getItemActivityByDate(supabase, adminSupabase,
  date)` already computes exactly the per-item/per-movement shape this
  needs, but only for one date at a time — calling it once per day of a
  month (up to 31 times) would re-run its two-step batch/allocation/items
  lookups 31× instead of once each. Every other range-shaped function in
  this file (`getPurchasesByDate`, `getStockOutValueByDate`) instead
  queries the whole range once and groups client-side — the new range
  function follows that precedent, not a per-day loop.
- Reports' route gate is stricter than Stock List's: Stock List is
  visible to everyone with cost columns conditionally included;
  Reports' entire page is hidden behind `canSeeCost` (`lib/
  permissions.ts` + `lib/settings.ts`'s `show_cost_to_assistant`). The
  export routes must re-derive and enforce that same gate themselves
  (403 when `!canSeeCost`, re-checked server-side, never trusted from a
  client-supplied flag) — not Stock List's lighter "hide some columns"
  pattern, matching `tests/auth/reports-gating.test.ts`'s existing
  end-to-end rigor for the page itself.
- `page.tsx` currently inlines its own `view`/`date`/`year`/`month`
  parsing/defaulting from `searchParams` (lines 124-131). Both new
  routes need the identical parsing so an export always matches what
  the viewer is actually looking at — duplicating that logic twice more
  risks drift (e.g. a future change to the day-regex or default-month
  logic landing in only one of three places). Pulled into one shared
  helper both routes and the page call.
- `@react-pdf/renderer`'s `Page`/`View` wrap content by default — a
  month with many active days doesn't need manual pagination logic, the
  same way `StockListDocument` needs none for a long item list.
- Route runtime note already documented on both Stock List routes
  applies unchanged here: Node.js runtime (the default for a Route
  Handler), not Edge — `exceljs` and `@react-pdf/renderer`'s
  `renderToBuffer` both need Node APIs, and `next.config.ts`'s
  `cacheComponents: true` rejects an explicit `export const runtime`
  route segment config, so the default has to speak for itself (comment
  only, same as the existing routes).

## Design

### Data layer (`lib/reports.ts`)

New function, same file, same two-step application-joined pattern as
`getItemActivityByDate` with one more grouping level (by date):

```ts
export interface DailyItemActivity {
  /** "YYYY-MM-DD" */
  date: string;
  items: ItemActivity[];
}

export async function getItemActivityByDateRange(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<DailyItemActivity[]>
```

Fetches every non-voided movement in `[startDate, endDate]` once (paged
via `fetchAllPages`, same as `getPurchasesByDate`/
`getStockOutValueByDate`'s range queries — selecting `movement_date`
this time, not just `id`), resolves IN cost via one `batches_for_viewer`
lookup and OUT cost via one `movement_allocations` lookup across the
*whole range* (same as the two range functions, not per-day), then
groups movements first by `movement_date` (the same field the range
totals bucket by — not `created_at`, keeping this consistent with every
other date-bucketed function in the file) and within each date by
`item_id`, joining `items` once for every distinct item touched
anywhere in the range. Same inclusion rule as `getItemActivityByDate`
(any non-voided IN/OUT, no `is_active` filter, opening-stock imports
included at zero cost) and the same per-item `name` sort within each
day. Only dates that had at least one qualifying movement appear in the
result (sparse, chronologically ordered) — a caller that wants to show
"no activity" for an empty day in between does so by noticing the gap,
same as `getPurchasesByDate`'s sparse-map convention.

### Shared view-param parsing

New small helper (`lib/reports.ts` or alongside it), extracted from
`page.tsx`'s existing inline logic verbatim:

```ts
export interface ReportsViewParams {
  view: "day" | "month" | "year";
  date: string;   // always valid "YYYY-MM-DD", defaulted to today
  year: number;
  month: number;  // 1-12
}

export function parseReportsViewParams(
  searchParams: { view?: string; date?: string; year?: string; month?: string },
  today: string
): ReportsViewParams
```

`page.tsx` switches to calling this instead of its own inline block (no
behavior change — same defaulting rules, moved not altered). Both new
routes call it too, so a request's `?view=&date=&year=&month=` is
interpreted identically everywhere.

### Export routes

`app/api/reports/pdf/route.tsx`, `app/api/reports/excel/route.ts` —
same filename-extension convention as Stock List's pair (`.tsx` for the
JSX document tree, `.ts` for the workbook builder). Both:

1. Resolve `role`/`settings` the same way every existing route in this
   app does; **403** immediately if `!canSeeCost(role, settings)` —
   before touching `adminSupabase` or any report function, mirroring
   `page.tsx`'s own early-return gate. Response body
   `NextResponse.json({ error: "Forbidden" }, { status: 403 })` — the
   existing convention in `app/api/makes/[id]/route.ts`, `app/api/
   users/route.ts`, `app/api/categories/[id]/route.ts`, even though
   Stock List's own PDF/Excel routes (this design's stated precedent for
   everything else) never 403 at all and so don't demonstrate this one.
2. Parse `view`/`date`/`year`/`month` via `parseReportsViewParams`.
3. Branch on `view`:
   - **day**: `getDailyReport` + `getItemActivityByDate` (existing
     functions, unchanged) → totals + one item list.
   - **month**: `getMonthlyReport` (existing) → totals + day-by-day
     table, plus `getItemActivityByDateRange` over that month's
     `firstDayOfMonth`/`lastDayOfMonth` → per-day item sections,
     skipping dates absent from the sparse result.
   - **year**: `getAnnualReport` (existing) → totals + month-by-month
     table only.
4. Filename reflects the view: `reports-day-YYYY-MM-DD.{pdf,xlsx}`,
   `reports-month-YYYY-MM.{pdf,xlsx}`, `reports-year-YYYY.{pdf,xlsx}`.

**PDF document** (`route.tsx`): one `ReportsDocument` component,
branching on `view` the same way `StockListDocument` is a single
component today — brand header + title + period label, the
Purchases/Stock-out-value totals as two stat lines, then:
- day: `Text`/`View` rows for the item list (name, SKU, vehicle, then
  one row per movement: time, type, qty, cost) — same fields
  `ItemActivityList` shows, flattened into a table instead of pills.
- month: the existing day-by-day table (label/purchases/stockOutValue),
  then a "Day" heading + item rows per section for every day that had
  activity.
- year: the month-by-month table only.

**Excel workbook** (`route.ts`): `ExcelJS.Workbook` with:
- day: one sheet ("Day Activity") — header totals as the first two
  rows, then item/movement rows (Date, Time, SKU, Name, Vehicle, Type,
  Qty, Cost).
- month: two sheets — "Summary" (the day-by-day totals table, same
  shape as `ReportTable`'s rows) and "Item Detail" (one flat row per
  movement across every active day, columns Date, Time, SKU, Name,
  Vehicle, Type, Qty, Cost — sorted by date then time, so a reader can
  filter/sort the sheet themselves rather than needing per-day
  sub-tables, which `exceljs` doesn't make pleasant to produce).
- year: one sheet ("Summary") — the month-by-month totals table only.

### UI (`app/(dashboard)/reports/page.tsx`)

Button row added next to the existing view tabs / jump-to form, same
`Button asChild variant="outline" size="touch"` styling Stock List
uses, rendered only inside the already-existing `canSeeCost` branch (so
a viewer who can't see cost gets no buttons, same as today's whole-page
gate):

```
[ Print ]  [ Export PDF ]  [ Export Excel ]
```

- **Export PDF** / **Export Excel**: plain `<a href="/api/reports/pdf?...">`
  / `<a href="/api/reports/excel?...">`, query string built from the
  page's own already-resolved `view`/`date`/`year`/`month` (whatever the
  viewer is currently looking at).
- **Print**: new client component (e.g. `print-export-button.tsx`,
  alongside `print-button.tsx`'s existing pattern but distinct since the
  behavior differs) taking the same PDF href as a prop, doing
  `const w = window.open(href, "_blank"); w?.addEventListener("load", () => w.print())`.
  Best-effort: if the popup is blocked, nothing happens beyond the
  browser's own native "popup blocked" indicator — same degradation any
  `window.open`-based flow has, not something this feature needs to
  work around. If the new tab's built-in PDF viewer doesn't fire
  `.print()` reliably in some browser, the PDF is still open in a tab
  the viewer can print from manually — never a dead end, just a missed
  auto-trigger.

## Left to the builder

- Exact PDF column widths/styling for the item/movement rows — follow
  `StockListDocument`'s existing `styles` object (flex-based columns,
  Helvetica, brand green header) rather than inventing a new look.
- Exact Excel column widths for "Item Detail" — follow the stock-list
  Excel route's existing width choices as a starting point.
- Whether `parseReportsViewParams` lives in `lib/reports.ts` directly or
  a new small file — implementation detail, no behavioral difference.
- Test coverage: extend `tests/lib/reports.test.ts` with integration
  tests for `getItemActivityByDateRange` (multi-day grouping, voided-
  movement exclusion, opening-stock zero-cost inclusion, empty-day
  omission), following that file's existing real-Supabase conventions.
  Extend `tests/auth/reports-gating.test.ts` (or a sibling file) with
  the same end-to-end 403-when-cost-hidden check already proven for
  `GET /reports` itself, applied to both new routes — matching the
  rigor that test file already holds this feature to, which Stock
  List's own export routes don't need (nothing on that page is fully
  hidden, just conditionally columned). No new tests asserting exact
  PDF/Excel byte content — Stock List's own export routes have none
  either (only a non-public-route check in
  `tests/auth/public-paths.test.ts`); match that existing bar rather
  than inventing a heavier one for this feature alone.
