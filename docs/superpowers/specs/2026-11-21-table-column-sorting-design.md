# Column sorting (+ search debounce) for every data table — design

## Intent / why

Every table in the app renders rows in whatever order the data arrived in
(a fixed `.order()` on the query, or — for a couple of tables — no
explicit order at all). The ask: let a user click a column header to sort
by that column, ascending/descending, on every real data table in the
app. A follow-up ask folded into the same design: debounce the existing
per-table search boxes and give some loading feedback, so the combined
search+sort+filter experience "looks and feels good" rather than feeling
twitchy on every keystroke.

Confirmed in conversation:

- The interaction is **clickable sort arrows in column headers** (not
  literal arrow-key navigation) — click toggles ascending ↔ descending.
- No "unsorted" third state: each table already has a sensible default
  sort (its current `.order()`, or a sensible pick where none exists
  today), so clicking a header's own column just flips direction; it
  never needs to fall back to "no sort."
- Scope is **every** data table, including the two that are
  server-rendered by design (Activity, Reports) — not just the
  client-rendered ones.

## Goals

- Every real data column, on every table listed below, is sortable by
  clicking its header: ascending ↔ descending, with a lucide
  `ArrowUp`/`ArrowDown`/`ArrowUpDown` icon showing the current state.
- One shared visual/interaction language app-wide: same icon set, same
  focus-visible ring the rest of the app already uses
  (`focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`),
  `aria-sort` on the active `<th>` (this is the first use of `aria-sort`
  in the codebase — nothing to match, just don't invent a second
  convention later).
- No table's **default** displayed order changes — sorting is additive;
  until a user clicks a header, every table looks exactly like it does
  today.
- The six tables whose data is already fully fetched before render
  (Items, Batches, Movements, Stock List, Users, Reports) sort **in
  memory**, with no extra network round trip per click.
- Activity's sort stays entirely server-rendered — no client JS is added
  to that page. See Constraints below for why.
- The five search boxes (Items, Batches, Movements, Stock List, Users)
  debounce their filtering — the input itself stays instant, but the
  derived filtered+sorted list recomputes ~200ms after typing pauses,
  not on every keystroke.
- During that debounce window, the table visibly (if subtly) shows it's
  about to update rather than sitting static with no feedback.

## Non-goals

- Multi-column sort.
- Persisting a chosen sort across reloads/navigation for the six
  in-memory tables — they reset to their default sort on refresh, same
  as their existing search boxes already reset on refresh. Activity's
  sort *is* persisted, for free, because it lives in the URL (same as
  its existing filters).
- Sorting the Import grid (`app/(dashboard)/import/page.tsx`) — its rows
  are the user's own in-progress input order, not fetched data.
- Sort controls on the mobile card layouts (Items, Batches, Movements,
  Stock List already have a `md:hidden` card list alongside their
  `hidden md:table`). Cards have no header row to click. They render
  from the same sorted array as the table, though, so a card list
  reflects whatever sort is active rather than visually disagreeing with
  it — just with no control of its own to change it on that breakpoint.
- The Calendar grid, Categories/Makes `<ul>` lists, and the Dashboard's
  stat tiles/Low-stock list — none of these are tables with columns.
- Any new table/data-grid dependency (TanStack Table etc.) — this is
  mechanical enough to write directly.

## Constraints / findings (from reading the code)

- No shared `<Table>` component exists anywhere; all 7 in-scope tables
  are bespoke `<table>` JSX (`items-table.tsx`, `batches-table.tsx`,
  `movements-list.tsx`, `stock-list-table.tsx`, `users-table.tsx`,
  `report-table.tsx`, `activity/page.tsx`). No existing sort/keyboard
  pattern to match (`grep` for `sortBy|aria-sort|onSort|onKeyDown` across
  `app/`+`components/` is empty) beyond the focus-ring convention above.
- **Items / Stock List** (`lib/items.ts:127`, `lib/stock-list.ts:136`):
  default order is `name` ascending.
- **Batches** (`lib/stock-list.ts:162-163`): default order is
  `batch_date` ascending (then `id` ascending as a tiebreaker).
