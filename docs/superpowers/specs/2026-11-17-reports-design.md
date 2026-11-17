# Reports — design

## Intent / why

The owner wants to see money moving through the shop — not just quantities
(which Calendar already shows) — as totals for a day, a month, or a year,
so they can check cash flow on demand instead of eyeballing batches. "Total
amount" was confirmed to mean **both** of the two cost-side numbers this
app can actually produce (see Non-goals: there is no selling price in the
schema, so this is never a revenue report):

- **Purchases** — money spent restocking (`qty × unit_cost` on real
  purchase batches).
- **Stock-out value** — the FIFO cost of whatever stock left the shelf
  (`qty_allocated × unit_cost_at_allocation` from `movement_allocations`).

## Goals

- A new page showing Purchases and Stock-out value totals for a selected
  day, month, or year, each navigable forward/back like Calendar already
  is.
- A breakdown table under the totals: days-in-month when viewing a month,
  months-in-year when viewing a year.
- Visible to both roles in the nav. Amounts follow the existing
  `canSeeCost` rule (`lib/permissions.ts`) — owner always, assistant only
  when `app_settings.show_cost_to_assistant` is on — the same soft gate
  Items and Stock List already use, not the hard owner-only gate Activity/
  Settings/Users/Import use.

## Non-goals

- No revenue or profit. Nothing in the schema records a selling price;
  this page only ever reports the cost side.
- No per-item breakdown. Items/Stock List and the item detail page already
  show cost per item; Reports is shop-wide totals only.
- No export (Excel/PDF). Stock List already has that; adding it here is a
  separate request if wanted later.
- Read-only — no editing or voiding from this page, same as Calendar.

## Anti-goals

- An assistant must never be able to read a real cost number through
  Reports when `canSeeCost` would hide it on Items/Stock List. If the
  implementation finds a path around that check (e.g. by querying cost
  data before checking the gate), it has failed regardless of what the UI
  renders.

## Constraints / findings (from reading the code, not decisions)

- `movement_allocations` — the only place OUT-side cost lives
  (`unit_cost_at_allocation`) — currently has SELECT revoked from both
  `anon` and `authenticated` (migration 0011), **and no `service_role`
  grant either** (0011/0014 both left it out because nothing read it
  yet). Reports is the first real reader, so a small new migration has to
  grant `service_role` SELECT on it — exactly what 0011/0014's own
  comments say to do "if and when a real service-role read path exists."
- `batches.unit_cost` already has a session-safe read path:
  `batches_for_viewer`, which nulls cost via `can_see_cost(auth.uid())`.
  No new grant needed there.
- `batches_for_viewer`'s gating does **not** work from the admin
  (service-role) client: `auth.uid()` is `null` for that client, so the
  view falls through to the global toggle only, regardless of who the
  report is actually being built for. So the admin client is used **only**
  for the Stock-out-value side (which has no session-safe path at all),
  and only after the page has already confirmed `canSeeCost` for the real
  signed-in viewer. Purchases stays on the normal session client, which
  resolves cost correctly for whoever is actually logged in.
- Opening-stock imports create an `IN` stock_movements row too (same as a
  real purchase). Counting those as "Purchases" would spike whichever
  month the shop's opening inventory was imported. Purchases is therefore
  defined as `batches_for_viewer.source = 'purchase'` only, excluding
  `'opening_stock'` — confirmed with the owner: opening stock should not
  count toward Purchases.
