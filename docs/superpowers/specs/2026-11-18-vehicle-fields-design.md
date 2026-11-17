# Vehicle fields on items, Make list, and item editing — design

## Intent / why

The shop sells parts (batteries especially) that often fit specific
vehicles. The owner wants to record which Make/Model/Variant/Year an item
fits, so staff can find the right item by searching for a car (e.g.
"Toyota") rather than only by SKU/name/category — and a "General"
category value for items that aren't tied to a specific vehicle at all
(generic tools, universal accessories).

Confirmed in conversation:

- **Make** is a managed list, like Categories — a small, stable set of
  values worth keeping consistent, since good Make search was the whole
  point of asking for this.
- **Model** and **Variant** are free text — too many real-world values to
  practically curate, and search already works fine on free text via
  case-insensitive substring matching (the same technique Items/Stock
  List search already use).
- **Year** is a single year, not a range.
- **"General"** is just a normal category value, independent of the
  vehicle fields — no coupling, no validation tying them together.

## Goals

- Items can optionally carry: a Make (from a managed list), a Model
  (free text), a Variant (free text), and a Year (a single number).
- A "Makes" list exists, managed the same way Categories already is: any
  signed-in user can view and add; no rename/delete (YAGNI, matching
  Categories' own current scope).
- Items can be **edited** — this doesn't exist at all today (only
  "Add item" exists; the item detail page has no edit affordance). Since
  the request was "adding/editing," this is in scope, not an add-on.
- Searching "Toyota" (or any Make/Model/Variant/Year substring) on the
  Items list surfaces matching items. Stock List gets the same treatment,
  since it shares the exact same row-building/search pattern as Items
  today and letting them drift (searchable on Items, not on Stock List)
  would be a confusing inconsistency to introduce.
- A match is visibly confirmed, not just findable: the Items list and
  Stock List both gain a compact "Vehicle" column (confirmed in
  conversation, in response to the builder check flagging this as
  unspecified) — so a search for "Toyota" shows *why* each result
  matched, rather than requiring a click into the item to find out.
- Model/Variant text inputs suggest previously-used values (HTML
  `<datalist>`, no new table) to nudge spelling consistency without
  forcing it.

## Non-goals

- No managed list for Model or Variant — explicitly rejected in favor of
  free text, for the reasons above.
- No year *range* (from/to) — explicitly rejected in favor of a single
  year.
