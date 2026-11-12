# Auto Batt Inventory System — Design Document

## Intent & Why

Auto Batt (an automotive maintenance, repair & service shop) currently tracks
inventory in two Excel files: one sheet per month, with each item's own row
and IN/OUT columns for each day (1–31), carrying an ending total forward as
next month's opening balance. A second, near-identical file adds unit price.

The core pain point: when the same item is bought at different prices over
time (e.g. 10 batteries at ₱1000 in June, 10 more at ₱1500 in July), there is
no reliable way to know which batch a given sale came from. The owner loses
track of which units are already sold, so they can't trust the cost figures
attached to remaining stock.

This system replaces both Excel files with a single web app that tracks
inventory by **batch**, so the cost of every unit in stock (and every unit
sold) is always known with certainty — first batch in, first batch out
(FIFO). The system's scope is cost and quantity tracking only. Profit/P&L
stays with the shop's accountant, who works from receipts at month end.

## Goals

- Always know, with certainty, which cost-batch any unit of stock belongs to.
- Let both the owner and their assistant record daily IN/OUT from a browser,
  on desktop or phone, replacing the Excel workflow with something at least
  as fast.
- Give the owner a daily email summary of the day's activity and any
  low-stock items.
- Let cost/price visibility be hidden from the assistant by default, with an
  owner-controlled toggle to reveal it.
- Provide a printable / exportable (PDF, Excel) current stock list.
- Give the owner a clear record of who changed what and when, across items,
  stock entries, corrections, and settings.
- Run entirely on free tiers (Vercel, Supabase, Resend).

## Non-Goals

- No net profit, margin, or P&L calculation — the accountant computes this
  separately from receipts.
- No separate handling for returns, damaged stock, or shrinkage in v1 —
  only purchases (IN) and sales (OUT) are tracked, matching the current
  Excel workflow. If this is needed later, it can be added as an additional
  entry type without disrupting what's built here.
- No selling-price / point-of-sale functionality. This is a cost and
  quantity ledger, not a sales system.
- No multi-location / multi-branch support (single shop only).
- No barcode scanning hardware integration — "SKU" means a cleaner,
  structured text code, not a scannable barcode.
- No native mobile app — responsive web only, works in a phone browser.
- No automatic reordering or supplier management.
- No migration of historical day-by-day Excel movement data (see Migration
  below) — only current totals carry forward.

## Anti-Goals

(Things that would make this a failure even if it technically works.)

- The assistant sees cost/profit data the owner wanted hidden.
- Recording a daily IN/OUT is slower or more cumbersome than typing a number
  into an Excel cell.
- A sale is allowed to oversell (go negative) without the user noticing.
- The migration silently loses or misrepresents current stock quantities.

## Constraints

- Scale: ~100–150 items, single shop, starts with 2 users (owner, assistant)
  but the design shouldn't block adding more staff later.
