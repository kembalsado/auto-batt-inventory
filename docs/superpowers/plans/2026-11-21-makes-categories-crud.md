# Rename + Delete for Makes and Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-only rename and delete to the Makes and Categories
pages, inline on their existing lists, completing CRUD for both (today
they only support Create + Read).

**Architecture:** A new RLS migration grants `categories`/`car_makes`
owner-only update/delete (reusing the existing `is_owner()` helper); two
new `lib/` function pairs (`update*`/`delete*`) follow the existing
`create*` pattern; two new API routes (`PATCH`/`DELETE`) enforce the
owner check explicitly, the same shape as `/api/users/[id]`; one shared
client component, `LookupListTable`, renders both lists' inline
edit/delete UI (the two entities are identical in shape, differing only
in label and API path); both `page.tsx` files are updated to compute the
viewer's `isOwner` and render it.

**Tech Stack:** Next.js 16 (App Router) + React 19, TypeScript, Supabase
(Postgres + RLS), Tailwind v4, lucide-react icons, vitest +
@testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-21-makes-categories-crud-design.md`

## Global Constraints

- Rename/delete are **owner-only**; viewing and adding stay open to any
  authenticated user, unchanged.
- No new page/navigation — rename and delete are inline on the existing
  `/makes` and `/categories` lists (Approach A).
- A blocked delete (the make/category is still referenced by an `items`
  row) must surface a friendly message, never a crash.
- A duplicate rename (name collides with another row) must surface a
  friendly message, never a crash — same existing shape as create's
  duplicate-name handling.
- A blank/whitespace rename is rejected both client-side (Save disabled)
  and server-side (`400`), matching the add forms' `<Input required>`.
- One shared `components/lookup-list-table.tsx`, used directly by both
  pages — not two copy-pasted table files.
- Audit log: every write (`update`, `delete`, per table) gets a
  `recordAudit` call, following the exact action-naming convention
  already in use (`category.created`, `car_make.created`).

## Review Focus

- Deleting a category/make that's still referenced by a real `items` row
  must fail with a friendly "still in use" message, not an unhandled
  500 — exercised with a real FK violation, not a hand-built error
  object. (Tasks 1, 3, 4, 5, 6)
- Renaming a category/make to a name that collides with a different
  existing row must fail with a friendly "already exists" message, not
  an unhandled 500. (Tasks 3, 4, 5, 6)
- An assistant (non-owner) must be unable to rename or delete, in two
  independent layers: the API route returns `403` before touching the
  database, AND the database itself rejects a direct update/delete from
  a signed-in assistant even if the route-level check were bypassed.
  (Tasks 2, 5, 6)
- A blank/whitespace rename must be rejected, not silently saved as an
  empty name (`categories.name`/`car_makes.name` have no CHECK constraint
  against this). (Tasks 5, 7)
- An assistant viewing `/makes` or `/categories` must still see the
  unchanged list + add form, with no Edit/Delete controls rendered at
  all (not just disabled) — regression check that this change doesn't
  alter the read-only experience those two roles already have today.
  (Tasks 7, 8)

---

## Task 1: `isForeignKeyViolation` error classifier

**Files:**
- Modify: `lib/errors.ts`
- Test: `tests/lib/errors.test.ts`

**Interfaces:**
- Produces: `export function isForeignKeyViolation(err: unknown): boolean`
  — true for Postgres SQLSTATE `23503` (`foreign_key_violation`), the same
  shape as the existing `isUniqueViolation` (SQLSTATE `23505`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/errors.test.ts` (reuses the file's existing
`ACTOR_ID`/`categoryId` fixtures from `beforeAll`; add
`createdItemIds`-tracked cleanup the same way the file's existing
`isUniqueViolation` SKU test does):