- Voided movements are excluded on both sides (`voided_at is null`).
  Voiding an OUT does not delete its `movement_allocations` rows
  (confirmed in `void_movement`'s SQL) — the join must filter through the
  movement's `voided_at`, not just read the allocations table alone.

## Approach (already decided)

A new `/reports` page, not an extension or rename of Calendar. Calendar is
deliberately cost-free today so it stays safe for assistants regardless of
the cost toggle; folding money into it would force a `canSeeCost` check
into every cell of a page that currently needs none, for a feature that's
conceptually unrelated to "what moved today." Reports sits next to
Items/Stock List in spirit (cost-bearing, soft-gated) rather than next to
Activity/Settings (hard owner-only).

## Design

**Page**: `app/(dashboard)/reports/page.tsx`. Nav entry added to
`SHARED_LINKS` in `components/sidebar.tsx`, right after Calendar — not
`OWNER_LINKS`, since an assistant with the toggle on should see it there
too, matching how Items/Stock List are shared links despite carrying cost.

**Gating**: resolve `role` and `settings` the same way `items/page.tsx`
does today. If `!canSeeCost(role, settings)`, render a short message
("Ask the owner to turn on cost visibility in Settings to see this page")
and stop — no cost query runs at all for a viewer who can't see cost.

**View modes** — URL-driven, same plain-`<Link>` pattern Calendar uses (no
client JS required to navigate), `?view=day|month|year` plus the relevant
date params, defaulting to `month`/today (Asia/Manila, via `manilaToday`):

- **Day** (`?view=day&date=YYYY-MM-DD`): Purchases and Stock-out value for
  that one date, prev/next-day arrows.
- **Month** (`?view=month&year=&month=`): the same two totals for the
  whole month, plus a table with one row per calendar day in the month —
  every day, not just the ones with activity, each showing purchases and
  stock-out value (zero where there's none) — prev/next-month arrows,
  mirroring Calendar's month nav.
- **Year** (`?view=year&year=`): the same two totals for the whole year,
  plus a 12-row Jan–Dec table, same all-rows-regardless-of-activity
  treatment — prev/next-year arrows.

  (Builder-check flagged the month table as originally "non-zero rows
  only" while the year table was "all 12 rows" — settled here as a single
  rule for both: always render every row for the period, zero where
  there's no activity. This matches Calendar's own grid, which always
  draws every day cell and simply leaves it bare when nothing happened.)

A small tab control switches view mode while keeping the current date
context (e.g. switching Month → Day lands on "today" if the current month
is the real current month, otherwise the 1st of the viewed month).

**Data layer**, new `lib/reports.ts`:

- `getPurchasesByDate(supabase, startDate, endDate)` — session client.
  Bulk-fetches `IN` `stock_movements` in range (`voided_at is null`),
  bulk-fetches their batches via `batches_for_viewer`, keeps only
  `source = 'purchase'`, sums `quantity × unit_cost` grouped by
  `movement_date`. Returns `Map<string, number>`.
- `getStockOutValueByDate(adminSupabase, startDate, endDate)` — admin
  client, called only after the page's gate check passes. Bulk-fetches
  `OUT` `stock_movements` ids+dates in range (`voided_at is null`),
  bulk-fetches their `movement_allocations`, sums
  `qty_allocated × unit_cost_at_allocation` grouped by the movement's
  `movement_date`. Returns `Map<string, number>`.
- Thin composition helpers for day/month/year that call both maps and
  shape the result (a single date's pair of numbers; a day-map rolled into
  a month table; a month-map rolled into a year table). Exact function
  signatures are left to the builder.

**Migration**: one new file (next number after the current latest) that
grants `service_role` SELECT on `movement_allocations` only — written with
the same header-comment discipline as 0010/0011/0014 (what it's for, why
it's safe, what it deliberately doesn't touch).

**Tests**: `tests/lib/reports.test.ts` mirroring `tests/lib/calendar.test.ts`'s
seeding/assertion style — seeded batches/movements asserting totals
exclude opening-stock and voided rows, plus a case confirming an assistant
with the toggle off gets the gated result and triggers no cost query.
Match whatever page-level test coverage (if any) existing dashboard pages
have.

## Left to the builder

- Exact lucide icon for the nav entry (something report/money-shaped —
  candidates: `BarChart3`, `Wallet`, `Receipt` — pick one that doesn't
  collide with an icon already in use).
- Currency formatting/table styling — reuse `formatCurrency` from
  `stock-list-table.tsx` rather than reinventing it.
- Exact function names/shapes inside `lib/reports.ts`, and whether day/
  month/year each get their own exported function or share one
  range-based function the page calls three different ways.