- Currency: Philippine pesos (₱). Timezone: Asia/Manila (relevant for "end of
  day" email timing).
- Must run on free tiers: Vercel (Hobby), Supabase (Free), Resend (Free —
  100 emails/day is far more than the 1/day needed here).

## What Was Decided in Conversation

- **FIFO batch tracking, not average cost.** Every delivery (IN) creates a
  new batch with its own quantity and unit cost. Every sale (OUT) draws from
  the oldest unsold batch first, automatically. This directly fixes the
  original pain point.
- **Both owner and assistant can log in and add new items**, on desktop or
  phone, no app install.
- **Cost/price visibility is role-gated and owner-togglable.** Default:
  hidden from the assistant. The owner can flip a setting to reveal it.
- **No profit/margin calculation anywhere in the system.** The accountant
  handles that from receipts at month end; this system only needs to report
  accurate cost and quantity.
- **Items are organized by category** (e.g. batteries, oil, filters, tires),
  mostly counted in whole pieces.
- **SKU is a cleaner/more structured version of the existing scheme**
  (e.g. `AB-001`), not a scannable barcode.
- **Low-stock warning** per item, included in the daily email rather than as
  a separate alert channel.
- **Daily email to the owner** summarizing: which items had IN/OUT activity
  that day (item + quantities), and which items are currently low on stock.
  No profit numbers.
- **Historical Excel data will be loaded in, but only as current totals.**
  The owner does not have a record of which remaining units belong to which
  historical batch/price — only total quantity on hand is known today. So
  migration creates **one "opening stock" batch per item** (today's total
  quantity, tagged with the last known unit cost), and the system is fully
  batch-accurate for everything from launch day forward.
- **Printable / exportable current stock list**, with PDF and Excel export,
  respecting the same cost-visibility rule as the rest of the app.
- **Corrections are void + re-enter, never a silent edit.** A mistaken entry
  is reversed (restoring the correct stock/batch state) and the correct
  entry is added fresh, preserving a clean audit trail. This prevents the
  exact batch-tracking confusion the old Excel system suffered from
  creeping back in through "just edit the typo."
- **Quantities are stored as decimals**, not integers, so a future
  fractional-unit item (e.g. oil by the liter) never requires a schema
  change — this doesn't change how whole-piece items are entered today.
- **New staff accounts are added via a simple in-app, owner-only "Add
  User" screen**, rather than requiring the owner to use the Supabase
  dashboard directly.
- **An audit log records who did what, and when** — item/SKU changes, every
  IN/OUT and void, settings changes (e.g. toggling cost visibility), and
  user management. Visible to the owner only, consistent with other
  sensitive data in the system.
- **Branding**: use the provided Auto Batt logo (green + near-black
  wordmark); build a modern, clean dashboard around that palette.
- **Stack**: Next.js on Vercel, Supabase (Postgres + Auth) for the database
  and login, Resend for the daily email — all free tier.

## Technical Design (builder's calls — flag during implementation if any of
these need to change)

### Data model

All quantity columns use a numeric/decimal type (not integer), so an item
that's ever tracked in fractional units (e.g. oil by the liter) doesn't
require a schema change later — whole-piece items are simply entered as
whole numbers.

- `items` — id, sku (unique), name, category_id, unit (default "pcs"),
  low_stock_threshold (nullable, falls back to a global default), is_active,
  created_by, created_at.
- `categories` — id, name. Simple lookup table so categories can be renamed
  without touching every item.
- `batches` — id, item_id, batch_date, qty_received, qty_remaining,
  unit_cost, source (`purchase` | `opening_stock`), note, created_by,
  created_at. `qty_remaining` is decremented as sales draw from it.
- `stock_movements` — id, item_id, type (`IN` | `OUT`), quantity,
  movement_date, created_by, created_at, note, voided_at (nullable),
  voided_by (nullable), reverses_movement_id (nullable, set on a voiding
  entry to point back at what it reverses). An `IN` movement links to the
  batch it created. This table is the day-by-day ledger (replacing the
  Excel day columns) and drives the daily email.
- `movement_allocations` — id, movement_id (an `OUT` movement), batch_id,
  qty_allocated, unit_cost_at_allocation. Records exactly which batch(es) a
  sale drew from — this is what makes a sale's cost auditable after the
  fact.
- `app_settings` — single row: `show_cost_to_assistant` (bool, default
  false), `default_low_stock_threshold`, notification email recipient(s),
  daily email send time.
- `profiles` — id (matches Supabase auth user), full_name, role (`owner` |
  `assistant`).
- `audit_log` — id, actor_id, action (e.g. `item.created`, `item.updated`,
  `movement.created`, `movement.voided`, `settings.updated`,
  `user.created`, `user.role_changed`), entity_type, entity_id, summary
  (human-readable one-liner, e.g. "Voided OUT of 2x AB-001"), details (JSON
  snapshot of what changed), created_at.

### Corrections (void + re-enter)

Movements are never edited or hard-deleted once created — the ledger is
append-only, so the audit trail always matches what actually happened.
Correcting a mistake is a two-step action exposed to the user as a single
"Void" button on a movement:

- **Voiding an IN**: marks the movement voided and reverses its batch —
  only allowed while the batch's `qty_remaining` still equals
  `qty_received` (i.e. nothing from it has been sold yet). If some of it
  has already been sold, the UI explains this and the owner/assistant
  re-enters a corrected adjustment by hand rather than risking a partial,
  inconsistent reversal.
