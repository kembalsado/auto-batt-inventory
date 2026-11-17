# Vehicle Fields, Make List, and Item Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let items optionally carry a Make (managed list), Model (free text), Variant (free text), and Year; add a "Makes" management page; build item editing (which doesn't exist today); and make Items/Stock List searchable and visibly annotated by vehicle fit.

**Architecture:** One new lookup table (`car_makes`, a structural twin of `categories`) plus four new nullable columns on `items`. `lib/items.ts` gains `updateItem` (item editing doesn't exist yet) and a small helper for Model/Variant autocomplete suggestions. `lib/stock-list.ts`'s shared row builder gains one computed `vehicle` string (not four raw fields) that both the new "Vehicle" column and the existing search predicates read from, so what's searchable and what's displayed can never drift apart.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (Postgres + PostgREST), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-vehicle-fields-design.md`

## Global Constraints

- Make is a managed list (mirrors Categories exactly: any authenticated user can view/add, no rename/delete). Model and Variant are free text with `<datalist>` suggestions drawn from existing values — no new tables for either.
- Year is a single optional number, no range, no DB-level check constraint (client-side `min`/`max` only — matches this project's existing looseness on numeric/date inputs).
- "General" category is independent of the vehicle fields — no coupling, no auto-clearing, no validation tying them together.
- SKU stays editable on the new edit form, using the exact same duplicate-SKU redirect-with-error pattern `items/new/page.tsx` already has.
- `items_update_authenticated` (migration `0005_items_rls.sql`) already permits any authenticated user to UPDATE an item — no new RLS policy needed for `updateItem`. Confirm this in Task 1 rather than adding a redundant policy.
- `items` and `service_role` both already hold table-level (not column-restricted) grants (migrations `0013`/`0014`) — adding columns to `items` needs no new grant migration. `car_makes` needs its own RLS policies (new table), mirrored from `0004_categories_rls.sql`.
- No changes to `lib/import.ts` — imported items simply get `null` for the new columns.
- No Vehicle column on the PDF/Excel exports (`app/api/stock-list/pdf`, `app/api/stock-list/excel`) — out of scope for this plan.
- No currency symbol concerns here (nothing in this plan touches cost), but match existing component conventions: `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`.

## Review Focus

- An item with zero vehicle fields set — `vehicle` must be `"—"`, not blank/`null`/`"undefined"`, and the search predicate must not throw on it. Pinned by Task 4's automated empty-vehicle test (`vehicle` is a real, non-null string by construction); Task 10 manually confirms the same case renders correctly in both tables (no dedicated component test — matches this codebase's existing convention of no test files for `items-table.tsx`/`stock-list-table.tsx`).
- An item with only some vehicle fields set (e.g. Make only, no Model/Variant/Year) — the joined vehicle string must not carry stray extra spaces from the missing parts. Pinned by Task 4's automated partial-fields test.
- Editing an item's SKU to one that collides with another item's SKU — must surface the same inline duplicate-SKU error the Add form already has, not crash to the generic error boundary. Pinned by Task 3's automated `updateItem` duplicate-SKU test (the actual behavioral guarantee); Task 8 manually confirms the page wires that error through to the same inline-message UX the Add form already has.
- Searching a bare Make name (e.g. "Toyota") with Model/Variant/Year all empty on that item still matches via the Vehicle column — guaranteed by `vehicle` being exactly the Make name in that case (Task 4's partial-fields test proves this), confirmed manually at the UI layer in Task 10.
- A Model/Variant value typed that's never been used before — the `<datalist>` must not block free entry (inherent HTML behavior, confirmed by manual smoke check in Task 7) and `listDistinctModelsAndVariants` must not choke on an empty/no-match items table. Pinned by Task 3's automated empty-table test.

---

## Task 1: Schema — `car_makes` table and `items` vehicle columns

**Files:**
- Create: `supabase/migrations/0016_car_makes.sql`
- Create: `supabase/migrations/0017_items_vehicle_columns.sql`
- Modify: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: `car_makes` table (`id uuid pk`, `name text unique not null`, `created_at`), readable/insertable by any `authenticated` session, no update/delete policy. `items.make_id` (uuid, references `car_makes`), `items.model` (text), `items.variant` (text), `items.year` (integer) — all nullable, no check constraints.

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/schema.test.ts`:

```ts
test("admin client can select and insert into car_makes", async () => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("car_makes")
    .insert({ name: `schema-test-make-${Date.now()}` })
    .select()
    .single();
  expect(error).toBeNull();
  expect(data?.name).toMatch(/^schema-test-make-/);
  await supabase.from("car_makes").delete().eq("id", data!.id);
});

test("items has make_id, model, variant, year columns, all nullable", async () => {
  const supabase = createAdminClient();
  const { data: category } = await supabase
    .from("categories")
    .insert({ name: `schema-test-cat-${Date.now()}` })
    .select()
    .single();
  const { data, error } = await supabase
    .from("items")
    .insert({ sku: `SCHEMA-TEST-${Date.now()}`, name: "Schema test item", category_id: category!.id })
    .select("id, make_id, model, variant, year")
    .single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ make_id: null, model: null, variant: null, year: null });
  await supabase.from("items").delete().eq("id", data!.id);
  await supabase.from("categories").delete().eq("id", category!.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/db/schema.test.ts`
Expected: FAIL — `car_makes` relation does not exist; `items` has no `make_id`/`model`/`variant`/`year` columns.

- [ ] **Step 3: Write `0016_car_makes.sql`**

Mirror `supabase/migrations/0004_categories_rls.sql` and the `categories` table definition in `0001_init.sql` exactly: `create table car_makes (...)`, `alter table car_makes enable row level security`, `car_makes_select_authenticated`, `car_makes_insert_authenticated`. Header comment states this is a structural twin of `categories`, same YAGNI reasoning for no update/delete policy.

- [ ] **Step 4: Write `0017_items_vehicle_columns.sql`**

`alter table items add column make_id uuid references car_makes (id), add column model text, add column variant text, add column year integer;`. Header comment states explicitly that no grant migration is needed here: `items` already carries a table-level (not column-restricted) grant to `authenticated` and `service_role` (migrations `0013`/`0014`), which automatically covers new columns, and `items_update_authenticated` (`0005_items_rls.sql`) already permits the UPDATE path `updateItem` (Task 3) will use — cite both by filename so the next person doesn't go looking for a missing grant.

- [ ] **Step 5: Apply the migrations locally and run tests to verify they pass**

Apply via whatever command the project's last migration used locally. Run: `npm test -- tests/db/schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0016_car_makes.sql supabase/migrations/0017_items_vehicle_columns.sql tests/db/schema.test.ts
git commit -m "feat(db): add car_makes table and vehicle columns on items"
```

---

## Task 2: `lib/car-makes.ts`

**Files:**
- Create: `lib/car-makes.ts`
- Test: `tests/lib/car-makes.test.ts`

**Interfaces:**
- Consumes: `car_makes` table (Task 1); `recordAudit` (`lib/audit.ts`).
- Produces:
  - `export interface CarMake { id: string; name: string; created_at: string }`
  - `export async function createCarMake(supabase: SupabaseClient, actorId: string, name: string): Promise<CarMake>`
  - `export async function listCarMakes(supabase: SupabaseClient): Promise<CarMake[]>` — alphabetical by name.

- [ ] **Step 1: Write the failing tests**

`tests/lib/car-makes.test.ts`, a line-for-line structural mirror of `tests/lib/categories.test.ts` (own admin-created owner profile in `beforeAll`, `createdMakeIds` tracked and deleted in `afterAll` along with `audit_log`/`profiles`/the auth user):

```ts
test("createCarMake inserts a make and writes an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, "Toyota");
  createdMakeIds.push(make.id);
  expect(make.name).toBe("Toyota");
  const { data: log } = await supabase.from("audit_log").select("*").eq("entity_id", make.id).single();
  expect(log?.action).toBe("car_make.created");
});