- No coupling between "General" category and the vehicle fields (no
  auto-clearing, no validation that General items can't have a Make) —
  explicitly rejected.
- No changes to the opening-stock Import flow (`lib/import.ts`) — imported
  items simply get `null` for the new columns, same as any other optional
  field. Vehicle data entry via import is a separate request if wanted.
- No Vehicle column on the PDF/Excel exports (`app/api/stock-list/pdf`,
  `app/api/stock-list/excel`) in this pass — my own call, to keep scope to
  what was actually asked (search + list visibility, confirmed in
  conversation) rather than also redesigning both export layouts' column
  counts. Revisit as a separate request if the owner wants it printed/
  exported too.
- No rename/delete for Makes, matching Categories' own current scope.

## Constraints / findings (from reading the code)

- There is currently **no edit capability for items at all** —
  `app/(dashboard)/items/new/page.tsx` is the only write path besides
  stock in/out, and `app/(dashboard)/items/[id]/page.tsx` has no edit
  form. Building one is this design's second-largest piece of work.
- The item detail page currently doesn't even display the item's
  **category** — it shows only name, SKU, and qty on hand. Adding Make/
  Model/Variant/Year there with no Category would be a strange half
  picture, so Category display is added alongside them (a small, directly
  motivated addition, not scope creep).
- `categories` already has a "no category selected" fallback
  (`buildStockListRows` renders `"Uncategorized"` when `category_id` is
  null) — confirming "General" is meant as a deliberate choice an owner
  makes, distinct from "nobody set one yet."
- Items/Stock List search is already case-insensitive substring matching
  done client-side in the browser (`items-table.tsx`, `stock-list-table.tsx`),
  over data already bulk-fetched server-side — no new search
  infrastructure is needed, only more fields on the same rows.
- `buildStockListRows` (`lib/stock-list.ts`) is the single shared row
  builder behind the Items list, the Stock List, and both its PDF/Excel
  exports. Extending it once with Make/Model/Variant/Year naturally
  reaches all of them with one change.
- `CreateItemInput`/test helpers across the suite call `createItem` with
  today's fields; adding Make/Model/Variant/Year as **optional** fields
  keeps every existing caller and test working unmodified.

## Design

### Schema

**New table `car_makes`** (new migration), identical shape and RLS to
`categories`:

```sql
create table car_makes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table car_makes enable row level security;

create policy "car_makes_select_authenticated" on car_makes for select to authenticated using (true);
create policy "car_makes_insert_authenticated" on car_makes for insert to authenticated with check (true);
```

No update/delete policy — mirrors Categories' own current scope exactly
(renaming/deleting a make isn't supported yet, same YAGNI reasoning
`0004_categories_rls.sql`'s own comment already states for categories).

**New columns on `items`** (new migration):

```sql
alter table items
  add column make_id uuid references car_makes (id),
  add column model text,
  add column variant text,
  add column year integer;
```

All four nullable — an item with no vehicle association (a "General"
item, or simply one nobody's gotten to yet) leaves them all `null`. No
check constraint on `year`'s range: matches this project's existing
looseness on numeric/date inputs elsewhere (e.g. Calendar/Reports' year
params have no server-side range enforcement either) — client-side
`min`/`max` on the number input is enough.

### Data layer

- **`lib/car-makes.ts`** (new) — `createCarMake(supabase, actorId, name)`
  and `listCarMakes(supabase)`, a line-for-line mirror of
  `lib/categories.ts`'s `createCategory`/`listCategories`, including the
  `recordAudit` call (`action: "car_make.created"`) and unique-name
  handling via `isUniqueViolation`.
- **`lib/items.ts`**:
  - `Item` gains `make_id: string | null`, `model: string | null`,
    `variant: string | null`, `year: number | null`.
  - `CreateItemInput` gains the same four fields, all optional
    (`makeId?: string | null`, `model?: string | null`,
    `variant?: string | null`, `year?: number | null`) — existing callers
    (every test file, the current `addItem` action) keep compiling and
    behaving identically without passing them.
  - New `UpdateItemInput` (same shape as `CreateItemInput` but every field
    optional, since an edit form submits the full set each time regardless)
    and new `updateItem(supabase, actorId, itemId, input)`, mirroring
    `createItem`'s shape: updates the row, records an `item.updated`
    audit entry (summary e.g. `` `Updated item ${sku}` ``), surfaces a
    duplicate-SKU violation the same way `createItem` does (so the edit
    page can reuse the exact same redirect-with-error pattern the add page
    already has).
  - New `listDistinctModelsAndVariants(supabase)` returning
    `{ models: string[]; variants: string[] }` — one bulk query
    (`select distinct model, variant from items`), feeding the two
    `<datalist>`s. Cheap at this catalog's scale; no caching needed.
- **`lib/stock-list.ts`**: `StockListRow` gains one new field,
  `vehicle: string`, built in `buildStockListRows` as
  `[makeName, item.model, item.variant, item.year].filter(Boolean).join(" ")`
  — or an em dash (`—`) when every part is empty — rather than four
  separate raw fields, since nothing on these two list pages needs
  Make/Model/Variant/Year individually; both the Vehicle column and the
  search predicate (below) read this one computed string, so what's
  searchable and what's displayed can never drift apart.
  `buildStockListRows`'s items query embeds `car_makes(name)` alongside
  the existing `categories(name)` embed, same pattern, one extra join,
  still one bulk query.

### UI

- **New `/makes` page** (`app/(dashboard)/makes/page.tsx` +
  `loading.tsx`), a line-for-line structural mirror of
  `/categories`'s page: a name input + "Add make" button, a plain list
  below, the same duplicate-name error handling.
- **Sidebar** (`components/sidebar.tsx`): new `SHARED_LINKS` entry
  `{ href: "/makes", label: "Makes", icon: ... }`, positioned right after
  Categories — both are shared, lookup-list management pages, so they
  belong next to each other in the nav the same way they'll belong next
  to each other conceptually.
- **`/items/new` (add form)**: adds, after Category — a Make `<select>`
  (same `<option value="">None</option>` + options pattern as the
  existing Category select), a Model text input with a `<datalist>`, a
  Variant text input with a `<datalist>`, and a Year number input
  (`type="number"`, loose `min`/`max`, optional). The page fetches
  `listCarMakes` and `listDistinctModelsAndVariants` alongside
  `listCategories`.
- **New `/items/[id]/edit` page** — doesn't exist today. Same form shape
  as "Add item," pre-filled with the item's current values via
  `defaultValue`, submitting to a new `updateItemAction` Server Action
  that calls `updateItem` and redirects back to `/items/[id]` on success,
  or back to the edit page with an error query param on a duplicate SKU
  (exact mirror of the add flow's own error-redirect shape). SKU stays
  editable (it's just a unique text column, not an immutable id — nothing
  elsewhere resolves old audit-log summaries live, so renaming a SKU
  doesn't retroactively corrupt history any differently than renaming an
  item's `name` already wouldn't).
- **`/items/[id]` (detail page)**: adds an "Edit" link/button near the
  header, and now displays Category, Make, Model, Variant, and Year
  (whichever are set) next to the existing SKU/qty line — the minimal
  display needed for the new fields (and the pre-existing missing
  Category) to actually be visible day to day, not just inside the edit
  form.
- **Search**: `items-table.tsx`'s and `stock-list-table.tsx`'s existing
  client-side filter predicates (`sku`/`name`/`category`, substring,
  case-insensitive) extend to also check `vehicle` — one more `||` clause
  each, same pattern, same data already fetched in bulk. Because `vehicle`
  concatenates Make/Model/Variant/Year, searching "2017" alone (no make
  typed) still matches on year with no extra predicate logic needed.
- **Vehicle column**: both tables' desktop `<table>` AND their separate
  mobile card markup (both components render each row twice, at
  different breakpoints — see Stock List/Items' existing split) gain one
  new "Vehicle" column/line rendering `row.vehicle` directly — e.g.
  "Toyota Vios 2017", "Toyota 2017" when Model/Variant are empty, or "—"
  when nothing is set, matching Category's own existing "show *something*,
  never a blank cell" convention (`"Uncategorized"`). PDF/Excel exports
  are explicitly out of scope for this column (see Non-goals).

## Left to the builder

- Exact lucide icon for the "Makes" nav link (something list/tag-shaped
  that doesn't collide with `Tags` already used for Categories — e.g.
  `Car` fits the domain well).
- `min`/`max` bounds on the Year input (e.g. 1980–current year + 1) —
  exact numbers are cosmetic guardrails, not a correctness requirement.
- Whether the Year `<datalist>`-equivalent exists too (the design above
  only specifies datalists for Model/Variant, since Year is a small
  bounded number range where a suggestion list adds little) — builder's
  call if it seems worth the extra query.