```ts
import { isForeignKeyViolation } from "@/lib/errors"; // add to existing import

test("isForeignKeyViolation recognises a real blocked-delete rejection", async () => {
  const admin = createAdminClient();
  const sku = `AB-FK-${runId}`;

  const item = await createItem(admin, ACTOR_ID, {
    sku,
    name: "FK test item",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  const { error } = await admin.from("categories").delete().eq("id", categoryId);

  expect(error).not.toBeNull();
  expect(isForeignKeyViolation(error)).toBe(true);
});

test("isForeignKeyViolation is false for other failures", () => {
  expect(isForeignKeyViolation({ code: "23505", message: "duplicate" })).toBe(
    false
  );
  expect(isForeignKeyViolation(new Error("boom"))).toBe(false);
  expect(isForeignKeyViolation(null)).toBe(false);
  expect(isForeignKeyViolation(undefined)).toBe(false);
});
```

Note: this test deletes the shared `categoryId` fixture row itself (via
the FK violation, the delete never actually succeeds), so no change to
`afterAll`'s existing cleanup is needed — the row is still there to clean
up afterward.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/errors.test.ts`
Expected: FAIL — `isForeignKeyViolation` not defined.

- [ ] **Step 3: Implement `isForeignKeyViolation` in `lib/errors.ts`**

Add directly below `isUniqueViolation`, same shape:
`asDatabaseError(err)?.code === "23503"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/errors.ts tests/lib/errors.test.ts
git commit -m "feat: add isForeignKeyViolation error classifier"
```

---

## Task 2: RLS migration — owner-only update/delete on `categories`/`car_makes`

**Files:**
- Create: `supabase/migrations/0019_categories_car_makes_update_delete_rls.sql`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: the existing `is_owner(user_id uuid) returns boolean` SQL
  function (`supabase/migrations/0002_auth_profiles.sql`).
- Produces: RLS policies `categories_update_owner`,
  `categories_delete_owner`, `car_makes_update_owner`,
  `car_makes_delete_owner`. No new base-table grants needed — both tables
  already have `update`/`delete` granted to `authenticated`
  (`0013_authenticated_base_grants.sql`, `0018_car_makes_grants.sql`).

- [ ] **Step 1: Write the migration**

```sql
-- Auto Batt Inventory — owner-only update/delete for categories and car_makes
--
-- 0004_categories_rls.sql and 0016_car_makes.sql deliberately shipped with
-- only select+insert policies ("Renaming/deleting isn't supported yet").
-- This adds update+delete, gated to the owner role only (unlike
-- select/insert, which stay open to any authenticated user) — reusing
-- is_owner() (0002_auth_profiles.sql), the same helper
-- app_settings_update_owner (0009_app_settings_rls.sql) already uses for
-- an identical "read is open, write is owner-only" shape. Base table
-- grants for update/delete already exist on both tables
-- (0013_authenticated_base_grants.sql, 0018_car_makes_grants.sql) — only
-- the RLS policy was missing.

create policy "categories_update_owner"
  on categories for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));

create policy "categories_delete_owner"
  on categories for delete
  to authenticated
  using (is_owner(auth.uid()));

create policy "car_makes_update_owner"
  on car_makes for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));

create policy "car_makes_delete_owner"
  on car_makes for delete
  to authenticated
  using (is_owner(auth.uid()));