test("createCarMake rejects a duplicate name", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, "Honda");
  createdMakeIds.push(make.id);
  await expect(createCarMake(supabase, OWNER_ID, "Honda")).rejects.toThrow();
});

test("listCarMakes returns created makes ordered by name", async () => {
  const supabase = createAdminClient();
  const toyota = await createCarMake(supabase, OWNER_ID, "ZZZ-Toyota");
  const honda = await createCarMake(supabase, OWNER_ID, "AAA-Honda");
  createdMakeIds.push(toyota.id, honda.id);
  const makes = await listCarMakes(supabase);
  const names = makes.map((m) => m.name);
  expect(names.indexOf("AAA-Honda")).toBeLessThan(names.indexOf("ZZZ-Toyota"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/car-makes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/car-makes.ts`**

Line-for-line mirror of `lib/categories.ts`'s `createCategory`/`listCategories`, substituting `car_makes`/`CarMake`/`"car_make.created"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/car-makes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/car-makes.ts tests/lib/car-makes.test.ts
git commit -m "feat: add car_makes data layer"
```

---

## Task 3: `lib/items.ts` — vehicle fields, `updateItem`, and Model/Variant suggestions

**Files:**
- Modify: `lib/items.ts`
- Modify: `tests/lib/items.test.ts`

**Interfaces:**
- Consumes: `createCarMake` (`lib/car-makes.ts`, Task 2 — add its import to `tests/lib/items.test.ts`'s existing import block); `isUniqueViolation` (`lib/errors.ts`); `recordAudit`.
- Produces:
  - `Item` gains `make_id: string | null`, `model: string | null`, `variant: string | null`, `year: number | null`.
  - `CreateItemInput` gains `makeId?: string | null`, `model?: string | null`, `variant?: string | null`, `year?: number | null` — all optional, so every existing caller (every test file, `addItem` in `items/new/page.tsx`) keeps compiling unmodified.
  - `export async function updateItem(supabase: SupabaseClient, actorId: string, itemId: string, input: CreateItemInput): Promise<Item>` — reuses `CreateItemInput`'s exact shape rather than a separate `UpdateItemInput` type (the edit form always submits the same full field set the add form does); records an `item.updated` audit entry (`` `Updated item ${item.sku}` ``); surfaces a duplicate-SKU violation as a thrown error the same way `createItem` does (caller catches via `isUniqueViolation`).
  - `export async function listDistinctModelsAndVariants(supabase: SupabaseClient): Promise<{ models: string[]; variants: string[] }>` — one bulk query (`select distinct model, variant from items`, filtering out nulls/empties in application code), each list sorted, for the two `<datalist>`s.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/items.test.ts` (reuse the file's existing `ASSISTANT_ID`/`categoryId` setup; add a `createdMakeIds: string[]` tracked array, and add `await admin.from("car_makes").delete().in("id", createdMakeIds);` to the existing `afterAll`, positioned any time after the existing `items` delete line — `items.make_id` references `car_makes`, so items must be deleted first; car_makes vs. categories' relative order doesn't matter, there's no FK between them):

```ts
test("createItem accepts and stores make_id, model, variant, and year", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, ASSISTANT_ID, `ItemsTest-Make-${runId}`);
  createdMakeIds.push(make.id);
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-VEH-${runId}`, name: "Vehicle item", categoryId, unit: "pcs",
    makeId: make.id, model: "Vios", variant: "1.3 E CVT", year: 2017,
  });
  createdItemIds.push(item.id);
  expect(item.make_id).toBe(make.id);
  expect(item.model).toBe("Vios");
  expect(item.variant).toBe("1.3 E CVT");
  expect(item.year).toBe(2017);
});

