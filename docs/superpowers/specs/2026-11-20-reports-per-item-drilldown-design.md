# Reports page: per-item drill-down (Calendar/Reports merge) — design

## Intent / why

Reports and Calendar are already near-duplicates: both bucket the same
`stock_movements` table by date, both exclude voided movements, both have
prev/next day/month/year navigation. The only real differences are
**cost vs. quantity** and **who can see it** (Reports is owner-gated via
`canSeeCost`; Calendar is visible to everyone). Reports even imports
Calendar's date-math helpers (`daysInMonth`/`firstDayOfMonth`/
`lastDayOfMonth`) already.

Calendar's one feature Reports lacks is the per-item breakdown: click a
day, see which items moved and by how much. Reports only ever shows
date-bucketed totals, never a list of items. The ask: fold that
per-item breakdown into Reports, with cost added (since Reports, unlike
Calendar, is already cost-visible) — e.g. "we added stock on November 20
of 20 Amaron batteries, it shows the item and cost."

Confirmed in conversation:

- Not a toggle/grid merge — Reports keeps its existing Day/Month/Year
  tab structure and owner-only gating exactly as today.
- **Day view**: below the existing Purchases/Stock-out tiles, show the
  list of items that moved that day, with cost.
- **Month view**: the existing day-by-day `ReportTable` stays as the
  totals table it is; each day row becomes clickable to reveal that
  same per-item list, without losing the roll-up.
- **Calendar page is untouched** — it stays exactly as it is today: its
  own route, its own nav link, visible to every role, quantity-only. It
  keeps serving as the everyone-visible activity view; Reports becomes
  the richer owner-only one.

## Goals

- Reports' Day view shows, under the two stat tiles, every item that had
  a non-voided IN or OUT movement that day: item (name + SKU + vehicle),
  qty in/out, and cost in/out.
- Reports' Month view's existing day-by-day table becomes drill-down-able:
  clicking a day with activity shows that day's per-item list (same shape
  as Day view's list), without replacing or restructuring the table
  itself.
- Year view is unchanged — no per-item drill-down at month-by-month
  granularity (see Non-goals).
- Calendar page, route, nav link, and permissions are unchanged.

## Non-goals

- No change to Calendar (`app/(dashboard)/calendar/*`, `lib/calendar.ts`)
  — explicitly kept as-is per conversation.
- No toggle/grid merge, no new unified route, no change to either page's
  permission model.
- No per-item drill-down on Year view — a 12-cell month-by-month table
  expanding into a full month's worth of per-item rows per cell is a
  different (and much heavier) UI problem than a single day's list; not
  asked for, and the existing Day/Month views already cover "what moved
  on a specific day." Revisit as a separate request if wanted.
- No new per-item lifecycle/history fields (warranty date, install date,
  etc.) — confirmed out of scope; "per item data" here means the
  existing per-day movement/cost breakdown, not new schema.
- No changes to the daily summary email (`lib/email/dailySummary.ts`) —
  it's reused for its shape/precedent, not modified.

## Constraints / findings (from reading the code)

- `lib/reports.ts`'s `getPurchasesByDate`/`getStockOutValueByDate` already
  compute cost per day via the same two-step pattern this needs
  (movements → batches for IN cost, movements → `movement_allocations`
  for FIFO OUT cost) — but summed **across all items** per date, with no
  `item_id` carried through. Per-item drill-down needs that grouping
  extended one level, not a new cost model.
- `lib/email/dailySummary.ts`'s `buildDailySummary` already answers "which
  items moved on this date, and by how much qty" (`itemsWithActivity`) —
  reused today by both Calendar's modal and the daily email. It has no
  cost fields at all (by design — the email and Calendar are both
  cost-blind). This confirms the per-item *quantity* grouping pattern to
  follow, but a new function is needed for per-item *cost*.
- Both existing cost functions require **two different Supabase
  clients**: `getPurchasesByDate` needs a real signed-in session (reads
  `batches_for_viewer`, which resolves cost visibility against
  `auth.uid()`), `getStockOutValueByDate` needs the admin/service-role
  client (the only client with read access to `movement_allocations`).
  Reports' page already creates both (`supabase`, `adminSupabase`) and
  gates on `canSeeCost` before either is touched — the new per-item
  function slots into that same gate, so no new permission surface is
  introduced.
- Reports' Month view table rows (`report-table.tsx`) are built from
  `MonthlyReport.days`, each of which already carries a `date` string
  (`YYYY-MM-DD`) — the day cell has what it needs to link to a
  per-item-detail state for that date; no new data has to flow through
  `ReportTable` itself beyond an href per row.
- Calendar's day-detail modal is entirely URL-driven (`?date=` triggers a
  server-rendered modal via a plain `<Link>`, no client JS, closing is a
  link back without the param) — Reports already uses the identical
  convention for its own view/date state. The per-item detail (both Day
  view's inline list and Month view's click-to-reveal list) follows the
  same pattern: a `date` query param, read server-side, no new client
  state.
- `lib/stock-list.ts`'s `vehicle` field
  (`[makeName, model, variant, year].filter(Boolean).join(" ") || "—"`)
  is the project's existing convention for a one-line vehicle label —
  inlined there and in `items-table.tsx`, not a shared helper. The new
  per-item query reuses this exact inline pattern rather than inventing
  a different vehicle-display format.
- Cost show/hide at the row level already has a precedent
  (`lib/stock-list.ts`'s `showCost` param, spreading extra fields onto a
  `base` row only when true) — not needed here, since this whole feature
  only renders once `canSeeCost` has already gated page access, so cost
  is never conditionally hidden per-row the way Stock List does for
  mixed-role viewing.
