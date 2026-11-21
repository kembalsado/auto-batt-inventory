# Rename + delete for Makes and Categories — design

## Intent / why

The Makes (`/makes`) and Categories (`/categories`) pages currently only
support **Create** (an add form) and **Read** (a plain `<ul>` list) — see
each table's RLS migration (`0004_categories_rls.sql`, `0016_car_makes.sql`),
which explicitly has no update/delete policy, "YAGNI — not in this task's
scope". The ask: add rename and delete, i.e. full CRUD, for both.

Confirmed in conversation:

- Rename/delete are **owner-only** — stricter than today's Create, which
  any authenticated user (owner or assistant) can already do. Viewing and
  adding stay open to both roles; only changing/removing an existing entry
  is owner-only.
- The interaction is **inline on the existing list** (Approach A): each row
  gets Edit/Delete actions, Edit swaps the row into a text input with
  Save/Cancel, no navigation to a separate page — mirroring
  `app/(dashboard)/users/users-table.tsx`'s per-row action pattern (a
  client component calling a `PATCH`/`DELETE` API route, then
  `router.refresh()`), not `items/[id]/edit/page.tsx`'s full-page-form
  pattern. Rejected because a whole page for editing one text field is
  disproportionate, and it would introduce a second, different
  rename-flow pattern alongside the inline one Users already uses for no
  benefit.

## Goals

- An owner can rename a make/category from the list, inline, with the
  same duplicate-name handling already used on create (`isUniqueViolation`
  → friendly message, not a crash).
- An owner can delete a make/category from the list. If it's still
  referenced by any item (`items.category_id`/`items.make_id`), the delete
  is rejected by the database's FK constraint and surfaced as a friendly
  "still in use" message, not a crash — same shape as the existing
  duplicate-name handling, for a new Postgres error code (`23503`, not
  `23505`).
- An assistant still sees the list and the add form exactly as today, with
  no Edit/Delete controls — enforced both in the UI (hidden) and
  server-side (RLS + an explicit role check in the API route), the same
  belt-and-suspenders already used for cost-gating (`canSeeCost`) and for
  `/api/users/[id]`'s owner check.

## Non-goals

- Bulk rename/delete.
- Changing who can **create** a make/category — that stays open to any
  authenticated user, unchanged.
- Cascading deletes, or any UI for reassigning an item's category/make
  before deleting the one it points to — a blocked delete is simply
  reported as blocked; "move these items to a different category first"
  is on the user, not automated.
- Soft-delete/archive — these are plain hard deletes, gated only by the FK
  constraint that already exists.

## Constraints / findings (from reading the code)

- RLS currently grants `categories`/`car_makes` only `select`+`insert` to
  `authenticated` (`0004_categories_rls.sql`, `0016_car_makes.sql`). Base
  SQL grants for `update`/`delete` already exist for both tables
  (`0013_authenticated_base_grants.sql`, `0018_car_makes_grants.sql`), so
  only new RLS policies are needed, not new grants.
- The codebase already has exactly this "read is open, write is
  owner-only" shape, with a reusable SQL helper: `is_owner(auth.uid())`
  (defined in `0002_auth_profiles.sql`), used by
  `app_settings_update_owner` (`0009_app_settings_rls.sql`). The new
  update/delete policies on `categories`/`car_makes` should reuse
  `is_owner()` the same way, rather than inventing a second owner-check
  expression.
- `items.category_id references categories (id)` and `items.make_id
  references car_makes (id)` (`0001_init.sql`, `0017_items_vehicle_columns.sql`)
  have no `ON DELETE` clause, so Postgres defaults to `NO ACTION`: deleting
  a referenced row raises SQLSTATE `23503` (`foreign_key_violation`). No
  app-level "is this in use" pre-check is needed — attempt the delete and
  handle the rejection, the same flag-then-redirect-shaped pattern
  `isUniqueViolation` already established, just for a different code.
  `lib/errors.ts` needs a new `isForeignKeyViolation(err)` alongside
  `isUniqueViolation(err)`.