```

- [ ] **Step 2: Apply the migration to the local instance**

Run: `supabase start` (if not already running, requires Docker) then
`supabase db reset` — the same way this project's prior migrations are
applied locally (`docs/superpowers/plans/2026-11-13-auto-batt-inventory-mvp.md`).
Expected: no errors; the reset re-runs every migration including the new
one.

- [ ] **Step 3: Write the failing tests**

Add to `tests/db/schema.test.ts` (uses the file's existing
`createAnonClient` helper):

```ts
test("RLS: an owner can update and delete a category directly; an assistant cannot", async () => {
  const admin = createAdminClient();
  const runId = randomUUID().slice(0, 8);

  const { data: category } = await admin
    .from("categories")
    .insert({ name: `rls-cat-${runId}` })
    .select()
    .single();

  const { data: ownerUser } = await admin.auth.admin.createUser({
    email: `test-rls-cat-owner-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  const { data: assistantUser } = await admin.auth.admin.createUser({
    email: `test-rls-cat-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
  });

  try {
    const assistantClient = createAnonClient();
    await assistantClient.auth.signInWithPassword({
      email: `test-rls-cat-assistant-${runId}@example.com`,
      password: "test-password-123",
    });
    // RLS filters a row the USING clause rejects out of the UPDATE's own
    // target set — the call succeeds with zero rows affected, it does not
    // error. Proving the write didn't happen means checking the returned
    // rows, not `error`.
    const { data: assistantUpdateData } = await assistantClient
      .from("categories")
      .update({ name: `rls-cat-${runId}-blocked` })
      .eq("id", category!.id)
      .select();
    expect(assistantUpdateData).toEqual([]);

    const { data: assistantDeleteData } = await assistantClient
      .from("categories")
      .delete()
      .eq("id", category!.id)
      .select();
    expect(assistantDeleteData).toEqual([]);

    const ownerClient = createAnonClient();
    await ownerClient.auth.signInWithPassword({
      email: `test-rls-cat-owner-${runId}@example.com`,
      password: "test-password-123",
    });
    const { data: ownerUpdateData, error: ownerUpdateError } = await ownerClient
      .from("categories")
      .update({ name: `rls-cat-${runId}-renamed` })
      .eq("id", category!.id)
      .select();
    expect(ownerUpdateError).toBeNull();
    expect(ownerUpdateData?.[0]?.name).toBe(`rls-cat-${runId}-renamed`);

    const { data: ownerDeleteData } = await ownerClient
      .from("categories")
      .delete()
      .eq("id", category!.id)
      .select();
    expect(ownerDeleteData).toHaveLength(1);
  } finally {
    await admin.from("categories").delete().eq("id", category!.id);
    await admin
      .from("profiles")
      .delete()
      .in("id", [ownerUser!.user!.id, assistantUser!.user!.id]);
    await admin.auth.admin.deleteUser(ownerUser!.user!.id);
    await admin.auth.admin.deleteUser(assistantUser!.user!.id);
  }
});

test("RLS: an owner can update and delete a car_make directly; an assistant cannot", async () => {
  const admin = createAdminClient();
  const runId = randomUUID().slice(0, 8);

  const { data: make } = await admin
    .from("car_makes")
    .insert({ name: `rls-make-${runId}` })
    .select()
    .single();

  const { data: ownerUser } = await admin.auth.admin.createUser({
    email: `test-rls-make-owner-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  const { data: assistantUser } = await admin.auth.admin.createUser({
    email: `test-rls-make-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
  });

  try {
    const assistantClient = createAnonClient();
    await assistantClient.auth.signInWithPassword({
      email: `test-rls-make-assistant-${runId}@example.com`,
      password: "test-password-123",
    });
    const { data: assistantUpdateData } = await assistantClient
      .from("car_makes")
      .update({ name: `rls-make-${runId}-blocked` })
      .eq("id", make!.id)
      .select();
    expect(assistantUpdateData).toEqual([]);

    const ownerClient = createAnonClient();
    await ownerClient.auth.signInWithPassword({
      email: `test-rls-make-owner-${runId}@example.com`,
      password: "test-password-123",
    });
    const { data: ownerUpdateData, error: ownerUpdateError } = await ownerClient
      .from("car_makes")
      .update({ name: `rls-make-${runId}-renamed` })
      .eq("id", make!.id)
      .select();
    expect(ownerUpdateError).toBeNull();
    expect(ownerUpdateData?.[0]?.name).toBe(`rls-make-${runId}-renamed`);

    const { data: ownerDeleteData } = await ownerClient
      .from("car_makes")
      .delete()
      .eq("id", make!.id)
      .select();
    expect(ownerDeleteData).toHaveLength(1);
  } finally {
    await admin.from("car_makes").delete().eq("id", make!.id);
    await admin
      .from("profiles")
      .delete()
      .in("id", [ownerUser!.user!.id, assistantUser!.user!.id]);
    await admin.auth.admin.deleteUser(ownerUser!.user!.id);
    await admin.auth.admin.deleteUser(assistantUser!.user!.id);
  }
});
```

- [ ] **Step 4: Run tests to verify they fail before the migration, pass after**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: PASS (migration was already applied in Step 2). If you want to
confirm the test actually exercises the policy, temporarily re-run
against a pre-migration reset and confirm the owner-path assertions fail
with a permission/RLS error instead — not required, just a sanity check.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0019_categories_car_makes_update_delete_rls.sql tests/db/schema.test.ts
git commit -m "feat: add owner-only update/delete RLS for categories and car_makes"
```