- **Voiding an OUT**: walks its `movement_allocations` and restores each
  allocated quantity back onto the corresponding batch's `qty_remaining`,
  then marks the movement voided. This is always safe, since restoring
  stock never conflicts with later sales (it only ever increases
  available quantity).
- A voided movement stays visible in history (struck through / clearly
  marked), rather than disappearing, so nothing is ever silently erased.
- The correct entry is then added as a normal new IN or OUT.

Current on-hand quantity for an item = sum of `qty_remaining` across its
batches. Current inventory value = sum of `qty_remaining * unit_cost`.

### FIFO logic

Implemented server-side as a single database transaction (a Postgres
function with row locking) to stay correct if two people record activity at
the same time:

- **Recording IN**: insert a new batch (qty_received = qty_remaining = N,
  given unit cost and date), insert a matching `stock_movements` row.
- **Recording OUT**: lock and walk the item's batches ordered oldest-first,
  allocating from each until the requested quantity is satisfied, writing
  one `movement_allocations` row per batch touched and decrementing
  `qty_remaining`. If total available stock is less than requested, the
  transaction is rejected with a clear "insufficient stock" error — oversell
  is blocked by default rather than silently allowed.

### Daily email

- A Vercel Cron job triggers an API route once daily (default 8:00 PM
  Asia/Manila, adjustable in `app_settings`).
- It gathers: every item with IN/OUT movement that day (with quantities),
  and every item at or below its low-stock threshold.
- Sent via Resend to the owner's registered email address(es). If there was
  no activity and nothing is low, the email can be skipped to avoid noise
  (flag to confirm with the owner once live — easy to flip to "always send"
  if they'd rather get a confirmation every day).

### Stock list, print & export

- A stock list view: SKU, name, category, quantity on hand, and (if the
  viewer's role/setting allows) unit cost and inventory value.
- Browser print view with a clean print stylesheet and the Auto Batt logo in
  the header.
- Export to PDF (generated server-side, e.g. via `@react-pdf/renderer`,
  which runs fine within Vercel's free-tier function limits) and export to
  Excel (via a library like `exceljs`). Both exports strip cost columns for
  a viewer who shouldn't see them.

### Auth & roles

- Supabase Auth, email/password. Two roles: `owner`, `assistant`.
- Cost-sensitive fields (unit cost, inventory value) are filtered both at
  the database level (Postgres RLS / a view) and in the application layer,
  based on the viewer's role and `app_settings.show_cost_to_assistant` — so
  hiding cost isn't just a UI toggle, it's enforced where the data is read.
- An owner-only "Add User" screen creates new staff accounts (email,
  temporary password, role) via Supabase's admin API from a server route —
  the owner never needs to touch the Supabase dashboard to add a hire.

### Audit log

- Every mutating action writes an `audit_log` row as part of the same
  transaction that makes the change — item create/edit, every IN/OUT
  (including voids, which also record what they reversed), settings
  changes, and user management. This guarantees the log can never drift out
  of sync with what actually happened.
- A single "Activity" screen, visible to the owner only, lists these
  entries newest-first with filters by item, user, and action type — e.g.
  "who changed the low-stock threshold on AB-001" or "what did the
  assistant do today."
- The log is append-only like the rest of the ledger — nothing in it is
  ever edited or deleted.

### Branding

- Palette sampled from the provided logo: a mid-green primary accent and a
  near-black for text/ink, on a clean white/light background.
- Modern dashboard layout: sidebar with the Auto Batt logo, card-based
  summary stats (total items, low-stock count, today's IN/OUT), clean data
  tables for items and batch history. Tailwind CSS + shadcn/ui components.

### Migration

- A one-time "Opening Stock Import" screen (CSV/Excel upload or manual
  entry grid): SKU, item name, category, quantity on hand, last known unit
  cost, optional low-stock threshold.
- For each row, the system creates the item and one `opening_stock` batch
  dated at import time. No day-by-day historical movements are imported.

## What's Left to the Builder

- Exact hex values sampled from the logo file.
- Final SKU format convention (keep `AB-###` as-is vs. add a category
  prefix) — propose a default, confirm with the owner during build.
- Default low-stock threshold value.
- Exact daily email send time and whether "no activity" days still send an
  email.
- PDF/Excel library choice (recommendations above are a reasonable default).