- `getPurchasesByDate`/`getStockOutValueByDate` (the Purchases/Stock-out-
  value tiles already on the page, unchanged by this feature) query
  `stock_movements` with no join to `items` at all — they sum cost for
  every item regardless of `is_active`. `buildDailySummary`, by contrast,
  filters to `is_active = true` and silently drops movements for
  inactive items. These two precedents disagree, and the new function
  sits directly below the tiles on the same page — so it must follow the
  tiles' behavior (no active-only filter), not `buildDailySummary`'s,
  or the per-item list would sum to less than the totals shown just
  above it on what is explicitly a cost report. Called out explicitly
  in the Design section below rather than left implicit.

## Design

### Data layer (`lib/reports.ts`)

New function, same file as the existing report functions:

```ts
export interface ItemActivity {
  itemId: string;
  sku: string;
  name: string;
  vehicle: string;   // same "—" / joined-parts convention as lib/stock-list.ts
  unit: string;
  qtyIn: number;
  qtyOut: number;
  costIn: number;    // purchase cost of this item's IN movements that day
  costOut: number;   // FIFO stock-out value of this item's OUT movements that day
}

export async function getItemActivityByDate(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  date: string
): Promise<ItemActivity[]>
```

Shape: extends `getPurchasesByDate`/`getStockOutValueByDate`'s existing
two-step, application-joined pattern by carrying `item_id` through the
grouping (both functions currently select `movement_date`/`id` but not
`item_id` — a one-column addition to each query) rather than a different
approach. Movements for `date` are fetched once (IN and OUT), batch/
allocation costs resolved the same way the existing functions already
do, and the running totals are keyed by `item_id` instead of by date.
Items with any qualifying movement are then joined against `items` to
get sku/name/vehicle/unit — **no `is_active` filter** (unlike
`buildDailySummary`): this list sits directly beneath the Purchases/
Stock-out-value tiles, which themselves never filter by `is_active`
either, so `sum(itemActivity.costIn) === tile.purchases` and
`sum(itemActivity.costOut) === tile.stockOutValue` must hold for any
date — an item that's since been deactivated still shows up if it moved
that day, same as its cost still counts in the tiles above it. Items
with zero movement that day are simply absent from the result — same
sparse convention as every other function in this file. Only ever
called for a single date at a time (Day view's date, or whichever date a
Month-view row is expanded for) — not a range — since that's all either
caller needs.

List-inclusion uses the same rule the design already states — any
non-voided IN or OUT movement, not "cost > 0" — so an opening-stock
import (zero purchase cost by design, per `getPurchasesByDate`'s own
`source !== "purchase"` exclusion) still shows up with `costIn: 0`,
correctly reading as "20 units arrived, no purchase cost attached"
rather than being silently dropped.

### UI (`app/(dashboard)/reports/`)

- **New component**, e.g. `item-activity-list.tsx` — a server-renderable
  (no "use client") list of `ItemActivity` rows, visually following
  Calendar's existing day-modal row layout (item name + SKU, qty in/out
  as small pill badges) with two more pills/columns for cost in/out
  (`formatCurrency`). Used by both Day view (rendered inline, no
  wrapper) and Month view (rendered inside a modal, same
  `fixed inset-0` overlay markup Calendar's own modal already uses).
- **Day view** (`page.tsx`): after the existing stat-tile grid, call
  `getItemActivityByDate(supabase, adminSupabase, date)` (gated behind
  the page's existing `canSeeCost` check — already true for the whole
  page) and render `<ItemActivityList>` beneath it.
- **Month view**: every day row in `report-table.tsx` becomes a
  `<Link href={monthHref(year, month) + "&date=" + row.date}>` —
  unconditionally, not gated on `purchases > 0 || stockOutValue > 0`.
  That cost-based check was the obvious first guess but doesn't agree
  with the list's own movement-based inclusion rule above: a day whose
  only movement is a zero-cost opening-stock import has `purchases === 0
  && stockOutValue === 0` yet the per-item list for that date is
  non-empty — so gating the link on cost would make exactly that date
  unreachable. Clicking a day with genuinely zero movement just shows
  the list's own empty state (see Left to the builder), same as
  Calendar's modal already does for a day with no activity — a harmless
  extra query, not a correctness issue. `page.tsx` reads a `date` query param
  the same way Calendar's `dateParam` works: when present (and view is
  `month`), call `getItemActivityByDate` for that date and render the
  modal with `<ItemActivityList>` inside, closing via a link back to the
  same month with `date` dropped — identical mechanics to Calendar's
  existing modal, not a new interaction model.
- **Year view**: no change.

## Left to the builder

- Exact pill/badge styling for the two new cost columns in
  `item-activity-list.tsx` — match Calendar's existing qty-pill look
  (green/gold, rounded) with `formatCurrency` text instead of a bare
  number; exact spacing/wrap behavior at narrow widths is a cosmetic
  call.
- Whether `getItemActivityByDate`'s two cost sub-queries (IN via
  `batches_for_viewer`, OUT via `movement_allocations`) run as literal
  copies of `getPurchasesByDate`/`getStockOutValueByDate`'s bodies with
  grouping-by-item added, or as a shared internal helper the three
  functions call into — implementation detail, no behavioral difference;
  builder's call based on how much duplication feels reasonable.
- Empty state copy for a clicked/viewed day with zero item activity
  (mirror Calendar's "No activity this day.").