- `/api/users/[id]/route.ts` is the existing template for an owner-gated
  mutation route: `createServerClient()` + `auth.getUser()` (401 if
  missing), then look up the caller's own `profiles.role` and `getRole(...)
  !== "owner"` → 403, then call the `lib/` function and map thrown errors
  through `describeError`. The new routes follow this exactly — no admin
  client needed here (unlike Users, which needs `auth.admin.*` for email);
  a normal server client authenticated as the owner is enough, and RLS's
  `is_owner()` policy is the real backstop if this check is ever bypassed.
- Makes/Categories pages are **not** owner-only routes
  (`lib/permissions.ts`'s `OWNER_ONLY_PATHS` doesn't list `/makes` or
  `/categories`) — unlike Users, where every viewer is already an owner by
  the time `UsersTable` renders. So, unlike `UsersTable`, the new list
  component needs an explicit `isOwner` prop to decide whether to render
  Edit/Delete at all; each page.tsx fetches the viewer's own
  `profiles.role` to compute it (one extra query per page load, same cost
  `UsersPage` already pays to get `currentUserId`).
- `lib/categories.ts` and `lib/car-makes.ts` are near-verbatim twins today
  (same shape, same comments calling out the parallel). The two new list
  UIs are equally identical except for the API path and the word
  "category"/"make" — worth one shared component
  (`components/lookup-list-table.tsx`) rather than two near-duplicate
  files, parameterized by `apiBasePath` and `noun`. This is a different
  call from `items-table.tsx`/`batches-table.tsx`/etc. staying bespoke —
  those differ in actual columns/data shape; these two don't differ at
  all beyond labels.
- `recordAudit`'s `entity_id` has no FK constraint to the table it names
  (confirmed: no `entity_id references ...` anywhere in the migrations),
  so an audit row for a `*.deleted` action can still name the
  now-deleted id with no ordering/FK problem.

## Approaches considered

Covered in conversation already:
- **(Picked) Inline list actions, owner-gated, via API routes + RLS**
  (Approach A above), using the existing `is_owner()`/`/api/users/[id]`
  patterns.
- **Rejected: separate `/edit` pages** (Approach B) — disproportionate for
  a one-field entity and a second rename pattern for no benefit.

One more considered while designing the UI layer:
- **(Picked) One shared `LookupListTable` component**, used directly by
  both `page.tsx` files, parameterized by `apiBasePath`/`noun`/`items`/
  `isOwner`.
- **Rejected: two near-duplicate `makes-table.tsx`/`categories-table.tsx`
  files**, copy-pasted from `users-table.tsx`. Matches this codebase's
  general per-table bespoke-component convention, but here the two
  "tables" have zero actual differences in shape (just labels and a path),
  so copy-pasting would just be drift risk for no customization ever
  needed.

## Design

### Migration

`supabase/migrations/0019_categories_car_makes_update_delete_rls.sql`:
owner-only update + delete policies on both tables, reusing `is_owner()`:

```sql
create policy "categories_update_owner" on categories for update
  to authenticated using (is_owner(auth.uid())) with check (is_owner(auth.uid()));
create policy "categories_delete_owner" on categories for delete
  to authenticated using (is_owner(auth.uid()));

create policy "car_makes_update_owner" on car_makes for update
  to authenticated using (is_owner(auth.uid())) with check (is_owner(auth.uid()));
create policy "car_makes_delete_owner" on car_makes for delete
  to authenticated using (is_owner(auth.uid()));
```

### `lib/errors.ts`

Add `isForeignKeyViolation(err): boolean` — same shape as
`isUniqueViolation`, checking `code === "23503"`.

### `lib/categories.ts` / `lib/car-makes.ts`

Each gains two functions, twins of the other table's:

```ts
updateCategory(supabase, actorId, id, name): Promise<Category>
deleteCategory(supabase, actorId, id): Promise<void>