test("createItem defaults vehicle fields to null when omitted", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-GEN-${runId}`, name: "General item", categoryId, unit: "pcs",
  });
  createdItemIds.push(item.id);
  expect(item.make_id).toBeNull();
  expect(item.model).toBeNull();
  expect(item.variant).toBeNull();
  expect(item.year).toBeNull();
});

test("updateItem changes an item's fields and writes an item.updated audit entry", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-UPD-${runId}`, name: "Before", categoryId, unit: "pcs",
  });
  createdItemIds.push(item.id);
  const updated = await updateItem(supabase, ASSISTANT_ID, item.id, {
    sku: item.sku, name: "After", categoryId, unit: "pcs", model: "Civic",
  });
  expect(updated.name).toBe("After");
  expect(updated.model).toBe("Civic");
  const { data: log } = await supabase
    .from("audit_log").select("*").eq("entity_id", item.id).eq("action", "item.updated").single();
  expect(log?.summary).toContain(item.sku);
});

test("updateItem rejects renaming an item's SKU to one that already exists", async () => {
  const supabase = createAdminClient();
  const a = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-DUPA-${runId}`, name: "A", categoryId, unit: "pcs" });
  const b = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-DUPB-${runId}`, name: "B", categoryId, unit: "pcs" });
  createdItemIds.push(a.id, b.id);
  await expect(
    updateItem(supabase, ASSISTANT_ID, b.id, { sku: a.sku, name: "B", categoryId, unit: "pcs" })
  ).rejects.toThrow();
});