---

## Task 3: `lib/categories.ts` — `updateCategory` / `deleteCategory`

**Files:**
- Modify: `lib/categories.ts`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (existing import).
- Produces:
  ```ts
  export async function updateCategory(
    supabase: SupabaseClient,
    actorId: string,
    id: string,
    name: string
  ): Promise<Category>;

  export async function deleteCategory(
    supabase: SupabaseClient,
    actorId: string,
    id: string
  ): Promise<void>;
  ```
  Both throw the raw Postgres error on failure (unique violation on
  rename, foreign-key violation on delete) — same as `createCategory`;
  classification happens at the caller (Task 5's API route).

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/categories.test.ts` (reuses the file's existing
`OWNER_ID`/`createdCategoryIds` fixtures):

```ts
import { createCategory, listCategories, updateCategory, deleteCategory } from "@/lib/categories"; // update existing import
import { createItem } from "@/lib/items";

test("updateCategory renames a category and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const category = await createCategory(supabase, OWNER_ID, "Brakes");
  createdCategoryIds.push(category.id);

  const updated = await updateCategory(supabase, OWNER_ID, category.id, "Brake Parts");
  expect(updated.name).toBe("Brake Parts");

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", category.id)
    .eq("action", "category.updated")
    .single();
  expect(log?.summary).toContain("Brake Parts");
});

test("updateCategory rejects renaming to a name that collides with a different category", async () => {
  const supabase = createAdminClient();
  const a = await createCategory(supabase, OWNER_ID, "Coolant");
  const b = await createCategory(supabase, OWNER_ID, "Lubricant");
  createdCategoryIds.push(a.id, b.id);

  await expect(updateCategory(supabase, OWNER_ID, b.id, "Coolant")).rejects.toThrow();
});

test("deleteCategory removes an unused category and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const category = await createCategory(supabase, OWNER_ID, "Wiper Blades");

  await deleteCategory(supabase, OWNER_ID, category.id);

  const { data } = await supabase.from("categories").select("id").eq("id", category.id).maybeSingle();
  expect(data).toBeNull();

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", category.id)
    .eq("action", "category.deleted")
    .single();
  expect(log?.summary).toContain("Wiper Blades");
});