- **Movements** (`lib/stock.ts:101-104`): default order is
  `movement_date` descending, then `created_at` descending — newest
  first. (Matches the recent "list each item movement individually,
  sorted by time" change — sorting must not regress that.)
  `movement_date` is a `date` column with no time component
  (`supabase/migrations/0001_init.sql:54`); `created_at` is what actually
  orders same-day rows. `StockMovement` already carries `createdAt`
  (`lib/stock.ts:11-22`), but the item detail page currently drops it
  when building `MovementRow`s (`app/(dashboard)/items/[id]/page.tsx:
  180-187` maps only `id/type/quantity/movementDate/note/voidedAt`), and
  `MovementRow` itself has no `createdAt` field
  (`movements-list.tsx:8-15`). The Date column's accessor needs
  `(movementDate, createdAt)` as a composite sort key, not `movementDate`
  alone, or two movements on the same day lose their time-order the
  first time someone toggles the column. This means touching those two
  files too, beyond the component list below: add `createdAt` to
  `MovementRow` and pass it through in `page.tsx`'s mapping.
- **Users** (`lib/users.ts:102-106`): no explicit `.order()` today — rows
  come back in whatever order Postgres happens to return them. No
  existing order to preserve; picking **Name ascending** as the default
  is a free choice, not a behavior change.
- **Reports** (`report-table.tsx`): rows arrive already in chronological
  order (day-of-month or month-of-year) and **`row.label` is a display
  string, not a sortable value** — Month view's `label` is `"1"`.."31"`
  (string-sorts wrong: `"10"` < `"2"`) and Year view's `label` is a month
  *name* (not alphabetically chronological). The label column's sort key
  must be the row's original index/position, not `row.label` itself.
  Despite being server-rendered today ("static markup, server-renderable
  like the rest of the page" per its own docstring — a style choice, not
  a data-size one), **all of its rows are already fully computed and
  passed in as a prop** (max 31, for a month), exactly like Items/Stock
  List/Users — so it can pick up the same in-memory `"use client"`
  pattern as those, no URL params needed.
- **Activity** (`app/(dashboard)/activity/page.tsx`, `lib/activity.ts`)
  is different on purpose: its own docstring and `AuditLogFilters.q`'s
  comment both say filtering stays server-side (`ilike`, plain GET form)
  specifically because `audit_log` is "much larger, append-only" —
  unlike every other table above, there's no bulk-fetch to begin with.
  Respecting that: sort state lives in the URL (`?sort=&dir=`), exactly
  like the existing `?itemId=&actorId=&action=&q=` filters, not in
  client state. Concretely, `listAuditLog`'s query already fetches every
  filtered row into the server process with no `.range()`/`.limit()`
  (it has to, to render them all) — so the sort itself can be a plain
  `Array.prototype.sort()` on `entries` inside the Server Component,
  *after* `actorNamesById` is built, covering all four columns
  (including **User**, whose display name only exists after that
  separate `profiles` lookup — it can't be pushed into the Supabase
  `.order()` call at all). This adds zero client JS and zero extra
  queries; it only reorders an array already in server memory about to
  be rendered.
- Activity's filter `<form method="get">` only submits its own four named
  fields (`q`, `itemId`, `actorId`, `action`). Submitting it will not
  carry forward a `sort`/`dir` currently in the URL (no hidden inputs for
  them), so filtering while sorted silently resets to the default sort.
  Documented here as an accepted limitation, not solved — adding hidden
  inputs to preserve it is a trivial follow-up if it turns out to bother
  anyone, not a correctness bug.

## Constraints / findings — debounce & loading feedback

- No debounce exists anywhere today — all 5 search boxes filter on every
  keystroke via `useMemo`. Harmless at today's scale, but once the same
  derived array also gets sorted on every keystroke (this design's own
  change), there's more reason to stop recomputing on every character.
- Every route already has a `loading.tsx` built from
  `components/skeletons.tsx`'s shared pieces (`TableSkeleton`,
  `ReportsSkeleton`, etc. — see `app/(dashboard)/activity/loading.tsx`,
  `app/(dashboard)/reports/loading.tsx`). Activity's sort-header clicks
  are real page navigations (new `?sort=&dir=` query params, same
  mechanism as its existing filter form), so Next's existing Suspense
  boundary already shows that skeleton automatically during the round
  trip — **no new code needed for Activity's loading state.**
- The other six tables (including Reports, per this design) sort
  in-memory and synchronously — there is no network round trip and
  nothing actually loads when a header is clicked or a search box is
  typed into. A skeleton there would be manufacturing a fake "loading"
  moment for work that already happened; not worth adding.
- `report-table.tsx`'s drill-down links already establish a precedent for
  this app's "something's in flight" visual language:
  `has-[[data-pending=true]]:pointer-events-none
  has-[[data-pending=true]]:opacity-60`, driven by `useLinkStatus` via
  `PendingLabel`. The debounce window is a different mechanism (a
  `setTimeout`, not a navigation), but the same dim/`opacity-60` look is
  the natural reuse for "an update is pending" here too.

## Design — debounce & loading feedback

- New shared hook, `lib/use-debounced-value.ts`: `useDebouncedValue(value,
  delayMs = 200)` → returns `value` delayed by `delayMs` of no changes
  (standard trailing-debounce via `useEffect` + `setTimeout`).
- Each of the 5 search-box tables keeps its raw `query` state exactly as
  today (so the `<Input>` itself never lags), but changes its `useMemo`
  filter (and, per the sorting design above, the `useSortableData` input)
  to depend on `useDebouncedValue(query)` instead of `query` directly.