updateCarMake(supabase, actorId, id, name): Promise<CarMake>
deleteCarMake(supabase, actorId, id): Promise<void>
```

Same shape as the existing `create*`: perform the write, then
`recordAudit` (`category.updated`/`category.deleted`,
`car_make.updated`/`car_make.deleted`), propagating a thrown Postgres
error (unique or FK violation) to the caller unhandled — the API route is
what classifies it.

### API routes

`app/api/categories/[id]/route.ts` and `app/api/makes/[id]/route.ts`, each
exporting `PATCH` (body `{ name: string }`) and `DELETE`, both following
`/api/users/[id]/route.ts`'s shape: 401 if not signed in, 403 if the
caller's own `profiles.role` isn't `"owner"`, otherwise call the matching
`lib/` function and return `{ ok: true }` or a `400` with `describeError`
— except `PATCH`'s catch checks `isUniqueViolation` first (→ "That
name already exists.") and `DELETE`'s catch checks
`isForeignKeyViolation` first (→ "Still in use by one or more items —
remove or reassign them first."), falling back to `describeError(error)`
for anything else, same as every other handled-error path in this app.

**Blank-name validation (my call, following the builder check):**
`categories.name`/`car_makes.name` are `unique not null` but not
constrained against an empty/whitespace string — unlike create
(`addMake`/`addCategory` in each `page.tsx` explicitly `redirect`s on a
missing name before ever calling `createCarMake`/`createCategory`), the
rename path had no equivalent guard specified. `PATCH` trims the
incoming `name` server-side and returns `400` (`"Enter a name."`) before
calling `updateCategory`/`updateCarMake` when it's empty — same rule as
create, just as a JSON 400 instead of a redirect, matching this route's
own error-response shape. `LookupListTable`'s Save button is disabled
while its edit `<Input>` is empty/whitespace, mirroring the add forms'
`<Input required>`, so this is normally caught before the request is
even sent.

### `components/lookup-list-table.tsx`

New shared client component:

```ts
interface LookupListItem { id: string; name: string }

function LookupListTable(props: {
  items: LookupListItem[];
  apiBasePath: string; // "/api/categories" | "/api/makes"
  noun: string;        // "category" | "make"
  isOwner: boolean;
  emptyLabel: string;  // "No categories yet." | "No makes yet."
}): JSX.Element
```

Renders the existing `divide-y` list styling (unchanged for a
non-owner/empty list). When `isOwner`, each row additionally gets Edit
(pencil icon button, swaps that row's text into an `<Input>` +
Save/Cancel, `PATCH`s on Save) and Delete (`window.confirm(...)` — same
convention `users-table.tsx` already uses for a destructive action — then
`DELETE`s). Both actions track per-row pending/error state and call
`router.refresh()` on success, exactly like `users-table.tsx`'s
`toggleActive`. No search box (neither list has one today, and neither
list is large enough to need one — out of scope here).

### Pages

`app/(dashboard)/categories/page.tsx` / `.../makes/page.tsx`: after
fetching the list, also fetch the caller's own `profiles.role` (one more
`.select("role").eq("id", user.id).single()`, same call shape
`UsersPage`/other owner-gated code already makes) to compute `isOwner =
getRole(profile) === "owner"`. Replace the inline `<ul>...</ul>` block
with `<LookupListTable items={...} apiBasePath="/api/categories"
noun="category" isOwner={isOwner} emptyLabel="No categories yet." />` (and
the Makes equivalent). The add form and its Server Action are unchanged.

## Left to the builder

- Exact Tailwind classes for the inline edit `<Input>`/Save/Cancel
  buttons inside a row — match `users-table.tsx`'s existing button sizing
  (`size="sm"`) and this list's own row padding (`py-2`), nothing new to
  invent.
- Whether the Edit/Delete buttons live in one trailing cell of a
  (now effectively table-shaped) row, or stay in the existing `<ul><li>`
  markup with flex layout — either renders the same; pick whichever
  keeps the diff against today's markup smaller.
- Test shape: extend `tests/lib/categories.test.ts`/`car-makes.test.ts`
  with update/delete cases (including attempting to delete a
  category/make that's still referenced by a real `items` row, asserting
  `isForeignKeyViolation`), extend `tests/lib/errors.test.ts` with
  `isForeignKeyViolation` cases (mirroring its existing
  `isUniqueViolation` ones, including one proven against a real FK
  rejection), add a `tests/components/lookup-list-table.test.tsx`
  (rename, delete-with-confirm, hidden-when-not-owner, FK-violation error
  message surfaced), and extend `tests/api/users.test.ts`-style live-route
  coverage for the two new routes' 401/403/200 paths if that pattern is
  judged worth repeating here — optional given the FK/unique-violation
  logic itself is already covered at the `lib/` layer.
