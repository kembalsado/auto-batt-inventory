# Fitment sidebar group + Models lookup table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a managed `car_models` lookup table (CRUD page, seeded with Philippine-market data) and regroup the sidebar so Makes and Models sit under a new "Fitment" group, without touching `item_fitments`'s existing free-text model/variant storage.

**Architecture:** `car_models` is a plain lookup table (twin of `car_makes`, scoped by `make_id`) that feeds the fitment editor's Model `<datalist>` suggestions, filtered client-side by the selected Make. The sidebar's flat `NavLink[]` gains a second shape, `NavGroup`, rendered as an expand/collapse header wrapping existing `NavItem`s.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Vitest, React Testing Library — all pre-existing, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-fitment-nav-and-car-models-design.md`

## Global Constraints

- `item_fitments` schema is untouched — no `model_id` FK, no backfill. Model stays free text with `<datalist>` suggestions.
- `car_models.make_id` is `not null references car_makes(id) on delete cascade` — deleting a make deletes its models (no FK-violation path for models, unlike makes/categories).
- `unique (make_id, name)` on `car_models` — scoped per make, not global.
- RLS: select/insert open to `authenticated`; update/delete gated by `is_owner(auth.uid())` (reuse, don't reinvent).
- New tables get RLS policies AND base grants (`authenticated`, `service_role`) in the same migration — no two-step grant-then-RLS history like `car_makes` had.
- Rename-only edit for a model; the make it belongs to is immutable after creation (delete and re-add to fix a wrong make).
- No new routing: `/makes` keeps its URL; only `/models` is new. The sidebar grouping is presentation-only.
- Sidebar group children render with no icon of their own; `NavLink.icon` becomes optional.

## Review Focus

- Duplicate model name under the *same* make must be rejected with a friendly message (Task 3, Task 4).
- The *same* model name under two *different* makes must be allowed, not rejected (Task 3).
- Deleting a make with models must cascade-delete them, while a make still referenced by a real item fitment must still be blocked exactly as today (Task 1).
- A non-owner hitting `PATCH`/`DELETE /api/models/[id]` directly (not through the hidden UI) must get 403 (Task 4).
- The seed migration re-run against a make that already exists (manually added) must not error and must still seed that make's models (Task 2).

---

### Task 1: `car_models` table, RLS, grants

**Files:**
- Create: `supabase/migrations/0025_car_models.sql`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: table `car_models (id uuid pk, make_id uuid not null fk->car_makes on delete cascade, name text not null, created_at timestamptz not null default now(), unique(make_id, name))`, used by every later task.

- [ ] **Step 1: Write the migration**

Use the exact SQL from the spec's "Migration 1 — `car_models` table, RLS, grants" section (table, four RLS policies reusing `is_owner(auth.uid())`, and `grant select, insert, update, delete` to both `authenticated` and `service_role`).

- [ ] **Step 2: Apply the migration locally**

Run: `supabase migration up`
Expected: applies cleanly, no errors.

- [ ] **Step 3: Write the failing schema tests**

```ts
test("car_models has make_id (FK, not null), name, created_at, unique on (make_id, name)", async () => {
  const supabase = createAdminClient();
  const { data: make } = await supabase.from("car_makes")
    .insert({ name: `schema-make-${Date.now()}` }).select().single();
  const { data, error } = await supabase.from("car_models")
    .insert({ make_id: make!.id, name: "Vios" })
    .select("id, make_id, name, created_at").single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ make_id: make!.id, name: "Vios" });

  const { error: dupError } = await supabase.from("car_models")
    .insert({ make_id: make!.id, name: "Vios" });
  expect(dupError).not.toBeNull();

  await supabase.from("car_models").delete().eq("id", data!.id);
  await supabase.from("car_makes").delete().eq("id", make!.id);
});

test("deleting a car_make cascades to delete its car_models", async () => {
  const supabase = createAdminClient();
  const { data: make } = await supabase.from("car_makes")
    .insert({ name: `cascade-make-${Date.now()}` }).select().single();
  const { data: model } = await supabase.from("car_models")
    .insert({ make_id: make!.id, name: "Cascade Model" }).select().single();

  await supabase.from("car_makes").delete().eq("id", make!.id);

  const { data: remaining } = await supabase.from("car_models")
    .select("id").eq("id", model!.id).maybeSingle();
  expect(remaining).toBeNull();
});