test("deleteCategory rejects deleting a category that's still referenced by an item", async () => {
  const supabase = createAdminClient();
  const category = await createCategory(supabase, OWNER_ID, "In Use Category");
  createdCategoryIds.push(category.id);
  const item = await createItem(supabase, OWNER_ID, {
    sku: `AB-CAT-INUSE-${category.id.slice(0, 8)}`,
    name: "Blocks delete",
    categoryId: category.id,
    unit: "pcs",
  });

  await expect(deleteCategory(supabase, OWNER_ID, category.id)).rejects.toThrow();

  await supabase.from("items").delete().eq("id", item.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: FAIL — `updateCategory`/`deleteCategory` not defined.

- [ ] **Step 3: Implement `updateCategory`/`deleteCategory` in `lib/categories.ts`**

`updateCategory`: `supabase.from("categories").update({ name }).eq("id", id).select().single()`,
throw on error, then `recordAudit` with `action: "category.updated"`,
`entityType: "category"`, `entityId: data.id`,
`summary: \`Updated category ${data.name}\``, return `data`.

`deleteCategory`: `supabase.from("categories").delete().eq("id", id).select().single()`
(the `.select().single()` round-trips the deleted row's `name` for the
audit summary, per the design doc's left-to-builder note — no separate
read needed), throw on error, then `recordAudit` with `action:
"category.deleted"`, `entityType: "category"`, `entityId: id`, `summary:
\`Deleted category ${data.name}\``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/categories.ts tests/lib/categories.test.ts
git commit -m "feat: add updateCategory and deleteCategory"
```

---

## Task 4: `lib/car-makes.ts` — `updateCarMake` / `deleteCarMake`

**Files:**
- Modify: `lib/car-makes.ts`
- Test: `tests/lib/car-makes.test.ts`

**Interfaces:**
- Twin of Task 3. Produces:
  ```ts
  export async function updateCarMake(
    supabase: SupabaseClient,
    actorId: string,
    id: string,
    name: string
  ): Promise<CarMake>;

  export async function deleteCarMake(
    supabase: SupabaseClient,
    actorId: string,
    id: string
  ): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

Mirror Task 3's four tests exactly, against `car_makes`/`createCarMake`/
`updateCarMake`/`deleteCarMake`, naming audit actions `car_make.updated`/
`car_make.deleted`, and the FK-blocked-delete test wiring the new item's
`makeId` instead of `categoryId` (`createItem` needs a `categoryId` too —
reuse the existing `OWNER_ID`-scoped category fixture this file already
sets up, or create one inline and track it in `createdCategoryIds` if
the file doesn't already have one; check `tests/lib/car-makes.test.ts`'s
current `beforeAll` for what's already there).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/car-makes.test.ts`

- [ ] **Step 3: Implement `updateCarMake`/`deleteCarMake` in `lib/car-makes.ts`**

Same shape as Task 3, against `car_makes`, with audit `summary: \`Updated
car make ${data.name}\`` / `\`Deleted car make ${data.name}\`` (matching
`createCarMake`'s existing `Created car make ${data.name}` wording).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/car-makes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/car-makes.ts tests/lib/car-makes.test.ts
git commit -m "feat: add updateCarMake and deleteCarMake"
```

---

## Task 5: `PATCH`/`DELETE /api/categories/[id]`

**Files:**
- Create: `app/api/categories/[id]/route.ts`
- Test: `tests/api/categories.test.ts`

**Interfaces:**
- Consumes: `updateCategory`/`deleteCategory` (Task 3),
  `isUniqueViolation`/`isForeignKeyViolation`/`describeError` (`lib/errors.ts`),
  `getRole` (`lib/permissions.ts`), `createServerClient`
  (`lib/supabase/server.ts`).
- Produces: `PATCH` (body `{ name: string }`) → `200 { ok: true, name }` |
  `400` | `401` | `403`. `DELETE` → `200 { ok: true }` | `400` | `401` |
  `403`.

- [ ] **Step 1: Write the failing tests**

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { createBrowserClient } from "@/lib/supabase/client";
import { createItem } from "@/lib/items";

const BASE_URL = "http://localhost:3000";

async function signInCookieHeader(email: string, password: string): Promise<string> {
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return document.cookie;
}

const createdUserIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdItemIds: string[] = [];

afterAll(async () => {
  const admin = createAdminClient();
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().in("actor_id", createdUserIds);
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
});

describe("PATCH /api/categories/[id]", () => {
  test("owner can rename a category", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-cat-route-owner-1@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: category } = await admin.from("categories").insert({ name: "Route Rename Before" }).select().single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader("test-cat-route-owner-1@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Route Rename After" }),
    });

    expect(res.status).toBe(200);
    const { data: renamed } = await admin.from("categories").select("name").eq("id", category!.id).single();
    expect(renamed?.name).toBe("Route Rename After");
  });

  test("an assistant cannot rename a category", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-cat-route-assistant-1@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);
    const { data: category } = await admin.from("categories").insert({ name: "Route Rename Blocked" }).select().single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader("test-cat-route-assistant-1@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Should Not Rename" }),
    });

    expect(res.status).toBe(403);
    const { data: unchanged } = await admin.from("categories").select("name").eq("id", category!.id).single();
    expect(unchanged?.name).toBe("Route Rename Blocked");
  });

  test("owner renaming to a blank name gets a 400, not a crash", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-cat-route-owner-2@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: category } = await admin.from("categories").insert({ name: "Route Blank Guard" }).select().single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader("test-cat-route-owner-2@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    expect(res.status).toBe(400);
    const { data: unchanged } = await admin.from("categories").select("name").eq("id", category!.id).single();
    expect(unchanged?.name).toBe("Route Blank Guard");
  });

  test("owner renaming to a name that collides with another category gets a friendly 400", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-cat-route-owner-3@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: existing } = await admin.from("categories").insert({ name: "Route Dup Target" }).select().single();
    const { data: toRename } = await admin.from("categories").insert({ name: "Route Dup Source" }).select().single();
    createdCategoryIds.push(existing!.id, toRename!.id);

    const cookie = await signInCookieHeader("test-cat-route-owner-3@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/categories/${toRename!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Route Dup Target" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });
});

describe("DELETE /api/categories/[id]", () => {
  test("owner can delete an unused category", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-cat-route-owner-4@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: category } = await admin.from("categories").insert({ name: "Route Delete Me" }).select().single();

    const cookie = await signInCookieHeader("test-cat-route-owner-4@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    const { data } = await admin.from("categories").select("id").eq("id", category!.id).maybeSingle();
    expect(data).toBeNull();
  });

  test("owner deleting a category still used by an item gets a friendly 400, and the category survives", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-cat-route-owner-5@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: category } = await admin.from("categories").insert({ name: "Route In Use" }).select().single();
    createdCategoryIds.push(category!.id);
    const item = await createItem(admin, owner!.user!.id, {
      sku: `AB-ROUTE-INUSE-${category!.id.slice(0, 8)}`,
      name: "Blocks route delete",
      categoryId: category!.id,
      unit: "pcs",
    });
    createdItemIds.push(item.id);

    const cookie = await signInCookieHeader("test-cat-route-owner-5@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/in use/i);
    const { data } = await admin.from("categories").select("id").eq("id", category!.id).maybeSingle();
    expect(data).not.toBeNull();
  });

  test("an assistant cannot delete a category", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-cat-route-assistant-2@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);
    const { data: category } = await admin.from("categories").insert({ name: "Route Delete Blocked" }).select().single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader("test-cat-route-assistant-2@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(403);
    const { data } = await admin.from("categories").select("id").eq("id", category!.id).maybeSingle();
    expect(data).not.toBeNull();
  });
});
```

(This file needs a live `next dev` server on `localhost:3000`, same
pre-existing dependency as `tests/api/users.test.ts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run `npm run dev` in one terminal (if not already running), then:
Run: `npx vitest run tests/api/categories.test.ts`
Expected: FAIL — route doesn't exist (404s).

- [ ] **Step 3: Implement `app/api/categories/[id]/route.ts`**

Same shape as `app/api/users/[id]/route.ts`'s `PATCH`: `createServerClient()`,
`auth.getUser()` → 401 if missing, fetch own `profiles.role` → 403 if
`getRole(profile) !== "owner"`. `PATCH` then reads `body.name`, trims it,
returns 400 `{ error: "Enter a name." }` if empty, otherwise calls
`updateCategory(supabase, user.id, id, name)` inside a try/catch: on
`isUniqueViolation`, 400 `{ error: "That name already exists." }`; on any
other thrown error, 400 `{ error: describeError(error) }`; on success,
`200 { ok: true, name }`. `DELETE` does the same 401/403 guard, then
calls `deleteCategory(supabase, user.id, id)` in a try/catch: on
`isForeignKeyViolation`, 400 `{ error: "Still in use by one or more
items — remove or reassign them first." }`; on any other thrown error,
400 `{ error: describeError(error) }`; on success, `200 { ok: true }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/categories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/categories/\[id\]/route.ts tests/api/categories.test.ts
git commit -m "feat: add owner-only PATCH/DELETE /api/categories/[id]"
```

---

## Task 6: `PATCH`/`DELETE /api/makes/[id]`

**Files:**
- Create: `app/api/makes/[id]/route.ts`
- Test: `tests/api/makes.test.ts`

**Interfaces:**
- Twin of Task 5, against `updateCarMake`/`deleteCarMake` (Task 4) and
  `car_makes`. Same response shapes.

- [ ] **Step 1: Write the failing tests**

Mirror Task 5's `tests/api/categories.test.ts` test-for-test, against
`car_makes`/`updateCarMake`/`deleteCarMake`/`/api/makes/[id]`, and the
in-use-delete test setting `makeId` instead of `categoryId` on the
fixture item (`createItem` still needs a valid `categoryId` too — create
one inline via `admin.from("categories").insert(...)` and track/clean it
up alongside the make and item).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/makes.test.ts`

- [ ] **Step 3: Implement `app/api/makes/[id]/route.ts`**

Same shape as Task 5, against `updateCarMake`/`deleteCarMake`, with the
same two error messages ("That name already exists." / "Still in use by
one or more items — remove or reassign them first.").

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/makes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/api/makes/\[id\]/route.ts tests/api/makes.test.ts
git commit -m "feat: add owner-only PATCH/DELETE /api/makes/[id]"
```

---

## Task 7: `LookupListTable` shared component

**Files:**
- Create: `components/lookup-list-table.tsx`
- Test: `tests/components/lookup-list-table.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface LookupListItem {
    id: string;
    name: string;
  }

  export function LookupListTable(props: {
    items: LookupListItem[];
    apiBasePath: string; // e.g. "/api/categories"
    noun: string;        // e.g. "category"
    isOwner: boolean;
    emptyLabel: string;  // e.g. "No categories yet."
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LookupListTable } from "@/components/lookup-list-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const items = [
  { id: "1", name: "Batteries" },
  { id: "2", name: "Oil" },
];

test("renders every item's name", () => {
  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={false}
      emptyLabel="No categories yet."
    />
  );
  expect(screen.getByText("Batteries")).toBeInTheDocument();
  expect(screen.getByText("Oil")).toBeInTheDocument();
});

test("renders the empty label when there are no items", () => {
  render(
    <LookupListTable
      items={[]}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={false}
      emptyLabel="No categories yet."
    />
  );
  expect(screen.getByText("No categories yet.")).toBeInTheDocument();
});

test("hides Edit/Delete entirely when isOwner is false", () => {
  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={false}
      emptyLabel="No categories yet."
    />
  );
  expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
});

test("owner can rename an item: Edit swaps to an input, Save calls PATCH, then refreshes", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
  const input = screen.getByDisplayValue("Batteries");
  fireEvent.change(input, { target: { value: "Battery Parts" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories/1",
      expect.objectContaining({ method: "PATCH" })
    )
  );
});

test("Save is disabled while the edit input is blank or whitespace", () => {
  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
  const input = screen.getByDisplayValue("Batteries");
  fireEvent.change(input, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
});

test("owner can delete an item after confirming, which calls DELETE and refreshes", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories/1",
      expect.objectContaining({ method: "DELETE" })
    )
  );
});

test("declining the delete confirmation makes no request", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a failed rename shows the server's error message inline", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "That name already exists." }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() =>
    expect(screen.getByText("That name already exists.")).toBeInTheDocument()
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/lookup-list-table.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/lookup-list-table.tsx`**

`"use client"`. State per component instance: `editingId: string | null`,
`draftName: string`, `pendingId: string | null`, `errorById: Record<string,
string>`. Renders the same `divide-y divide-border` list styling the
current `<ul>` in each page uses, `noun`/`emptyLabel` driving the empty
state exactly as today. When `!isOwner`, each row is just the plain name
(current behavior, unchanged). When `isOwner`: a row not being edited
shows the name plus Edit (pencil icon, `size="sm"`, following
`items/[id]/page.tsx`'s existing `<Pencil>` convention) and Delete
(`variant="destructive"`, following `button.tsx`'s existing variant)
buttons; clicking Edit sets `editingId`/`draftName` and swaps that row
into an `<Input>` (seeded with the current name) plus Save/Cancel —
Save disabled whenever `draftName.trim()` is empty; Cancel resets
`editingId` to `null` with no request. Save calls `fetch(\`${apiBasePath}/${id}\`,
{ method: "PATCH", headers: {"content-type": "application/json"}, body:
JSON.stringify({ name: draftName.trim() }) })`; on a non-ok response, read
`{ error }` from the body and store it in `errorById[id]`, leaving the row
in edit mode; on success, clear `editingId` and call `router.refresh()`
(`useRouter` from `next/navigation`), same pattern as `users-table.tsx`'s
`toggleActive`. Delete calls `window.confirm(\`Delete ${noun} "${name}"? This
can't be undone.\`)` first (bail with no request if declined, matching
`users-table.tsx`'s existing convention); on confirm, `fetch(\`${apiBasePath}/${id}\`,
{ method: "DELETE" })`, same error/refresh handling as Save. Both actions
set/clear `pendingId` around the request and disable that row's own
buttons while pending (not the whole list), mirroring `users-table.tsx`'s
single `pendingId` field.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/lookup-list-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/lookup-list-table.tsx tests/components/lookup-list-table.test.tsx
git commit -m "feat: add shared LookupListTable for Makes/Categories rename+delete"
```

---

## Task 8: Wire Makes and Categories pages to `LookupListTable`

**Files:**
- Modify: `app/(dashboard)/categories/page.tsx`
- Modify: `app/(dashboard)/makes/page.tsx`

**Interfaces:**
- Consumes: `LookupListTable` (Task 7), `getRole` (`lib/permissions.ts`).

- [ ] **Step 1: Wire `categories/page.tsx`**

After the existing `listCategories(supabase)` call, add: fetch the
caller's own profile role (`const { data: { user } } =
await supabase.auth.getUser(); const { data: profile } = await supabase
.from("profiles").select("role").eq("id", user?.id ?? "").single();
const isOwner = getRole(profile) === "owner";` — same shape
`UsersPage`/other owner-gated reads already use). Replace the existing
`<ul className="mt-6 divide-y divide-border">...</ul>` block with
`<LookupListTable items={categories} apiBasePath="/api/categories"
noun="category" isOwner={isOwner} emptyLabel="No categories yet." />`.
Import `getRole` from `@/lib/permissions` and `LookupListTable` from
`@/components/lookup-list-table`. The add form and `addCategory` Server
Action are unchanged.

- [ ] **Step 2: Wire `makes/page.tsx`**

Same change, against `listCarMakes`, `apiBasePath="/api/makes"`,
`noun="make"`, `emptyLabel="No makes yet."`.

- [ ] **Step 3: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: all tests pass, no lint errors.

- [ ] **Step 4: Manual check**

Run: `npm run dev`, sign in as an owner, visit `/categories` and
`/makes`: confirm Edit/Delete appear, rename and delete both work and
update the list without a full reload, and deleting a category/make
still in use by an item shows the friendly error. Sign in as an
assistant: confirm the list and add form render exactly as before, with
no Edit/Delete controls.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/categories/page.tsx" "app/(dashboard)/makes/page.tsx"
git commit -m "feat: wire Makes/Categories pages to LookupListTable"
```
