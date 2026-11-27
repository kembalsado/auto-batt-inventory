# Fitment sidebar group + Models lookup table — design

## Intent / why

Two related asks from conversation:

1. The sidebar currently lists **Categories** and **Makes** as flat,
   unrelated top-level links (`components/sidebar.tsx`). Categories is an
   item attribute (unrelated to vehicles — `lib/categories.ts`, referenced
   via `items.category_id`); Makes is vehicle data. The ask: pull the
   vehicle-related entries together under a sidebar group, and add a
   **Models** management page next to Makes. Categories stays where it is.
2. Seed `car_makes` (and the new `car_models`) with real makes/models from
   the Philippine car market, so the app is useful out of the box instead
   of starting from an empty picklist.

Confirmed in conversation:

- The group is called **"Fitment"** (matches this codebase's own
  vocabulary — `item_fitments`, `FitmentTagEditor`, `formatFitment` —
  rather than inventing a new term).
- Categories is **not** part of this group; it stays a plain top-level
  link.
- The group is a non-navigable, expand/collapse header in the sidebar
  (not a page of its own), revealing **Makes** and **Models** as its two
  children, each a full CRUD page.
- **Approach A** for Models (see below): a managed `car_models` lookup
  table that feeds the fitment editor's Model `<datalist>` suggestions,
  filtered by the selected Make. `item_fitments.model` stays free text —
  this does **not** reverse the existing non-goal in
  `0022_item_fitments.sql` ("Model and variant deliberately stay free
  text ... rather than becoming lookup tables").

## Goals

- Sidebar: a "Fitment" group header that expands/collapses, containing
  Makes and Models. Auto-expands when the current route is one of its
  children (so a hard reload on `/models` doesn't land on a
  collapsed-looking sidebar with no visible active link).
- A new `car_models` table: each model belongs to exactly one make.
  Full CRUD, following the exact pattern `car_makes`/`categories`
  already use (open read/create, owner-only rename/delete, audit log,
  `LookupListTable`-based UI).
- The fitment editor's Model field keeps its current free-text +
  `<datalist>` behavior, but the suggestions come from `car_models`
  (filtered to the selected Make when one is set) instead of scraping
  whatever text already exists on past `item_fitments` rows.
- `car_makes` and `car_models` are seeded with a real, reasonably broad
  set of Philippine-market makes/models via migration, idempotently (safe
  to run against an environment that already has some of these rows from
  manual entry).

## Non-goals

- Reversing the `item_fitments.model`/`variant` free-text decision —
  `item_fitments` schema is untouched. No `model_id` FK, no backfill of
  existing free-text values.
- Managing **Variant** the same way — variant suggestions keep coming
  from existing fitment rows (`listDistinctVariants`, renamed from
  today's `listDistinctModelsAndVariants` once its model half is
  removed — see Design).
- Reassigning a model to a different make after creation. Rename
  (name only) + delete, exactly like Makes/Categories; got the make
  wrong, delete and re-add.
- Changing the `/makes` or `/categories` URLs. Only `/models` is new;
  nothing is renamed to live under a `/fitment/...` path — the sidebar
  grouping is purely a presentation change, not a routing change.
- A search box on the Models list (neither Makes nor Categories has one;
  same call as the earlier CRUD design).
- Exhaustive PH market coverage in the seed data — a broad, recognizable
  starting set that the owner can extend via the UI, not a complete
  registry of every trim ever sold.

## Constraints / findings (from reading the code)

- `car_makes` (`0016_car_makes.sql`, grants in `0018_car_makes_grants.sql`,
  update/delete RLS in `0019_categories_car_makes_update_delete_rls.sql`)
  is the exact twin to model: `{id, name, created_at}`, owner-only
  rename/delete via `is_owner(auth.uid())`, open select/insert. Unlike
  that table's history, `car_models` can get all four RLS policies and
  its grants in one migration from the start — the same "grants
  included from the start" call `0022_item_fitments.sql` already made
  (its own header explains why: Postgres checks base grants before RLS,
  and local dev's auto-grant hides a missing one).
- `lib/car-makes.ts` is the exact template for `lib/car-models.ts`:
  `create`/`list`/`update`/`delete`, each wrapping the write in
  `recordAudit` (actions `car_model.created`/`.updated`/`.deleted`).
  Deleting a make that still has models: **cascade** (`car_models.make_id
  references car_makes (id) on delete cascade`) — `car_models` has no
  downstream consumer that depends on surviving a make's deletion (no
  `item_fitments.model_id` FK exists), so there's nothing to protect by
  blocking the delete instead. This differs from `car_makes` itself,
  which has no cascade and blocks deletion while `item_fitments.make_id`
  still references it — that protection stays unchanged.
- `app/api/makes/[id]/route.ts` is the template for
  `app/api/models/[id]/route.ts`: 401 if signed out, 403 if caller's own
  `profiles.role !== "owner"`, then call the `lib/` function, mapping
  `isUniqueViolation` → "That name already exists." (scoped to the same
  make — see Review Focus) and any other error through `describeError`.
  No `isForeignKeyViolation` branch needed on delete: the cascade means
  deleting a model can't be blocked by a FK the way deleting a make or
  category can.
- Creation (`addMake`/`addCategory` in each `page.tsx`) goes through a
  Server Action, not a POST API route — `app/(dashboard)/models/page.tsx`
  follows the same shape, so no `app/api/models/route.ts` (collection
  route) is needed, only `[id]/route.ts` for PATCH/DELETE.
- `components/lookup-list-table.tsx` renders `{id, name}` rows with no
  room for a model's make. Rather than a second near-duplicate table
  component (rejected for the exact reason the original Makes/Categories
  design rejected it), add one optional field: `secondary?: string`,
  rendered as a muted line under the name. Makes/Categories pass nothing
  (`secondary` stays `undefined`, unchanged rendering); Models passes the
  make's name.
- `lib/item-fitments.ts`'s `listDistinctModelsAndVariants` computes both
  `models` and `variants` from existing `item_fitments` rows. Once
  `car_models` is the Model field's suggestion source, the `models` half
  is dead code with no caller. Shrink it to `listDistinctVariants(supabase):
  Promise<string[]>` (same body, minus the `models` set) — both call
  sites (`items/new/page.tsx`, `items/[id]/edit/page.tsx`) already
  destructure `{ models, variants }` from the combined call, so each
  becomes a single `listDistinctVariants(supabase)` call instead.
- `FitmentTagEditor`'s `modelSuggestions: string[]` prop becomes
  `models: { id: string; makeId: string; name: string }[]` — the full
  `car_models` list, passed down unfiltered by each item page (same as
  `makes` already is). The component itself filters to
  `models.filter((m) => m.makeId === makeId)` for the `<datalist>` when a
  Make is selected; when no Make is selected (`makeId === ""`), it shows
  every model name, deduped — there's no make context to scope by yet,
  and showing nothing would be a worse default than showing everything.
  This is suggestion-only, exactly like today: picking a Make never
  clears or validates whatever is already typed in the Model field.
- Sidebar (`components/sidebar.tsx`) has no concept of a nested group
  today — `SHARED_LINKS`/`OWNER_LINKS` are flat `NavLink[]`. This is the
  first nested entry, so there's no existing pattern to match beyond the
  flat `NavItem`'s active-state styling, which the group's children reuse
  as-is.

## Approaches considered

Covered in earlier conversation:

- **(Picked) Managed suggestion list, free text unchanged (Approach A).**
  `car_models` is a curated picklist feeding `<datalist>` suggestions;
  `item_fitments.model` stays free text.
- **Rejected: enforced per-make picklist (Approach B).** `item_fitments`
  gets a real `model_id` FK; Model becomes a hard `<select>` like Make.
  Reverses a deliberate, documented non-goal from the fitment-tags
  design, and requires backfilling/matching existing free-text values.
  Bigger change than what was asked for.
- **(Picked) Sidebar group as a non-navigable expand/collapse header.**
  Matches how the user described it; no new route needed for "Fitment"
  itself.
- **Rejected: "Fitment" as its own page with Makes/Models tabs.** Would
  avoid touching the sidebar's nav-rendering logic at all, but introduces
  a tabs pattern that doesn't exist anywhere else in this app, for no
  benefit over the one-time cost of teaching the sidebar about nesting.
- **(Picked) One shared `LookupListTable` with an optional `secondary`
  field**, over a second near-duplicate table component — same reasoning
  the original Makes/Categories CRUD design already used for exactly this
  choice.

## Design

### Migration 1 — `car_models` table, RLS, grants

New file, next migration number after `0024_drop_item_vehicle_columns.sql`
(`0025_car_models.sql`):

```sql
create table car_models (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references car_makes (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (make_id, name)
);

alter table car_models enable row level security;

create policy "car_models_select_authenticated" on car_models
  for select to authenticated using (true);
create policy "car_models_insert_authenticated" on car_models
  for insert to authenticated with check (true);
create policy "car_models_update_owner" on car_models
  for update to authenticated
  using (is_owner(auth.uid())) with check (is_owner(auth.uid()));
create policy "car_models_delete_owner" on car_models
  for delete to authenticated using (is_owner(auth.uid()));

grant select, insert, update, delete on car_models to authenticated;
grant select, insert, update, delete on car_models to service_role;
```

`unique (make_id, name)` — a model name only has to be unique within its
own make; "City" under Honda and a hypothetical "City" under another make
aren't a conflict. `isUniqueViolation` (`lib/errors.ts`) still applies
unchanged (same SQLSTATE `23505`); the API route's duplicate-name message
becomes "That model already exists for this make." to stay accurate.

### Migration 2 — seed data

New file, `0026_seed_ph_car_makes_and_models.sql`. Inserts are
`on conflict do nothing` against each table's existing unique constraint,
so re-running against an environment with some rows already present
(manually added makes, e.g.) is a no-op for those rows rather than an
error:

```sql
insert into car_makes (name) values
  ('Toyota'), ('Mitsubishi'), ('Honda'), ('Nissan'), ('Suzuki'),
  ('Ford'), ('Hyundai'), ('Kia'), ('Mazda'), ('Isuzu'),
  ('Chevrolet'), ('Subaru'), ('Geely'), ('MG'), ('Chery'), ('BYD')
on conflict (name) do nothing;

insert into car_models (make_id, name)
select m.id, v.name
from car_makes m
join (values
  ('Toyota', 'Vios'), ('Toyota', 'Wigo'), ('Toyota', 'Avanza'),
  ('Toyota', 'Veloz'), ('Toyota', 'Rush'), ('Toyota', 'Raize'),
  ('Toyota', 'Innova'), ('Toyota', 'Fortuner'), ('Toyota', 'Hilux'),
  ('Toyota', 'Corolla Altis'), ('Toyota', 'Camry'), ('Toyota', 'RAV4'),
  ('Toyota', 'Land Cruiser'), ('Toyota', 'Hiace'),

  ('Mitsubishi', 'Mirage'), ('Mitsubishi', 'Mirage G4'),
  ('Mitsubishi', 'Xpander'), ('Mitsubishi', 'Xpander Cross'),
  ('Mitsubishi', 'Montero Sport'), ('Mitsubishi', 'Strada'),
  ('Mitsubishi', 'Outlander'), ('Mitsubishi', 'Adventure'),
  ('Mitsubishi', 'L300'),

  ('Honda', 'Brio'), ('Honda', 'City'), ('Honda', 'Civic'),
  ('Honda', 'BR-V'), ('Honda', 'HR-V'), ('Honda', 'CR-V'),
  ('Honda', 'Accord'),

  ('Nissan', 'Almera'), ('Nissan', 'Navara'), ('Nissan', 'Terra'),
  ('Nissan', 'X-Trail'), ('Nissan', 'Patrol'), ('Nissan', 'Urvan'),

  ('Suzuki', 'Alto'), ('Suzuki', 'Celerio'), ('Suzuki', 'Swift'),
  ('Suzuki', 'Ertiga'), ('Suzuki', 'XL7'), ('Suzuki', 'Jimny'),
  ('Suzuki', 'APV'),

  ('Ford', 'EcoSport'), ('Ford', 'Everest'), ('Ford', 'Ranger'),
  ('Ford', 'Territory'), ('Ford', 'Explorer'),

  ('Hyundai', 'Accent'), ('Hyundai', 'Eon'), ('Hyundai', 'Reina'),
  ('Hyundai', 'Venue'), ('Hyundai', 'Creta'), ('Hyundai', 'Tucson'),
  ('Hyundai', 'Santa Fe'), ('Hyundai', 'Starex'),

  ('Kia', 'Picanto'), ('Kia', 'Soluto'), ('Kia', 'Seltos'),
  ('Kia', 'Sportage'), ('Kia', 'Carnival'),

  ('Mazda', 'Mazda2'), ('Mazda', 'Mazda3'), ('Mazda', 'CX-3'),
  ('Mazda', 'CX-5'), ('Mazda', 'BT-50'),

  ('Isuzu', 'D-Max'), ('Isuzu', 'mu-X'), ('Isuzu', 'Traviz'),

  ('Chevrolet', 'Spark'), ('Chevrolet', 'Trailblazer'),

  ('Subaru', 'XV'), ('Subaru', 'Forester'), ('Subaru', 'Outback'),

  ('Geely', 'Coolray'), ('Geely', 'Okavango'), ('Geely', 'Azkarra'),

  ('MG', 'MG5'), ('MG', 'ZS'), ('MG', 'RX5'), ('MG', 'One'),

  ('Chery', 'Tiggo 2'), ('Chery', 'Tiggo 5X'), ('Chery', 'Tiggo 7 Pro'),
  ('Chery', 'Tiggo 8 Pro'),

  ('BYD', 'Atto 3'), ('BYD', 'Dolphin'), ('BYD', 'Seal'), ('BYD', 'Song Plus')
) as v(make_name, name) on v.make_name = m.name
on conflict (make_id, name) do nothing;
```

### `lib/activity.ts`

Add `"car_model.created"`, `"car_model.updated"`, `"car_model.deleted"` to
the `ACTIONS` allow-list, same comment-per-entry convention the existing
`car_make.*` trio uses (`tests/lib/activity-actions.test.ts` greps this
list, so a missed entry fails a test rather than silently filtering the
Activity screen).

### `lib/car-models.ts` (new)

Twin of `lib/car-makes.ts`:

```ts
export interface CarModel {
  id: string;
  makeId: string;
  name: string;
  createdAt: string;
}

createCarModel(supabase, actorId, makeId, name): Promise<CarModel>
listCarModels(supabase): Promise<CarModel[]>   // all models, all makes, ordered by name
updateCarModel(supabase, actorId, id, name): Promise<CarModel>  // rename only, make is immutable
deleteCarModel(supabase, actorId, id): Promise<void>
```

Same shape as `car-makes.ts`: each write wrapped in `recordAudit`
(`car_model.created`/`.updated`/`.deleted`), thrown Postgres errors
propagate unhandled for the API route to classify. `listCarModels`
selects `*`, ordered by `name` — the Models page and the item pages both
want the full list (page groups/labels by make client-side; item pages
filter by make in `FitmentTagEditor`), so one unfiltered query serves
both, same as `listCarMakes` already does for a single table.

### `lib/item-fitments.ts`

Rename `listDistinctModelsAndVariants` → `listDistinctVariants`, dropping
the `models` half:

```ts
export async function listDistinctVariants(supabase: SupabaseClient): Promise<string[]>
```

Same body, `select("variant")` only, one `Set`, sorted array returned
directly (no wrapping object).

### `app/(dashboard)/items/fitment-tag-editor.tsx`

`FitmentTagEditorProps.modelSuggestions: string[]` →
`models: { id: string; makeId: string; name: string }[]`. Inside the
component, replace the `modelSuggestions.map(...)` datalist options with
a derived list:

```ts
const modelSuggestions = makeId
  ? models.filter((m) => m.makeId === makeId).map((m) => m.name)
  : Array.from(new Set(models.map((m) => m.name))).sort();
```

rendered into the existing `<datalist id="fitment-model-suggestions">`
exactly as today. Nothing else in the component changes — the Model
field is still a plain `<Input list="fitment-model-suggestions">`, free
text, unaffected by Make changing after the fact.

### `app/(dashboard)/items/new/page.tsx` and `.../items/[id]/edit/page.tsx`

Replace `listDistinctModelsAndVariants(supabase)` with
`listCarModels(supabase)` (imported from `@/lib/car-models`) for the
`models` fetch, and `listDistinctVariants(supabase)` for `variants`.
Pass `models={models}` to `<FitmentTagEditor>` instead of
`modelSuggestions={models}`.

### API route — `app/api/models/[id]/route.ts` (new)

Twin of `app/api/makes/[id]/route.ts`: `PATCH` (body `{ name: string }`,
401/403 guards, `updateCarModel`, `isUniqueViolation` → "That model
already exists for this make.") and `DELETE` (401/403 guards,
`deleteCarModel`). No `isForeignKeyViolation` branch — the cascade means
there is nothing left to block the delete on.

### `components/lookup-list-table.tsx`

Add one optional field to the item shape and render it:

```ts
export interface LookupListItem {
  id: string;
  name: string;
  secondary?: string;
}
```

Rendered as a muted `<span>` under `item.name` when present (Makes/
Categories keep passing items with no `secondary`, so their rendering is
byte-for-byte unchanged). Edit mode still only lets you change `name` —
`secondary` (the make) is display-only, matching the "rename only, make
is immutable after creation" non-goal above.

### `app/(dashboard)/models/page.tsx` + `loading.tsx` (new)

Mirrors `app/(dashboard)/makes/page.tsx`. The add form gains a Make
`<select>` (populated by `listCarMakes`) alongside the name `<Input>`;
the Server Action (`addModel`) validates both are present before calling
`createCarModel`, redirecting with `?error=missing-make` /
`?error=missing-name` / `?error=duplicate-name` the same way `addMake`
does today. List items are built as
`models.map((m) => ({ id: m.id, name: m.name, secondary: makeNameById.get(m.makeId) }))`
and passed to `<LookupListTable emptyLabel="No models yet." .../>`.

### `components/sidebar.tsx`

`NavLink.icon` becomes optional (`icon?: LucideIcon`), and `NavItem`
renders the `<Icon>` only when present — its active-state logic and
styling are otherwise untouched. New type alongside it:

```ts
interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLink[];
}
```

`SHARED_LINKS` becomes `(NavLink | NavGroup)[]`; Makes is removed from
its flat position and becomes the `"Fitment"` group's first child, with
Models as the second — neither child specifies `icon` (this is the
sidebar's first nested entry, and there's no existing precedent either
way; omitting child icons is the simpler default, since the group's own
icon already establishes context):

```ts
{
  label: "Fitment",
  icon: Car,
  children: [
    { href: "/makes", label: "Makes" },
    { href: "/models", label: "Models" },
  ],
}
```

`NavContent` renders a `NavGroup` as a `<button>` (toggles that group's
entry in a `Set<string>` of expanded labels, keyed by `label`) followed
by its children indented one level, reusing `NavItem` for each child.
The group auto-expands when `pathname` matches one of its children's
`href` (checked on every render via `isActive`, not just on mount, so
client-side navigation between `/makes` and `/models` doesn't collapse
it) — manual toggling still works independently once expanded/collapsed
by the user.

## Review Focus

- **Duplicate model name under the same make** (e.g. adding "Vios" to
  Toyota twice) must be rejected with the friendly message, not a raw
  constraint error — covered by the `unique (make_id, name)` constraint
  and the route's `isUniqueViolation` branch.
- **Same model name under two different makes** (e.g. "City" under Honda
  and a hypothetical second make) must be allowed — the unique
  constraint is scoped to `(make_id, name)`, not `name` alone.
- **Deleting a make that still has models** must succeed and remove its
  models too (cascade), not be silently blocked or orphan rows — unlike
  deleting a make still referenced by a real item fitment, which must
  still be blocked exactly as it is today (`car_models` adds a new
  cascade path; it must not weaken the existing `item_fitments.make_id`
  protection).
- **Non-owner hitting `/api/models/[id]` PATCH/DELETE directly** (not
  through the hidden UI) must get 403, mirroring `/api/makes/[id]`'s
  existing enforcement — the hidden Edit/Delete buttons are not the real
  guard.
- **Seed migration re-run against a make that already exists** (e.g. an
  owner manually added "Toyota" before this migration ships) must not
  error and must still seed that make's models — the `on conflict do
  nothing` on `car_makes` plus the `join car_makes m on v.make_name =
  m.name` in the model insert means the model insert works whether that
  particular make's row came from this migration or already existed.