- While `query !== debouncedQuery` (i.e. a recompute is pending), the
  table/card list gets `opacity-60 transition-opacity` — the same visual
  weight as the existing pending-link convention, just driven by the
  debounce flag instead of `useLinkStatus`. No skeleton swap, no layout
  shift — the current rows stay on screen, just dimmed, until the
  debounced value catches up.
- Activity and the other purely-synchronous tables get no changes here
  beyond what the sorting design already gives them (Activity's existing
  `loading.tsx` already covers its only real round trip).

## Approaches considered

- **(Picked) One shared sortable-header piece, reused everywhere.** A
  small presentational header (icon + `aria-sort`) with two thin
  wrappers: a `"use client"` button version for the six in-memory tables
  (backed by one shared `useSortableData` hook), and a plain anchor/
  `Link` version for Activity's URL-param sort. Sort logic is written
  once; each table file wires up its own columns.
- **Rejected: bespoke sort state copy-pasted into all 7 files.** Faster
  to start, but 7 near-identical copies of the same compare-and-toggle
  logic, with more drift risk over time (one table's sort silently
  behaving differently from another's).
- **Rejected: a table/data-grid library.** Would also solve this, but is
  a large dependency and a rendering-model change for what's a small,
  mechanical amount of logic layered onto markup that already works.

## Design

### Shared pieces (new)

- `components/sortable-header.tsx`:
  - `SortIcon({ direction }: { direction: "asc" | "desc" | "none" })` —
    the three-state lucide icon (`ArrowUp`/`ArrowDown`/`ArrowUpDown`),
    muted color when `"none"`.
  - `SortButtonHeader` (`"use client"`-safe, a real `<button
    type="button">` inside the `<th>`, for the six in-memory tables) —
    props: `label`, `active` (bool), `direction`, `onClick`. Sets
    `aria-sort` on the parent `<th>`.
  - `SortLinkHeader` (no `"use client"` needed — a `<Link>` inside the
    `<th>`, for Activity only) — same visual props, but takes `href`
    instead of `onClick`.
- `lib/use-sortable-data.ts` (`"use client"`): `useSortableData(rows,
  { defaultKey, defaultDirection, accessors })` → `{ sorted, sortKey,
  direction, toggle(key) }`. `accessors` is a `Record<columnKey, (row) =>
  string | number>` so each table supplies how to pull a comparable value
  per column (e.g. Reports' label column accessor returns the row's
  index, not `row.label`; Stock List's cost columns fall back to `-1` or
  similar for `undefined` so unpriced rows sort predictably to one end).
  `toggle` flips `asc ↔ desc` when called with the already-active key,
  otherwise switches to that key ascending.

### Per-table wiring

| Table | Sortable columns | Default |
|---|---|---|
| Items (`items-table.tsx`) | SKU, Name, Category, Vehicle, Unit, Qty on hand | Name asc |
| Batches (`batches-table.tsx`) | Date, Received, Remaining, Unit cost (when shown), Source | Date asc |
| Movements (`movements-list.tsx`) | Date, Type, Qty, Note, Status | Date desc |
| Stock List (`stock-list-table.tsx`) | SKU, Name, Category, Vehicle, Qty on hand, Unit, Unit cost/Inventory value (when shown) | Name asc |
| Users (`users-table.tsx`) | Name, Email, Role, Status | Name asc |
| Reports (`report-table.tsx`) | Label (sorts by position, see above), Purchases, Stock-out value | position asc (today's order) |
| Activity (`activity/page.tsx`) | Date, User, Action, Summary | Date desc |

Each client table swaps its existing `filteredRows` (already filtered by
the search box) to also run through `useSortableData`, in that order —
search first, then sort — and feeds the result to both the `<table>` and
its `md:hidden` card list, so both breakpoints agree. `report-table.tsx`
gains `"use client"` and the same hook; nothing else about it (the
drill-down `<Link>`/`PendingLabel` behavior) changes. Action-only columns
(Movements' void button, Users' deactivate/reactivate button, Reports'
chevron-link styling) keep their current plain, non-interactive `<th>`.

Activity's header links build their `href` by taking the current
`searchParams`, overwriting only `sort`/`dir`, and keeping `itemId` /
`actorId` / `action` / `q` as-is; the page reads `sort`/`dir` (defaulting
to `createdAt`/`desc`) and sorts `entries` right before the `.map(...)`
that builds rows, as described in Constraints.

## Left to the builder

- Exact column→accessor wiring per table (straightforward given the
  table above and each row type already shown in the files read for this
  design).
- Whether `useSortableData` takes the full `accessors` map up front or a
  single accessor function switched on the active key — equivalent,
  implementation detail.
- Minor visual spacing of the icon inside each table's existing header
  cell padding (`py-1 pr-3` vs `py-2`, etc. already differ table to
  table) — match each table's own existing header cell style, don't
  introduce a new one.
- Whether to add hidden `sort`/`dir` inputs to Activity's filter form to
  close the "filtering resets sort" gap noted above — not required by
  this design; fine to leave as a known limitation unless it's raised
  again.