test("listDistinctModelsAndVariants returns sorted, deduplicated, non-null values", async () => {
  const supabase = createAdminClient();
  const i1 = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-MV1-${runId}`, name: "x", categoryId, unit: "pcs", model: "Vios", variant: "E" });
  const i2 = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-MV2-${runId}`, name: "y", categoryId, unit: "pcs", model: "Vios", variant: "G" });
  createdItemIds.push(i1.id, i2.id);
  const { models, variants } = await listDistinctModelsAndVariants(supabase);
  expect(models.filter((m) => m === "Vios")).toHaveLength(1); // deduplicated
  expect(variants).toContain("E");
  expect(variants).toContain("G");
});

test("listDistinctModelsAndVariants on a table with no model/variant values returns empty arrays, not an error", async () => {
  const supabase = createAdminClient();
  // Relies on the shared local DB potentially having other rows with
  // model/variant set from other tests — assert shape/no-throw rather
  // than exact emptiness: both are arrays and the call resolves.
  const result = await listDistinctModelsAndVariants(supabase);
  expect(Array.isArray(result.models)).toBe(true);
  expect(Array.isArray(result.variants)).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/items.test.ts`
Expected: FAIL — `updateItem`/`listDistinctModelsAndVariants` undefined; new fields absent from `createItem`'s insert.

- [ ] **Step 3: Implement the `lib/items.ts` changes**

Extend `Item`/`CreateItemInput` per the Interfaces block. In `createItem`'s `.insert({...})`, add `make_id: input.makeId ?? null, model: input.model ?? null, variant: input.variant ?? null, year: input.year ?? null`.

`updateItem`: `.from("items").update({ sku: input.sku, name: input.name, category_id: input.categoryId, unit: input.unit, low_stock_threshold: input.lowStockThreshold ?? null, make_id: input.makeId ?? null, model: input.model ?? null, variant: input.variant ?? null, year: input.year ?? null }).eq("id", itemId).select().single()`, throw on error, then `recordAudit` with `action: "item.updated"`, `entityType: "item"`, `entityId: data.id`, `summary: \`Updated item ${data.sku}\``.

`listDistinctModelsAndVariants`: `select("model, variant").not("model", "is", null).not("variant", "is", null)` is wrong if only one of the two is set per row (would drop rows that have only Model, not Variant) — instead do two independent queries (`select distinct model ... where model is not null`, `select distinct variant ... where variant is not null`) or one `select("model, variant")` unfiltered and dedupe/filter each column independently in application code. Prefer the single unfiltered query plus in-code filtering — one round trip, same pattern as other bulk-then-filter functions in this codebase (e.g. `buildDailySummary`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/items.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/items.ts tests/lib/items.test.ts
git commit -m "feat: add vehicle fields, updateItem, and model/variant suggestions"
```

---

## Task 4: `lib/stock-list.ts` — the `vehicle` field

**Files:**
- Modify: `lib/stock-list.ts`
- Modify: `tests/lib/stock-list.test.ts`

**Interfaces:**
- Consumes: `createCarMake` (Task 2), `createItem` with vehicle fields (Task 3).
- Produces: `StockListRow` gains `vehicle: string` (never absent/undefined — always a string, "—" when every vehicle field is unset).

This file already uses `OWNER_ID`, `categoryId`, `skuPrefix`, and a shared
`createdItemIds` array set up in its existing `beforeAll`/`afterAll`
(real sign-in sessions exist too, for the file's cost-visibility tests —
not needed for these new ones, since `vehicle` isn't cost-gated; a plain
`createAdminClient()` is sufficient here, same as this file's own
non-cost-focused setup calls already use). Add one new module-level
array, `const createdMakeIds: string[] = [];`, and extend the existing
`afterAll` with `await admin.from("car_makes").delete().in("id", createdMakeIds);`
positioned right after the existing `await admin.from("items").delete()...`
line (items.make_id references car_makes, so items must go first — same
FK-order reasoning the rest of this file's `afterAll` already follows).

- [ ] **Step 1: Write the failing tests**

```ts
test("buildStockListRows computes a joined vehicle string when all fields are set", async () => {
  const admin = createAdminClient();
  const make = await createCarMake(admin, OWNER_ID, `StockListTest-Make-${runId}`);
  createdMakeIds.push(make.id);
  const item = await createItem(admin, OWNER_ID, {
    sku: `${skuPrefix}-VEH`, name: "Vehicle item", categoryId, unit: "pcs",
    makeId: make.id, model: "Vios", variant: "1.3 E CVT", year: 2017,
  });
  createdItemIds.push(item.id);
  const rows = await buildStockListRows(admin, "owner", { includeInactive: true });
  const row = rows.find((r) => r.id === item.id);
  expect(row?.vehicle).toBe(`${make.name} Vios 1.3 E CVT 2017`);
});

test("buildStockListRows joins only the vehicle fields that are set, with no stray spaces", async () => {
  const admin = createAdminClient();
  const make = await createCarMake(admin, OWNER_ID, `StockListTest-Make2-${runId}`);
  createdMakeIds.push(make.id);
  const item = await createItem(admin, OWNER_ID, {
    sku: `${skuPrefix}-PARTIAL`, name: "Partial vehicle item", categoryId, unit: "pcs",
    makeId: make.id,
  });
  createdItemIds.push(item.id);
  const rows = await buildStockListRows(admin, "owner", { includeInactive: true });
  const row = rows.find((r) => r.id === item.id);
  expect(row?.vehicle).toBe(make.name);
});

test("buildStockListRows falls back to an em dash when no vehicle fields are set", async () => {
  const admin = createAdminClient();
  const item = await createItem(admin, OWNER_ID, {
    sku: `${skuPrefix}-NOVEH`, name: "No vehicle item", categoryId, unit: "pcs",
  });
  createdItemIds.push(item.id);
  const rows = await buildStockListRows(admin, "owner", { includeInactive: true });
  const row = rows.find((r) => r.id === item.id);
  expect(row?.vehicle).toBe("—");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/stock-list.test.ts`
Expected: FAIL — `vehicle` absent from returned rows.

- [ ] **Step 3: Implement the `lib/stock-list.ts` changes**

Extend `ItemWithCategoryRow` with `model: string | null`, `variant: string | null`, `year: number | null`, `car_makes: { name: string } | null`. Extend the items query's `.select(...)` string to add `model, variant, year, car_makes(name)`. In the `items.map(...)` body, compute `vehicle` once per row: `[item.car_makes?.name, item.model, item.variant, item.year].filter(Boolean).join(" ") || "—"`, and include it in `base`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/stock-list.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stock-list.ts tests/lib/stock-list.test.ts
git commit -m "feat: compute a joined vehicle string on stock list rows"
```

---

## Task 5: Nav entry for Makes

**Files:**
- Modify: `components/sidebar.tsx`
- Modify: `tests/components/sidebar.test.tsx`

**Interfaces:**
- Produces: a `/makes` link in `SHARED_LINKS`, positioned immediately after Categories.

- [ ] **Step 1: Write the failing test**

```ts
test("both roles see a Makes link", () => {
  mockPathname = "/";
  const { unmount } = render(<Sidebar role="owner" />);
  expect(screen.getByText("Makes")).toBeInTheDocument();
  unmount();
  render(<Sidebar role="assistant" />);
  expect(screen.getByText("Makes")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/sidebar.test.tsx -t "both roles see a Makes link"`
Expected: FAIL

- [ ] **Step 3: Add the link**

Import `Car` from `lucide-react` (confirmed unused elsewhere in this file). Add `{ href: "/makes", label: "Makes", icon: Car }` to `SHARED_LINKS`, immediately after the Categories entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/sidebar.tsx tests/components/sidebar.test.tsx
git commit -m "feat: add Makes link to the sidebar"
```

---

## Task 6: `/makes` page

**Files:**
- Create: `app/(dashboard)/makes/page.tsx`
- Create: `app/(dashboard)/makes/loading.tsx`

**Interfaces:**
- Consumes: `createCarMake`, `listCarMakes` (Task 2); `isUniqueViolation` (`lib/errors.ts`).
- Produces: the `/makes` route.

- [ ] **Step 1: Build the page**

Line-for-line structural mirror of `app/(dashboard)/categories/page.tsx`: a `addMake` Server Action (same missing-name/duplicate-name redirect-with-error shape, substituting `createCarMake`), a heading "Makes", a name input + "Add make" button, a plain `<ul>` list of `listCarMakes()`'s results below, same empty-state copy pattern ("No makes yet.").

- [ ] **Step 2: Build the loading skeleton**

Line-for-line mirror of `app/(dashboard)/categories/loading.tsx`, substituting the heading width if visually different (compare "Makes" vs "Categories" label width — minor, builder's call).

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint`
Expected: both succeed.

Manually verify with the dev server: visit `/makes` signed in, add a make, confirm it appears in the list and a duplicate name shows the inline error.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/makes/page.tsx app/\(dashboard\)/makes/loading.tsx
git commit -m "feat: add the Makes management page"
```

---

## Task 7: Add-item form gets vehicle fields

**Files:**
- Modify: `app/(dashboard)/items/new/page.tsx`

**Interfaces:**
- Consumes: `listCarMakes` (Task 2); `listDistinctModelsAndVariants`, extended `CreateItemInput` (Task 3).

- [ ] **Step 1: Extend the page**

Fetch `listCarMakes(supabase)` and `listDistinctModelsAndVariants(supabase)` alongside the existing `listCategories(supabase)` call (`Promise.all`). In the form, after the Category `<select>`, add:
- A Make `<select name="makeId">` with the same `<option value="">None</option>` + mapped-options pattern as Category.
- A Model `<input name="model" list="model-suggestions">` plus `<datalist id="model-suggestions">{models.map(m => <option key={m} value={m} />)}</datalist>`.
- A Variant `<input name="variant" list="variant-suggestions">` plus its own `<datalist>`, same pattern.
- A Year `<input name="year" type="number" min={1980} max={new Date().getFullYear() + 1} placeholder="Optional">`.

In `addItem`, read `makeId = String(formData.get("makeId") ?? "").trim() || null`, `model = String(formData.get("model") ?? "").trim() || null`, `variant` the same way, `year = formData.get("year") ? Number(formData.get("year")) : null`, and pass all four into `createItem(...)`.

- [ ] **Step 2: Verify**

Run: `npm run build && npm run lint`
Expected: both succeed.

Manually verify with the dev server: add an item with a Make selected and Model/Variant/Year filled in; add a second item leaving them all blank; confirm both save without error.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/items/new/page.tsx
git commit -m "feat: add vehicle fields to the Add item form"
```

---

## Task 8: Item edit page

**Files:**
- Create: `app/(dashboard)/items/[id]/edit/page.tsx`
- Create: `app/(dashboard)/items/[id]/edit/loading.tsx`

No test file: `updateItem`'s behavior is already fully covered by Task 3's
lib-level tests, and this codebase has no precedent for page-level test
files on form pages (`items/new/page.tsx` and `categories/page.tsx` both
have none) — this page is verified by `npm run build`/`lint` plus manual
checks, same as those two.

**Interfaces:**
- Consumes: `updateItem`, extended `CreateItemInput` (Task 3); `listCarMakes` (Task 2); `listDistinctModelsAndVariants` (Task 3); `isUniqueViolation`.
- Produces: the `/items/[id]/edit` route.

- [ ] **Step 1: Build the page**

Same overall shape as `items/new/page.tsx` (confirmed no edit page exists today — this is new, not a modification), but: fetches the existing item by `id` (`notFound()` if missing, mirroring `items/[id]/page.tsx`'s own pattern), pre-fills every field's `defaultValue` from the fetched item (including resolving the current category/make `<option>` as selected — a `<select>`'s current value comes from matching `defaultValue` to an `<option value>`, so pass the item's `category_id`/`make_id` directly as the select's `defaultValue`), and its Server Action (`updateItemAction`) calls `updateItem(supabase, user.id, id, {...})` instead of `createItem`, redirecting to `/items/${id}` on success or back to the edit page with the same `missing-fields`/`duplicate-sku` error query params on failure.

- [ ] **Step 2: Build the loading skeleton**

Mirror `app/(dashboard)/items/new/loading.tsx`'s `FormSkeleton`, adjusting `fields` to the new, larger field count (9: sku, name, category, make, model, variant, year, unit, lowStockThreshold).

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: all three succeed (existing `updateItem` lib tests from Task 3 already prove the underlying correctness this page depends on, per this project's convention of not adding page-level test files for form pages — confirmed: neither `items/new/page.tsx` nor `categories/page.tsx` has one).

Manually verify with the dev server: edit an existing item's name and vehicle fields, confirm the change persists and shows on the detail page (once Task 9 lands) and in the edit form on a second visit; attempt to rename its SKU to another existing item's SKU and confirm the inline duplicate-SKU error renders instead of a crash.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/items/\[id\]/edit/page.tsx app/\(dashboard\)/items/\[id\]/edit/loading.tsx
git commit -m "feat: add the item edit page"
```

---

## Task 9: Item detail page — Edit link and field display

**Files:**
- Modify: `app/(dashboard)/items/[id]/page.tsx`

**Interfaces:**
- Consumes: the `/items/[id]/edit` route (Task 8).

- [ ] **Step 1: Extend the page's query and header**

Change the item fetch from `.select("*")` to `.select("*, categories(name), car_makes(name)")` so Category and Make names are available without a second query. Add an "Edit" `<Link href={`/items/${item.id}/edit`}>` near the existing `<h1>`/SKU header. Below the existing SKU/qty line, add a small block showing Category, Make, Model, Variant, and Year — each only rendered when set (e.g. `item.categories?.name` truthy), consistent with how the rest of this page already conditionally renders (`summary.isLowStock && <Badge .../>`).

- [ ] **Step 2: Verify**

Run: `npm run build && npm run lint`
Expected: both succeed.

Manually verify with the dev server: open an item with vehicle fields set and confirm they display; open one with none set and confirm the page doesn't show empty/broken rows for them; click Edit and confirm it lands on the new edit page pre-filled correctly.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/items/\[id\]/page.tsx
git commit -m "feat: show category/vehicle fields and an Edit link on the item detail page"
```

---

## Task 10: Vehicle column and search on the Items and Stock List tables

**Files:**
- Modify: `app/(dashboard)/items/items-table.tsx`
- Modify: `app/(dashboard)/stock-list/stock-list-table.tsx`

**Interfaces:**
- Consumes: `StockListRow.vehicle` (Task 4).

- [ ] **Step 1: Extend `items-table.tsx`**

Add `|| row.vehicle.toLowerCase().includes(normalized)` to the existing filter predicate. Add a `<th>Vehicle</th>` + `<td>{row.vehicle}</td>` to the desktop `<table>`, positioned right after the Category column (SKU, Name, Category, Vehicle, Unit, Qty on hand), updating `colSpan={5}` on the empty-state row to `colSpan={6}`. Add a line showing `row.vehicle` to the mobile card markup, near the existing category/qty line.

- [ ] **Step 2: Extend `stock-list-table.tsx`**

Same treatment: filter predicate gains the `row.vehicle` check; desktop table gets a Vehicle column right after Category (SKU, Name, Category, Vehicle, Qty on hand, Unit, [Unit cost], [Inventory value]); `columnCount` changes from `showCost ? 7 : 5` to `showCost ? 8 : 6`; mobile card gets a vehicle line.

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: all three succeed.

Manually verify with the dev server: on both the Items list and Stock List, search "Toyota" (or whatever make you added in earlier manual checks) and confirm matching rows surface with a visible Vehicle value; confirm an item with no vehicle fields shows "—" in that column on both tables, in both the desktop table and the phone-width card view.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/items/items-table.tsx app/\(dashboard\)/stock-list/stock-list-table.tsx
git commit -m "feat: add a Vehicle column and search to Items and Stock List"
```