test("RLS: an owner can update and delete a car_model directly; an assistant cannot", async () => {
  // Mirror tests/db/schema.test.ts's existing "RLS: an owner can update
  // and delete a car_make directly; an assistant cannot" (same file,
  // ~line 169) exactly, substituting car_models and inserting a car_make
  // row first to satisfy the not-null FK.
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/db/schema.test.ts -t "car_model"`
Expected: FAIL (table doesn't exist yet) if Step 2 wasn't run against this test DB, otherwise PASS already — if so, double check Step 1/2 actually took effect before moving on.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/db/schema.test.ts -t "car_model"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0025_car_models.sql tests/db/schema.test.ts
git commit -m "feat: add car_models table with per-make RLS and grants"
```

---

### Task 2: Seed Philippine-market makes and models

**Files:**
- Create: `supabase/migrations/0026_seed_ph_car_makes_and_models.sql`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: `car_makes`, `car_models` (Task 1).

- [ ] **Step 1: Write the migration**

Use the exact SQL from the spec's "Migration 2 — seed data" section verbatim (the 16-make `insert ... on conflict (name) do nothing` into `car_makes`, followed by the `insert into car_models select ... join car_makes ... on conflict (make_id, name) do nothing`).

- [ ] **Step 2: Apply the migration locally**

Run: `supabase migration up`
Expected: applies cleanly.

- [ ] **Step 3: Write the failing idempotency test**

```ts
test("seed migration populated Toyota and at least one of its models", async () => {
  const supabase = createAdminClient();
  const { data: toyota } = await supabase.from("car_makes")
    .select("id").eq("name", "Toyota").single();
  expect(toyota).not.toBeNull();

  const { data: vios } = await supabase.from("car_models")
    .select("id").eq("make_id", toyota!.id).eq("name", "Vios").single();
  expect(vios).not.toBeNull();
});

test("car_makes.name has a live unique constraint, which is what makes the migration's own ON CONFLICT clause meaningful", async () => {
  const supabase = createAdminClient();
  const { error } = await supabase.from("car_makes").insert({ name: "Toyota" });
  expect(error).not.toBeNull();
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/db/schema.test.ts -t "seed migration"`
Expected: FAIL before Step 2, PASS after — if it's already passing, confirm Step 2 actually ran.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db/schema.test.ts -t "seed migration"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0026_seed_ph_car_makes_and_models.sql tests/db/schema.test.ts
git commit -m "feat: seed car_makes and car_models with Philippine market data"
```

---

### Task 3: `lib/car-models.ts` and the activity allow-list

**Files:**
- Create: `lib/car-models.ts`
- Modify: `lib/activity.ts` (add `"car_model.created"`, `"car_model.updated"`, `"car_model.deleted"` to `ACTIONS`, same per-entry comment convention as the existing `car_make.*` trio, ~line 44-54)
- Test: `tests/lib/car-models.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (`lib/audit.ts`), `car_makes`/`car_models` tables (Task 1).
- Produces:
  ```ts
  export interface CarModel { id: string; makeId: string; name: string; createdAt: string }
  export async function createCarModel(supabase, actorId: string, makeId: string, name: string): Promise<CarModel>
  export async function listCarModels(supabase): Promise<CarModel[]>
  export async function updateCarModel(supabase, actorId: string, id: string, name: string): Promise<CarModel>
  export async function deleteCarModel(supabase, actorId: string, id: string): Promise<void>
  ```
  Used by Task 4 (API route), Task 6 (Models page), Task 9 (item pages).

- [ ] **Step 1: Write the failing tests**

Mirror `tests/lib/car-makes.test.ts` structure exactly (run-unique names via `randomUUID().slice(0, 8)`, a real owner profile in `beforeAll`, tracked ids cleaned up in `afterAll`), adapted for the make_id requirement:

```ts
test("createCarModel inserts a model under a make and writes an audit log entry", async () => { /* assert model.makeId, model.name; audit_log action "car_model.created" */ });
test("createCarModel rejects a duplicate name under the same make", async () => { /* same makeId, same name twice -> rejects */ });
test("createCarModel allows the same name under two different makes", async () => { /* two makes, same model name, both succeed */ });
test("listCarModels returns created models ordered by name", async () => { /* two models, assert order */ });
test("updateCarModel renames a model and records an audit log entry", async () => { /* action "car_model.updated" */ });
test("updateCarModel rejects renaming to a name that collides within the same make", async () => {});
test("deleteCarModel removes a model and records an audit log entry", async () => { /* action "car_model.deleted" */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/car-models.test.ts`
Expected: FAIL with "Cannot find module '@/lib/car-models'"

- [ ] **Step 3: Implement `lib/car-models.ts`**

Follow `lib/car-makes.ts` exactly for each function's shape (perform the write, then `recordAudit`, propagate thrown Postgres errors unhandled). `createCarModel` inserts `{ make_id: makeId, name }`; `listCarModels` selects `*` ordered by `name` (all makes, unfiltered — callers filter client-side); `updateCarModel`/`deleteCarModel` take only `id` (make is immutable, matching the design's non-goal).

- [ ] **Step 4: Add the `lib/activity.ts` allow-list entries**

Add the three `car_model.*` strings to `ACTIONS`, each with a one-line comment following the existing `car_make.*` entries' convention.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/car-models.test.ts tests/lib/activity-actions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/car-models.ts lib/activity.ts tests/lib/car-models.test.ts
git commit -m "feat: add car-models lib with full CRUD and audit logging"
```

---

### Task 4: `app/api/models/[id]/route.ts`

**Files:**
- Create: `app/api/models/[id]/route.ts`
- Test: `tests/api/models.test.ts`

**Interfaces:**
- Consumes: `updateCarModel`, `deleteCarModel` (Task 3); `isUniqueViolation`, `describeError` (`lib/errors.ts`, existing); `getRole` (`lib/permissions.ts`, existing).
- Produces: `PATCH`/`DELETE` handlers consumed by Task 6's `LookupListTable` usage (`apiBasePath="/api/models"`).

This file's tests need a live `next dev` server at `localhost:3000`, the same pre-existing documented dependency `tests/api/makes.test.ts` already has — start it before running Step 2/5 below if it isn't already running.

- [ ] **Step 1: Write the failing tests**

Mirror `tests/api/makes.test.ts` exactly (`describe("PATCH /api/models/[id]")` / `describe("DELETE /api/models/[id]")`), substituting `car_models` (insert a `car_makes` row first for the FK) for `car_makes`, and dropping the "still used by an item" DELETE case (no FK-violation path exists for a model — deleting one is never blocked). Keep: owner can rename; assistant cannot (403); blank name gets 400; renaming to a name colliding *within the same make* gets a friendly 400 ("That model already exists for this make."); owner can delete; assistant cannot delete (403).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/models.test.ts`
Expected: FAIL with 404 (route doesn't exist)

- [ ] **Step 3: Implement the route**

Follow `app/api/makes/[id]/route.ts` exactly for both handlers' 401/403 guards and error mapping. `PATCH`'s catch checks `isUniqueViolation` first → `{ error: "That model already exists for this make." }`. `DELETE` has no `isForeignKeyViolation` branch (nothing to catch — see Task 1's cascade).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/models.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/models/[id]/route.ts tests/api/models.test.ts
git commit -m "feat: add owner-gated PATCH/DELETE route for car models"
```

---

### Task 5: `LookupListTable`'s optional `secondary` field

**Files:**
- Modify: `components/lookup-list-table.tsx`
- Test: `tests/components/lookup-list-table.test.tsx`

**Interfaces:**
- Produces: `LookupListItem` gains `secondary?: string`, consumed by Task 6's Models page.

- [ ] **Step 1: Write the failing test**

```ts
test("renders an item's secondary label when present, and nothing extra when absent", () => {
  render(
    <LookupListTable
      items={[{ id: "1", name: "Vios", secondary: "Toyota" }, { id: "2", name: "Batteries" }]}
      apiBasePath="/api/models"
      noun="model"
      isOwner={false}
      emptyLabel="No models yet."
    />
  );
  expect(screen.getByText("Toyota")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/lookup-list-table.test.tsx -t "secondary"`
Expected: FAIL ("Toyota" not found)

- [ ] **Step 3: Implement**

Add `secondary?: string` to `LookupListItem`. In the non-editing render branch, next to `<span>{item.name}</span>`, add `{item.secondary && <span className="text-xs text-muted-foreground">{item.secondary}</span>}`. Edit mode is unchanged (still renames `name` only).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/lookup-list-table.test.tsx`
Expected: PASS (including every pre-existing test in this file, unaffected since `secondary` is optional)

- [ ] **Step 5: Commit**

```bash
git add components/lookup-list-table.tsx tests/components/lookup-list-table.test.tsx
git commit -m "feat: let LookupListTable show an optional secondary label per row"
```

---

### Task 6: `/models` page

**Files:**
- Create: `app/(dashboard)/models/page.tsx`
- Create: `app/(dashboard)/models/loading.tsx`

**Interfaces:**
- Consumes: `createCarModel`, `listCarModels` (Task 3); `listCarMakes` (`lib/car-makes.ts`, existing); `isUniqueViolation` (existing); `getRole` (existing); `LookupListTable` with `secondary` (Task 5).

- [ ] **Step 1: Implement `loading.tsx`**

Copy `app/(dashboard)/makes/loading.tsx` verbatim (same skeleton shape — this page's layout is structurally identical).

- [ ] **Step 2: Implement `page.tsx`**

Follow `app/(dashboard)/makes/page.tsx` exactly, with these differences:
- The add form (`addModel` Server Action) needs a Make `<select>` (populated from `listCarMakes(supabase)`) in addition to the name `<Input>`. Validate both are present before calling `createCarModel`; missing make or missing name each redirect with a distinct `?error=` code (`missing-make` / `missing-name`), same pattern as `missing-name` on `addMake` today. Add `"missing-make": "Choose a make."` to `ERROR_MESSAGES`.
- Fetch both `listCarMakes(supabase)` and `listCarModels(supabase)` in the page body (`Promise.all`, same shape as the item pages already use).
- Build `LookupListTable`'s `items` as `models.map((m) => ({ id: m.id, name: m.name, secondary: makeNameById.get(m.makeId) }))` (a `Map` from the fetched makes, same `new Map(makes.map(...))` idiom `fitment-tag-editor.tsx` already uses), `apiBasePath="/api/models"`, `noun="model"`, `emptyLabel="No models yet."`.

- [ ] **Step 3: Manually verify**

Run the dev server, sign in, visit `/models`: add a model under a make, confirm it lists with the make name underneath, and (as owner) rename/delete it inline.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/models/page.tsx" "app/(dashboard)/models/loading.tsx"
git commit -m "feat: add Models CRUD page"
```

---

### Task 7: Rename `listDistinctModelsAndVariants` to `listDistinctVariants`

**Files:**
- Modify: `lib/item-fitments.ts`
- Test: `tests/lib/item-fitments.test.ts`

**Interfaces:**
- Produces: `export async function listDistinctVariants(supabase): Promise<string[]>`, consumed by Task 9.

- [ ] **Step 1: Update the existing test(s)**

Find whatever test(s) currently cover `listDistinctModelsAndVariants` in `tests/lib/item-fitments.test.ts` and rewrite them for the new signature — e.g. a test currently asserting `{ models: [...], variants: [...] }` becomes an assertion that `listDistinctVariants` returns just the sorted variant array; drop any case that only existed to cover the `models` half (that data now comes from `car_models`, covered by Task 3's tests).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/item-fitments.test.ts -t "istinct"`
Expected: FAIL (old function name/shape still in place, new assertions don't match)

- [ ] **Step 3: Implement**

Rename the function, drop the `models` `Set` and its population, return `Array.from(variants).sort()` directly instead of an object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/item-fitments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/item-fitments.ts tests/lib/item-fitments.test.ts
git commit -m "refactor: narrow listDistinctModelsAndVariants to listDistinctVariants"
```

---

### Task 8: `FitmentTagEditor` — make-filtered Model suggestions

**Files:**
- Modify: `app/(dashboard)/items/fitment-tag-editor.tsx`
- Test: `tests/components/fitment-tag-editor.test.tsx`

**Interfaces:**
- Consumes: `CarModel` shape from Task 3 (`{ id, makeId, name }` — the component only needs these three fields, so it can accept `CarModel[]` directly or an equivalently-shaped local type).
- Produces: `FitmentTagEditorProps.models: { id: string; makeId: string; name: string }[]` replacing `modelSuggestions: string[]`, consumed by Task 9's item pages.

- [ ] **Step 1: Mechanically update existing tests**

In `tests/components/fitment-tag-editor.test.tsx`, replace every `modelSuggestions={[]}` with `models={[]}` (`replace_all` — every existing call site passes an empty array today, confirmed by inspection, so this is a pure rename with no behavior change for those tests).

- [ ] **Step 2: Write new failing tests for the filtering behavior**

```ts
const models = [
  { id: "m1", makeId: "toyota-id", name: "Vios" },
  { id: "m2", makeId: "toyota-id", name: "Innova" },
  { id: "m3", makeId: "honda-id", name: "Civic" },
];

test("Model suggestions are filtered to the selected Make", () => {
  render(<FitmentTagEditor makes={makes} models={models} variantSuggestions={[]} initialFitments={[]} />);
  fireEvent.change(screen.getByLabelText("Make"), { target: { value: "toyota-id" } });
  const datalist = document.getElementById("fitment-model-suggestions");
  expect(datalist?.textContent).toContain("Vios");
  expect(datalist?.textContent).toContain("Innova");
  expect(datalist?.textContent).not.toContain("Civic");
});

test("Model suggestions show every model, deduped, when no Make is selected", () => {
  render(<FitmentTagEditor makes={makes} models={models} variantSuggestions={[]} initialFitments={[]} />);
  const datalist = document.getElementById("fitment-model-suggestions");
  expect(datalist?.textContent).toContain("Vios");
  expect(datalist?.textContent).toContain("Civic");
});
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run tests/components/fitment-tag-editor.test.tsx -t "filtered"`
Expected: FAIL (prop doesn't exist yet / datalist still built from `modelSuggestions`)

- [ ] **Step 4: Implement**

Rename the prop to `models: { id: string; makeId: string; name: string }[]`. Replace the `modelSuggestions` datalist-options derivation with:

```ts
const modelSuggestions = makeId
  ? models.filter((m) => m.makeId === makeId).map((m) => m.name)
  : Array.from(new Set(models.map((m) => m.name))).sort();
```

mapped into `<datalist id="fitment-model-suggestions">` exactly as today. Nothing else in the component changes — the Model `<Input>` stays free text, unaffected by Make changing after the fact.

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npx vitest run tests/components/fitment-tag-editor.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/items/fitment-tag-editor.tsx" tests/components/fitment-tag-editor.test.tsx
git commit -m "feat: filter fitment editor's Model suggestions to the selected Make"
```

---

### Task 9: Wire `car_models` into the item Add/Edit pages

**Files:**
- Modify: `app/(dashboard)/items/new/page.tsx` (imports, `~line 4-6`, `~line 144-145`, `~line 229`)
- Modify: `app/(dashboard)/items/[id]/edit/page.tsx` (imports `~line 6, 10`, `~line 171-172`, `~line 294-295`)

**Interfaces:**
- Consumes: `listCarModels` (Task 3), `listDistinctVariants` (Task 7), `FitmentTagEditor`'s new `models` prop (Task 8).

- [ ] **Step 1: Update `items/new/page.tsx`**

Replace the `listDistinctModelsAndVariants` import with `listCarModels` (from `@/lib/car-models`) and `listDistinctVariants` (from `@/lib/item-fitments`). Replace the `Promise.all` destructure `[categories, makes, { models, variants }]` with `[categories, makes, models, variants] = await Promise.all([listCategories(supabase), listCarMakes(supabase), listCarModels(supabase), listDistinctVariants(supabase)])`. Replace `<FitmentTagEditor modelSuggestions={models} variantSuggestions={variants} ... />` with `models={models} variantSuggestions={variants}`.

- [ ] **Step 2: Update `items/[id]/edit/page.tsx`**

Same change, same shape, at this file's own import/fetch/render sites.

- [ ] **Step 3: Run the existing item-page tests**

Run: `npx vitest run tests/components/fitment-tag-editor.test.tsx` and any `tests/` files covering the new/edit item pages (confirm with `grep -rl "items/new\|FitmentTagEditor" tests/` first)
Expected: PASS — no behavior change for these pages beyond the suggestion source, which isn't asserted at this layer.

- [ ] **Step 4: Manually verify**

Run the dev server; on `/items/new`, pick a seeded Make (e.g. Toyota) and confirm the Model field's suggestions are scoped to that make's seeded models (e.g. Vios, Innova) rather than every model in the system.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/items/new/page.tsx" "app/(dashboard)/items/[id]/edit/page.tsx"
git commit -m "feat: source item fitment Model suggestions from car_models"
```

---

### Task 10: Sidebar "Fitment" group

**Files:**
- Modify: `components/sidebar.tsx`
- Modify: `tests/components/sidebar.test.tsx`

**Interfaces:**
- Produces: `NavGroup` type; `SHARED_LINKS: (NavLink | NavGroup)[]`.

- [ ] **Step 1: Update the existing test that breaks**

`"both roles see a Makes link"` currently asserts `screen.getByText("Makes")` with no interaction — once Makes is a collapsed child by default (pathname `"/"` doesn't match either child), this fails. Update it to open the group first:

```ts
test("both roles see a Makes link once the Fitment group is expanded", () => {
  mockPathname = "/";
  const { unmount } = render(<Sidebar role="owner" />);
  fireEvent.click(screen.getByText("Fitment"));
  expect(screen.getByText("Makes")).toBeInTheDocument();
  unmount();
  mockPathname = "/";
  render(<Sidebar role="assistant" />);
  fireEvent.click(screen.getByText("Fitment"));
  expect(screen.getByText("Makes")).toBeInTheDocument();
});
```

(Add `fireEvent` to this file's `@testing-library/react` import.)

- [ ] **Step 2: Write new failing tests**

```ts
test("the Fitment group is collapsed by default and expands on click, revealing Models", () => {
  mockPathname = "/";
  render(<Sidebar role="owner" />);
  expect(screen.queryByText("Models")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Fitment"));
  expect(screen.getByText("Models")).toBeInTheDocument();
});

test("the Fitment group auto-expands when the current route is one of its children", () => {
  mockPathname = "/models";
  render(<Sidebar role="owner" />);
  expect(screen.getByText("Models")).toBeInTheDocument();
});

test("Categories stays a plain top-level link, not nested under Fitment", () => {
  mockPathname = "/";
  render(<Sidebar role="owner" />);
  expect(screen.getByText("Categories")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run tests/components/sidebar.test.tsx`
Expected: FAIL ("Models" doesn't exist anywhere yet; "Fitment" doesn't exist)

- [ ] **Step 4: Implement**

- `NavLink.icon` becomes `icon?: LucideIcon`; `NavItem` renders `<Icon>` only when `link.icon` is set.
- Add `interface NavGroup { label: string; icon: LucideIcon; children: NavLink[] }`.
- `SHARED_LINKS: (NavLink | NavGroup)[]`: remove the flat Makes entry, add in its place:
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
- `NavContent` needs `useState<Set<string>>` tracking expanded group labels (or similar), and to distinguish a `NavGroup` from a `NavLink` when mapping `SHARED_LINKS` (e.g. an `"children" in link` check). Render a `NavGroup` as a `<button>` toggling its label in/out of the expanded set, followed by — when expanded OR when `pathname` matches one of its children's `href` via the existing `isActive` — its children indented, each rendered via the existing `NavItem`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/sidebar.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/sidebar.tsx tests/components/sidebar.test.tsx
git commit -m "feat: group Makes and Models under a collapsible Fitment sidebar entry"
```

---

## Left to the builder

- Exact Tailwind classes for the group header button, the chevron/expand indicator, and child indentation — match the existing `NavItem` button's padding/sizing conventions, nothing new to invent.
- Whether the expanded/collapsed `Set<string>` lives in `NavContent` or is lifted to `Sidebar` — `NavContent` is simplest since it's the only consumer, but either works since there's exactly one `NavGroup` today.
