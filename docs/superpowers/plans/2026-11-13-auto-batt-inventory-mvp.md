# Auto Batt Inventory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Auto Batt's two Excel files with a web app that tracks inventory by cost-batch (FIFO), gives the owner and assistant role-appropriate access, emails a daily summary, and exports a printable stock list — all on free-tier infrastructure.

**Architecture:** A Next.js (App Router) app deployed on Vercel, with Supabase as the database/auth backend. All stock-affecting mutations (recording a delivery, recording a sale, voiding a mistake) run as atomic Postgres functions (`SECURITY DEFINER`, row-locked) so FIFO allocation and audit logging can never drift out of sync, even under concurrent use. A Vercel Cron job triggers the daily email via Resend.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Tailwind CSS + shadcn/ui, Supabase (Postgres + Auth, via Supabase CLI for local dev and migrations), Vitest + Testing Library for tests, Resend + `@react-email/components` for email, `@react-pdf/renderer` for PDF export, `exceljs` for Excel export, Vercel (Hobby) for hosting and cron.

**Spec:** `docs/superpowers/specs/2026-11-13-auto-batt-inventory-design.md`

## Global Constraints

- All money values are Philippine pesos (₱); no currency conversion or multi-currency support.
- "End of day" / daily email timing is Asia/Manila time.
- Must run entirely on free tiers: Vercel Hobby, Supabase Free, Resend Free (100 emails/day).
- All quantity columns are `numeric`, not integer, so fractional-unit items never require a schema change.
- `stock_movements` and `audit_log` are append-only: rows are never updated to change their recorded facts and never deleted. Corrections happen by voiding (flagging) a movement and recording a fresh one.
- `record_stock_out` must reject (raise, not silently clamp) when requested quantity exceeds total `qty_remaining` across the item's batches — oversell is always blocked.
- Cost-sensitive fields (`unit_cost`, computed inventory value) are hidden from the `assistant` role unless `app_settings.show_cost_to_assistant = true` — enforced server-side (RLS and/or query filtering), not just hidden in the UI.
- `audit_log` is readable only by the `owner` role.
- No profit/margin/P&L calculation anywhere in the system.
- No returns/damaged-stock/shrinkage entry type in this MVP — only `IN` and `OUT`.
- Every item has a unique `sku`.

## Review Focus

- Two sales recorded for the same item at nearly the same time must not both read the same "available" batch state and jointly oversell it — `record_stock_out` must serialize via row locking, not just application-level checks.
- Voiding an `IN` whose batch has already been partially sold must be rejected with a clear error, not silently partial-reverse or corrupt `qty_remaining`.
- An `assistant` calling the data layer directly (RPC/API), not just using the UI, must still get cost fields stripped when `show_cost_to_assistant` is false — hiding it only in a React component is not sufficient.
- The daily email cron must not error on a day with zero items, zero movements, and zero low-stock items — it should run cleanly and (per spec) skip sending rather than throw.
- Importing opening stock with a SKU that already exists in the system must be rejected with a clear per-row error, not create a duplicate item or silently overwrite the existing one.

---

## File Structure

```
/app
  /(auth)/login/page.tsx                    - login form
  /(dashboard)/layout.tsx                   - sidebar shell, branding, role-gated nav
  /(dashboard)/page.tsx                     - dashboard home (summary cards)
  /(dashboard)/items/page.tsx               - items list
  /(dashboard)/items/new/page.tsx           - new item form
  /(dashboard)/items/[id]/page.tsx          - item detail: batches, movement history, void buttons
  /(dashboard)/categories/page.tsx          - category list/create
  /(dashboard)/stock-list/page.tsx          - printable stock list + export buttons
  /(dashboard)/activity/page.tsx            - audit log (owner only)
  /(dashboard)/settings/page.tsx            - app_settings (cost visibility, thresholds, email)
  /(dashboard)/users/page.tsx               - Add User (owner only)
  /(dashboard)/import/page.tsx              - Opening Stock Import
  /api/cron/daily-email/route.ts            - Vercel Cron target
  /api/stock-list/pdf/route.ts              - PDF export
  /api/stock-list/excel/route.ts            - Excel export
  /api/users/route.ts                       - admin create-user endpoint
/lib
  /supabase/client.ts                       - browser Supabase client
  /supabase/server.ts                       - server Supabase client (user session)
  /supabase/admin.ts                        - service-role client (admin-only actions)
  /audit.ts                                 - recordAudit() helper
  /permissions.ts                           - role + cost-visibility helpers
  /stock-list.ts                            - shared data-shaping for view/PDF/Excel export
  /email/dailySummary.ts                    - data-gathering for the daily email
  /email/DailySummaryEmail.tsx              - React Email template
/supabase/migrations/*.sql                  - schema, RLS policies, Postgres functions
/tests/...                                  - Vitest integration/unit tests (mirrors above)
```

---

## Task 1: Project Scaffold & Deploy Pipeline

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `vercel.json`
- Test: `tests/app/page.test.tsx`

**Interfaces:**
- Produces: a deployable Next.js app at the project root; `npm run build`, `npm run dev`, `npm test` scripts.

- [ ] **Step 1: Scaffold the app**

Run `npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*"`, then initialize shadcn/ui (`npx shadcn@latest init`) and Vitest + Testing Library (`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`). Add a `test` script in `package.json` running Vitest.

- [ ] **Step 2: Write a smoke test**

```tsx
// tests/app/page.test.tsx
import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

test("renders the home page without crashing", () => {
  render(<Page />);
  expect(document.body).toBeDefined();
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Initialize git and commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js app"
```

- [ ] **Step 5: Create the Vercel project and deploy**

Run `vercel link` then `vercel --prod` (or connect the GitHub repo in the Vercel dashboard). Confirm the deployed URL serves the home page.

- [ ] **Step 6: Commit `vercel.json` if created by the link step**

```bash
git add vercel.json
git commit -m "chore: link Vercel project"
```

---

## Task 2: Supabase Project & Core Schema

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: tables `categories`, `items`, `batches`, `stock_movements`, `movement_allocations`, `app_settings`, `profiles`, `audit_log`, matching the design doc's Data Model section (all quantity/cost columns `numeric`). `createBrowserClient()` in `lib/supabase/client.ts`, `createServerClient()` in `lib/supabase/server.ts`, `createAdminClient()` in `lib/supabase/admin.ts` (service-role key, server-only).

- [ ] **Step 1: Create the Supabase project and install the CLI**

Create a Supabase project (free tier) via the dashboard. Install the Supabase CLI, run `supabase init`, link to the project with `supabase link`, and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (and as Vercel project env vars).

- [ ] **Step 2: Write the schema migration**

In `supabase/migrations/0001_init.sql`, define:
- `categories(id uuid pk default gen_random_uuid(), name text not null unique, created_at timestamptz default now())`
- `items(id uuid pk, sku text not null unique, name text not null, category_id uuid references categories, unit text not null default 'pcs', low_stock_threshold numeric, is_active boolean default true, created_by uuid, created_at timestamptz default now())`
- `batches(id uuid pk, item_id uuid references items not null, batch_date date not null, qty_received numeric not null, qty_remaining numeric not null, unit_cost numeric not null, source text not null check (source in ('purchase','opening_stock')), note text, created_by uuid, created_at timestamptz default now())`
- `stock_movements(id uuid pk, item_id uuid references items not null, type text not null check (type in ('IN','OUT')), quantity numeric not null, batch_id uuid references batches, movement_date date not null default current_date, note text, voided_at timestamptz, voided_by uuid, reverses_movement_id uuid references stock_movements, created_by uuid, created_at timestamptz default now())`
- `movement_allocations(id uuid pk, movement_id uuid references stock_movements not null, batch_id uuid references batches not null, qty_allocated numeric not null, unit_cost_at_allocation numeric not null)`
- `app_settings(id int primary key default 1, show_cost_to_assistant boolean not null default false, default_low_stock_threshold numeric not null default 5, notification_emails text[] not null default '{}', daily_email_send_time time not null default '20:00', check (id = 1))`, seeded with one row.
- `profiles(id uuid primary key references auth.users, full_name text, role text not null check (role in ('owner','assistant')))`
- `audit_log(id uuid pk, actor_id uuid references profiles, action text not null, entity_type text not null, entity_id uuid, summary text not null, details jsonb, created_at timestamptz default now())`

Enable RLS on every table (`alter table ... enable row level security`); do not add policies yet beyond a placeholder deny-all — policies land per-feature in later tasks.

- [ ] **Step 3: Apply the migration locally and verify**

Run `supabase start` (requires Docker) then `supabase db reset` to apply migrations against the local instance.

- [ ] **Step 4: Write a schema smoke test**

```ts
// tests/db/schema.test.ts
import { createAdminClient } from "@/lib/supabase/admin";

test("app_settings has exactly one seeded row", async () => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("app_settings").select("*");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data![0].show_cost_to_assistant).toBe(false);
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/db/schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0001_init.sql lib/supabase tests/db/schema.test.ts
git commit -m "feat: core database schema"
```

---

## Task 3: Auth & Profiles

**Files:**
- Create: `supabase/migrations/0002_auth_profiles.sql` (trigger + RLS for `profiles`)
- Create: `app/(auth)/login/page.tsx`, `middleware.ts`
- Test: `tests/auth/signup-profile.test.ts`, `tests/auth/route-protection.test.tsx`

**Interfaces:**
- Consumes: `createServerClient()` from Task 2.
- Produces: `middleware.ts` redirects unauthenticated requests to `(dashboard)` routes to `/login`. A new `auth.users` row always produces a matching `profiles` row with `role = 'assistant'` by default.

- [ ] **Step 1: Write the failing integration test for the profile trigger**

```ts
// tests/auth/signup-profile.test.ts
import { createAdminClient } from "@/lib/supabase/admin";

test("creating an auth user creates a default assistant profile", async () => {
  const admin = createAdminClient();
  const { data: user } = await admin.auth.admin.createUser({
    email: "test-assistant@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user!.user!.id)
    .single();
  expect(profile?.role).toBe("assistant");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/auth/signup-profile.test.ts`
Expected: FAIL (no profile row created)

- [ ] **Step 3: Write the migration**

In `0002_auth_profiles.sql`: a trigger function `handle_new_user()` that inserts into `profiles(id, full_name, role)` on `auth.users` insert, defaulting `role` to `'assistant'` (reading `role` from `raw_user_meta_data` if present, so the Add User screen in Task 15 can set `'owner'` or `'assistant'` explicitly). Add RLS policies: any authenticated user can `select` their own profile row; only `owner` can `select` all profiles.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/auth/signup-profile.test.ts`
Expected: PASS

- [ ] **Step 5: Build the login page and route-protection middleware**

`app/(auth)/login/page.tsx`: email/password form calling `supabase.auth.signInWithPassword`. `middleware.ts`: redirects to `/login` when there's no session on any `(dashboard)` route.

- [ ] **Step 6: Write the route-protection test**

```tsx
// tests/auth/route-protection.test.tsx
test("unauthenticated request to a dashboard route redirects to /login", async () => {
  const res = await fetch("http://localhost:3000/items", { redirect: "manual" });
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toContain("/login");
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- tests/auth/route-protection.test.tsx` (against `npm run dev` or a test server)
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0002_auth_profiles.sql app/\(auth\) middleware.ts tests/auth
git commit -m "feat: auth, profiles, and route protection"
```

---

## Task 4: App Shell & Branding

**Files:**
- Create: `app/(dashboard)/layout.tsx`, `components/sidebar.tsx`, `lib/permissions.ts`
- Modify: `tailwind.config.ts` (brand color tokens)
- Test: `tests/components/sidebar.test.tsx`

**Interfaces:**
- Produces: `getRole(profile): "owner" | "assistant"` and `canSeeCost(profile, settings): boolean`, `isOwnerOnlyRoute(path): boolean` in `lib/permissions.ts`, used by the sidebar now and by server routes/RLS-adjacent checks in later tasks.

- [ ] **Step 1: Sample the logo's colors and set Tailwind theme tokens**

In `tailwind.config.ts`, add `colors.brand.green` and `colors.brand.ink` sampled from the provided logo file, used as the primary accent and text color respectively.

- [ ] **Step 2: Write the failing sidebar test**

```tsx
// tests/components/sidebar.test.tsx
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/sidebar";

test("assistant role does not see Users, Activity, or Settings links", () => {
  render(<Sidebar role="assistant" />);
  expect(screen.queryByText("Users")).toBeNull();
  expect(screen.queryByText("Activity")).toBeNull();
  expect(screen.queryByText("Settings")).toBeNull();
});

test("owner role sees Users, Activity, and Settings links", () => {
  render(<Sidebar role="owner" />);
  expect(screen.getByText("Users")).toBeInTheDocument();
  expect(screen.getByText("Activity")).toBeInTheDocument();
  expect(screen.getByText("Settings")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- tests/components/sidebar.test.tsx`
Expected: FAIL (component doesn't exist)

- [ ] **Step 4: Implement `Sidebar({ role }: { role: "owner" | "assistant" })` in `components/sidebar.tsx`**

Links: Dashboard, Items, Categories, Stock List (all roles); Users, Activity, Settings (owner only). Include the Auto Batt logo at the top. Implement `getRole`/`isOwnerOnlyRoute` in `lib/permissions.ts` and use them here.

- [ ] **Step 5: Build `app/(dashboard)/layout.tsx`**

Fetches the current user's profile server-side, renders `<Sidebar role={profile.role} />` plus a content area, redirecting owner-only routes to `/` for an assistant.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- tests/components/sidebar.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tailwind.config.ts app/\(dashboard\)/layout.tsx components/sidebar.tsx lib/permissions.ts tests/components/sidebar.test.tsx
git commit -m "feat: dashboard shell and branding"
```

---

## Task 5: Audit Log Writer

**Files:**
- Create: `supabase/migrations/0003_audit_log_rls.sql`
- Create: `lib/audit.ts`
- Test: `tests/lib/audit.test.ts`

**Interfaces:**
- Produces: `recordAudit(supabase, { actorId, action, entityType, entityId, summary, details }): Promise<void>` in `lib/audit.ts`. Every later mutating task (6 onward) calls this.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/audit.test.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";

test("recordAudit inserts a row with the given fields", async () => {
  const supabase = createAdminClient();
  await recordAudit(supabase, {
    actorId: "00000000-0000-0000-0000-000000000001",
    action: "item.created",
    entityType: "item",
    entityId: "00000000-0000-0000-0000-000000000002",
    summary: "Created item AB-001",
  });
  const { data } = await supabase
    .from("audit_log")
    .select("*")
    .eq("action", "item.created")
    .single();
  expect(data?.summary).toBe("Created item AB-001");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/lib/audit.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the RLS migration**

In `0003_audit_log_rls.sql`: policy allowing any authenticated user to `insert` into `audit_log`; policy allowing `select` only when the requester's `profiles.role = 'owner'`.

- [ ] **Step 4: Implement `recordAudit` in `lib/audit.ts`**

Thin wrapper inserting one row into `audit_log` with the given fields and `created_at: now()`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/lib/audit.test.ts`
Expected: PASS

- [ ] **Step 6: Write and run an RLS test confirming an assistant cannot select from `audit_log`**

```ts
test("assistant role cannot read audit_log", async () => {
  const assistantClient = /* client authenticated as an assistant test user */;
  const { data, error } = await assistantClient.from("audit_log").select("*");
  expect(data).toEqual([]);
});
```

Run: `npm test -- tests/lib/audit.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0003_audit_log_rls.sql lib/audit.ts tests/lib/audit.test.ts
git commit -m "feat: audit log writer and RLS"
```

---

## Task 6: Categories CRUD

**Files:**
- Create: `supabase/migrations/0004_categories_rls.sql`
- Create: `app/(dashboard)/categories/page.tsx`, `lib/categories.ts`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (Task 5).
- Produces: `createCategory(supabase, actorId, name): Promise<Category>`, `listCategories(supabase): Promise<Category[]>` in `lib/categories.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/categories.test.ts
test("createCategory inserts a category and writes an audit log entry", async () => {
  const supabase = createAdminClient();
  const category = await createCategory(supabase, OWNER_ID, "Batteries");
  expect(category.name).toBe("Batteries");
  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", category.id)
    .single();
  expect(log?.action).toBe("category.created");
});

test("createCategory rejects a duplicate name", async () => {
  const supabase = createAdminClient();
  await createCategory(supabase, OWNER_ID, "Oil");
  await expect(createCategory(supabase, OWNER_ID, "Oil")).rejects.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/lib/categories.test.ts`
Expected: FAIL

- [ ] **Step 3: Write RLS migration allowing any authenticated user to read/insert `categories`**

- [ ] **Step 4: Implement `createCategory` and `listCategories` in `lib/categories.ts`**

`createCategory` inserts, then calls `recordAudit` with `action: "category.created"`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/lib/categories.test.ts`
Expected: PASS

- [ ] **Step 6: Build `app/(dashboard)/categories/page.tsx`**

Simple list + "add category" form calling `createCategory`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_categories_rls.sql app/\(dashboard\)/categories lib/categories.ts tests/lib/categories.test.ts
git commit -m "feat: categories CRUD"
```

---

## Task 7: Items CRUD

**Files:**
- Create: `supabase/migrations/0005_items_rls.sql`
- Create: `app/(dashboard)/items/page.tsx`, `app/(dashboard)/items/new/page.tsx`, `lib/items.ts`
- Test: `tests/lib/items.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (Task 5), `listCategories` (Task 6).
- Produces: `createItem(supabase, actorId, { sku, name, categoryId, unit, lowStockThreshold }): Promise<Item>`, `listItems(supabase): Promise<Item[]>` in `lib/items.ts`. Later tasks (8, 9, 12) look up items via `listItems`/a future `getItem`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/items.test.ts
test("createItem succeeds with a unique SKU", async () => {
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: "AB-001", name: "12V Battery", categoryId: batteriesCategoryId,
    unit: "pcs", lowStockThreshold: 5,
  });
  expect(item.sku).toBe("AB-001");
});

test("createItem rejects a duplicate SKU", async () => {
  await createItem(supabase, ASSISTANT_ID, { sku: "AB-002", name: "Battery", categoryId, unit: "pcs" });
  await expect(
    createItem(supabase, ASSISTANT_ID, { sku: "AB-002", name: "Other", categoryId, unit: "pcs" })
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/lib/items.test.ts`
Expected: FAIL

- [ ] **Step 3: Write RLS migration** allowing any authenticated user to `select`/`insert`/`update` `items`.

- [ ] **Step 4: Implement `createItem` and `listItems` in `lib/items.ts`**

`createItem` inserts (relying on the DB's `unique` constraint on `sku` to produce the duplicate error) and calls `recordAudit` with `action: "item.created"`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/lib/items.test.ts`
Expected: PASS

- [ ] **Step 6: Build the items list and new-item form pages**

`app/(dashboard)/items/page.tsx` lists items (name, SKU, category, current qty — qty computed in Task 12). `app/(dashboard)/items/new/page.tsx` is the create form, usable by both roles.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0005_items_rls.sql app/\(dashboard\)/items lib/items.ts tests/lib/items.test.ts
git commit -m "feat: items CRUD"
```

---

## Task 8: Record Stock IN

**Files:**
- Create: `supabase/migrations/0006_record_stock_in.sql` (Postgres function `record_stock_in`)
- Create: `lib/movements.ts` (IN half), `app/(dashboard)/items/[id]/stock-in-form.tsx`
- Test: `tests/db/record-stock-in.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (Task 5), item from `listItems`/`createItem` (Task 7).
- Produces: `recordStockIn(supabase, actorId, { itemId, qty, unitCost, batchDate, note }): Promise<{ movementId: string; batchId: string }>` in `lib/movements.ts`, calling the `record_stock_in` RPC. Later tasks (9, 10, 12) read `batches`/`stock_movements` rows this produces.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/record-stock-in.test.ts
test("recordStockIn creates a batch with qty_remaining = qty_received", async () => {
  const { batchId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId, qty: 10, unitCost: 1000, batchDate: "2026-11-12",
  });
  const { data: batch } = await supabase.from("batches").select("*").eq("id", batchId).single();
  expect(batch?.qty_received).toBe(10);
  expect(batch?.qty_remaining).toBe(10);
  expect(batch?.unit_cost).toBe(1000);
});

test("recordStockIn writes an audit log entry", async () => {
  const { movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId, qty: 5, unitCost: 500, batchDate: "2026-11-13",
  });
  const { data: log } = await supabase.from("audit_log").select("*").eq("entity_id", movementId).single();
  expect(log?.action).toBe("movement.created");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/db/record-stock-in.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the `record_stock_in` Postgres function**

In `0006_record_stock_in.sql`, a `SECURITY DEFINER` function taking `(p_item_id uuid, p_qty numeric, p_unit_cost numeric, p_batch_date date, p_note text, p_actor_id uuid)`: inserts a `batches` row (`source = 'purchase'`, `qty_received = qty_remaining = p_qty`), inserts a matching `stock_movements` row (`type = 'IN'`, `batch_id` = the new batch), returns both ids.

- [ ] **Step 4: Implement `recordStockIn` in `lib/movements.ts`**

Calls `supabase.rpc('record_stock_in', {...})`, then calls `recordAudit` with `action: "movement.created"`, `entity_type: "stock_movement"`, `entity_id: movementId`, `summary` describing the IN (e.g. `"IN 10x AB-001 @ ₱1000"`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/db/record-stock-in.test.ts`
Expected: PASS

- [ ] **Step 6: Build the stock-in form**

`stock-in-form.tsx` on the item detail page: quantity, unit cost, date (defaults to today), note. Calls `recordStockIn`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0006_record_stock_in.sql lib/movements.ts app/\(dashboard\)/items/\[id\]/stock-in-form.tsx tests/db/record-stock-in.test.ts
git commit -m "feat: record stock IN with batch creation"
```

---

## Task 9: Record Stock OUT (FIFO Allocation)

**Files:**
- Create: `supabase/migrations/0007_record_stock_out.sql` (Postgres function `record_stock_out`)
- Modify: `lib/movements.ts` (OUT half)
- Create: `app/(dashboard)/items/[id]/stock-out-form.tsx`
- Test: `tests/db/record-stock-out.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (Task 5), batches created by `recordStockIn` (Task 8).
- Produces: `recordStockOut(supabase, actorId, { itemId, qty, movementDate, note }): Promise<{ movementId: string }>` in `lib/movements.ts`. Later tasks (10, 12) read `movement_allocations` rows this produces.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/record-stock-out.test.ts
test("recordStockOut allocates from the oldest batch first", async () => {
  const batch1 = await recordStockIn(supabase, ASSISTANT_ID, { itemId, qty: 10, unitCost: 1000, batchDate: "2026-06-01" });
  const batch2 = await recordStockIn(supabase, ASSISTANT_ID, { itemId, qty: 10, unitCost: 1500, batchDate: "2026-07-01" });

  await recordStockOut(supabase, ASSISTANT_ID, { itemId, qty: 12, movementDate: "2026-07-15" });

  const { data: b1 } = await supabase.from("batches").select("qty_remaining").eq("id", batch1.batchId).single();
  const { data: b2 } = await supabase.from("batches").select("qty_remaining").eq("id", batch2.batchId).single();
  expect(b1?.qty_remaining).toBe(0);
  expect(b2?.qty_remaining).toBe(8);
});

test("recordStockOut rejects when requested quantity exceeds available stock", async () => {
  await recordStockIn(supabase, ASSISTANT_ID, { itemId: itemId2, qty: 3, unitCost: 1000, batchDate: "2026-07-01" });
  await expect(
    recordStockOut(supabase, ASSISTANT_ID, { itemId: itemId2, qty: 5, movementDate: "2026-07-15" })
  ).rejects.toThrow(/insufficient stock/i);
});

test("two concurrent OUT requests against the same 10-unit batch never jointly oversell", async () => {
  const batch = await recordStockIn(supabase, ASSISTANT_ID, { itemId: itemId3, qty: 10, unitCost: 1000, batchDate: "2026-07-01" });
  const results = await Promise.allSettled([
    recordStockOut(supabase, ASSISTANT_ID, { itemId: itemId3, qty: 7, movementDate: "2026-07-15" }),
    recordStockOut(supabase, ASSISTANT_ID, { itemId: itemId3, qty: 7, movementDate: "2026-07-15" }),
  ]);
  const succeeded = results.filter((r) => r.status === "fulfilled");
  expect(succeeded).toHaveLength(1);
  const { data: b } = await supabase.from("batches").select("qty_remaining").eq("id", batch.batchId).single();
  expect(b?.qty_remaining).toBe(3);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/db/record-stock-out.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the `record_stock_out` Postgres function**

In `0007_record_stock_out.sql`, a `SECURITY DEFINER` function `(p_item_id uuid, p_qty numeric, p_movement_date date, p_note text, p_actor_id uuid)`: selects the item's batches with `qty_remaining > 0` ordered by `batch_date asc, id asc`, locked with `FOR UPDATE`; if the sum of `qty_remaining` is less than `p_qty`, raise an exception with message `insufficient stock`; otherwise walk the batches decrementing `qty_remaining` and inserting one `movement_allocations` row per batch touched (`unit_cost_at_allocation` = that batch's `unit_cost`), then insert the `stock_movements` row (`type = 'OUT'`). Return the movement id. The row lock on `batches` is what makes the concurrent test above safe.

- [ ] **Step 4: Implement `recordStockOut` in `lib/movements.ts`**

Calls `supabase.rpc('record_stock_out', {...})`, translates a Postgres exception containing "insufficient stock" into a typed error, then calls `recordAudit` with `action: "movement.created"` and a summary (e.g. `"OUT 12x AB-001"`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/db/record-stock-out.test.ts`
Expected: PASS

- [ ] **Step 6: Build the stock-out form**

`stock-out-form.tsx`: quantity, date, note. On the "insufficient stock" error, shows the current available quantity so the user understands why it was rejected.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0007_record_stock_out.sql lib/movements.ts app/\(dashboard\)/items/\[id\]/stock-out-form.tsx tests/db/record-stock-out.test.ts
git commit -m "feat: record stock OUT with FIFO allocation"
```

---

## Task 10: Void / Correction

**Files:**
- Create: `supabase/migrations/0008_void_movement.sql` (Postgres function `void_movement`)
- Modify: `lib/movements.ts`
- Modify: `app/(dashboard)/items/[id]/page.tsx` (void button on each movement row)
- Test: `tests/db/void-movement.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (Task 5), movements from Tasks 8–9.
- Produces: `voidMovement(supabase, actorId, movementId): Promise<void>` in `lib/movements.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/void-movement.test.ts
test("voiding an untouched IN zeroes out the batch", async () => {
  const { movementId, batchId } = await recordStockIn(supabase, ASSISTANT_ID, { itemId, qty: 10, unitCost: 1000, batchDate: "2026-07-01" });
  await voidMovement(supabase, OWNER_ID, movementId);
  const { data: batch } = await supabase.from("batches").select("qty_remaining").eq("id", batchId).single();
  expect(batch?.qty_remaining).toBe(0);
  const { data: movement } = await supabase.from("stock_movements").select("voided_at").eq("id", movementId).single();
  expect(movement?.voided_at).not.toBeNull();
});

test("voiding an IN that has already been partially sold is rejected", async () => {
  const { movementId } = await recordStockIn(supabase, ASSISTANT_ID, { itemId: itemId2, qty: 10, unitCost: 1000, batchDate: "2026-07-01" });
  await recordStockOut(supabase, ASSISTANT_ID, { itemId: itemId2, qty: 2, movementDate: "2026-07-02" });
  await expect(voidMovement(supabase, OWNER_ID, movementId)).rejects.toThrow(/already been sold/i);
});

test("voiding an OUT restores quantity across every batch it drew from", async () => {
  const batch1 = await recordStockIn(supabase, ASSISTANT_ID, { itemId: itemId3, qty: 5, unitCost: 1000, batchDate: "2026-06-01" });
  const batch2 = await recordStockIn(supabase, ASSISTANT_ID, { itemId: itemId3, qty: 5, unitCost: 1500, batchDate: "2026-07-01" });
  const { movementId } = await recordStockOut(supabase, ASSISTANT_ID, { itemId: itemId3, qty: 7, movementDate: "2026-07-15" });

  await voidMovement(supabase, OWNER_ID, movementId);

  const { data: b1 } = await supabase.from("batches").select("qty_remaining").eq("id", batch1.batchId).single();
  const { data: b2 } = await supabase.from("batches").select("qty_remaining").eq("id", batch2.batchId).single();
  expect(b1?.qty_remaining).toBe(5);
  expect(b2?.qty_remaining).toBe(5);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/db/void-movement.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the `void_movement` Postgres function**

In `0008_void_movement.sql`, `SECURITY DEFINER` function `(p_movement_id uuid, p_actor_id uuid)`: loads the movement; if already voided, raise `already voided`; if `type = 'IN'`, load its batch and raise `this item has already been sold from this batch` unless `qty_remaining = qty_received`, else set `qty_remaining = 0`; if `type = 'OUT'`, loop its `movement_allocations` rows and add `qty_allocated` back onto each batch's `qty_remaining`; finally set `voided_at = now()`, `voided_by = p_actor_id` on the movement row.

- [ ] **Step 4: Implement `voidMovement` in `lib/movements.ts`**

Calls `supabase.rpc('void_movement', {...})`, translates known Postgres exceptions into typed errors, then calls `recordAudit` with `action: "movement.voided"` and a summary referencing the original movement.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/db/void-movement.test.ts`
Expected: PASS

- [ ] **Step 6: Add a "Void" button to each non-voided movement row on the item detail page**

Confirms before calling `voidMovement`; voided rows render struck-through rather than disappearing.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0008_void_movement.sql lib/movements.ts app/\(dashboard\)/items/\[id\]/page.tsx tests/db/void-movement.test.ts
git commit -m "feat: void/correction for stock movements"
```

---

## Task 11: Cost Visibility & Settings

**Files:**
- Create: `supabase/migrations/0009_app_settings_rls.sql`
- Create: `app/(dashboard)/settings/page.tsx`, `lib/settings.ts`
- Modify: `lib/permissions.ts` (`canSeeCost`)
- Modify: `lib/items.ts`, `lib/movements.ts` (strip cost fields server-side when not permitted)
- Test: `tests/lib/cost-visibility.test.ts`

**Interfaces:**
- Consumes: `app_settings` row (Task 2), `getRole`/`canSeeCost` (Task 4/this task).
- Produces: `getSettings(supabase): Promise<AppSettings>`, `updateSettings(supabase, actorId, patch): Promise<AppSettings>` in `lib/settings.ts`. `canSeeCost(role, settings): boolean` in `lib/permissions.ts`, used by Tasks 12 and 13's data-shaping.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/cost-visibility.test.ts
test("canSeeCost is false for assistant when show_cost_to_assistant is false", () => {
  expect(canSeeCost("assistant", { showCostToAssistant: false })).toBe(false);
});

test("canSeeCost is true for assistant when show_cost_to_assistant is true", () => {
  expect(canSeeCost("assistant", { showCostToAssistant: true })).toBe(true);
});

test("canSeeCost is always true for owner", () => {
  expect(canSeeCost("owner", { showCostToAssistant: false })).toBe(true);
});

test("an assistant RPC call for batch data never receives unit_cost when cost is hidden", async () => {
  await updateSettings(adminClient, OWNER_ID, { showCostToAssistant: false });
  const assistantClient = /* client authenticated as an assistant test user */;
  const batches = await getItemBatchesForViewer(assistantClient, itemId);
  expect(batches.every((b) => b.unit_cost === undefined)).toBe(true);
});

test("updateSettings writes an audit log entry", async () => {
  await updateSettings(adminClient, OWNER_ID, { showCostToAssistant: true });
  const { data: log } = await adminClient.from("audit_log").select("*").eq("action", "settings.updated").order("created_at", { ascending: false }).limit(1).single();
  expect(log).toBeTruthy();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/lib/cost-visibility.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the RLS migration**

In `0009_app_settings_rls.sql`: any authenticated user can `select` `app_settings`; only `owner` can `update` it.

- [ ] **Step 4: Implement `canSeeCost`, `getSettings`, `updateSettings`, and `getItemBatchesForViewer`**

`canSeeCost(role, settings)` returns `role === "owner" || settings.showCostToAssistant`. `updateSettings` updates the single `app_settings` row and calls `recordAudit` with `action: "settings.updated"`. `getItemBatchesForViewer(supabase, itemId)` fetches the caller's role and settings server-side, then strips `unit_cost` from each returned batch (and from any computed inventory value) whenever `canSeeCost` is false — enforced in this shared function so every caller (item detail page, stock list, exports) gets it automatically rather than relying on each UI component to hide it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/lib/cost-visibility.test.ts`
Expected: PASS

- [ ] **Step 6: Build the settings page**

`app/(dashboard)/settings/page.tsx` (owner only): toggle for `show_cost_to_assistant`, default low-stock threshold, notification email(s), daily email send time.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0009_app_settings_rls.sql app/\(dashboard\)/settings lib/settings.ts lib/permissions.ts lib/items.ts lib/movements.ts tests/lib/cost-visibility.test.ts
git commit -m "feat: cost visibility toggle and settings"
```

---

## Task 12: Item Detail View & Low-Stock Indicator

**Files:**
- Create: `lib/stock.ts`
- Modify: `app/(dashboard)/items/[id]/page.tsx`, `app/(dashboard)/items/page.tsx`
- Test: `tests/lib/stock.test.ts`

**Interfaces:**
- Consumes: `batches`/`stock_movements` (Tasks 8–10), `getItemBatchesForViewer`/`canSeeCost` (Task 11).
- Produces: `getItemStockSummary(supabase, itemId): Promise<{ qtyOnHand: number; isLowStock: boolean; batches: Batch[]; movements: Movement[] }>` in `lib/stock.ts`, used here and by Task 13's stock list.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/stock.test.ts
test("qtyOnHand is the sum of qty_remaining across all non-voided batches", async () => {
  await recordStockIn(supabase, ASSISTANT_ID, { itemId, qty: 10, unitCost: 1000, batchDate: "2026-06-01" });
  await recordStockIn(supabase, ASSISTANT_ID, { itemId, qty: 5, unitCost: 1500, batchDate: "2026-07-01" });
  await recordStockOut(supabase, ASSISTANT_ID, { itemId, qty: 3, movementDate: "2026-07-15" });
  const summary = await getItemStockSummary(supabase, itemId);
  expect(summary.qtyOnHand).toBe(12);
});

test("isLowStock is true when qtyOnHand is at or below the item's threshold", async () => {
  await recordStockIn(supabase, itemId2, ASSISTANT_ID, { qty: 5, unitCost: 1000, batchDate: "2026-07-01" } as never);
  await recordStockOut(supabase, ASSISTANT_ID, { itemId: itemId2, qty: 4, movementDate: "2026-07-02" }); // leaves 1, threshold 5
  const summary = await getItemStockSummary(supabase, itemId2);
  expect(summary.isLowStock).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/lib/stock.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `getItemStockSummary` in `lib/stock.ts`**

Sums `qty_remaining` across the item's batches, compares against `item.low_stock_threshold ?? settings.default_low_stock_threshold`, and returns the batch/movement lists via `getItemBatchesForViewer` (Task 11) so cost stays correctly gated.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/stock.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the item detail and items-list pages to use it**

Item detail page shows qty on hand, a low-stock badge, the batch list, and movement history with void buttons (from Task 10). Items list page shows qty on hand and a low-stock indicator per row.

- [ ] **Step 6: Commit**

```bash
git add lib/stock.ts app/\(dashboard\)/items tests/lib/stock.test.ts
git commit -m "feat: item stock summary and low-stock indicator"
```

---

## Task 13: Stock List View, PDF Export & Excel Export

**Files:**
- Create: `lib/stock-list.ts`, `app/(dashboard)/stock-list/page.tsx`, `app/api/stock-list/pdf/route.ts`, `app/api/stock-list/excel/route.ts`
- Test: `tests/lib/stock-list.test.ts`

**Interfaces:**
- Consumes: `getItemStockSummary` (Task 12), `canSeeCost` (Task 11).
- Produces: `buildStockListRows(supabase, viewerRole): Promise<StockListRow[]>` in `lib/stock-list.ts` (shared by the page and both export routes), where `StockListRow` omits `unitCost`/`inventoryValue` entirely when the viewer can't see cost.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/stock-list.test.ts
test("buildStockListRows omits cost fields for an assistant when cost is hidden", async () => {
  await updateSettings(adminClient, OWNER_ID, { showCostToAssistant: false });
  const rows = await buildStockListRows(assistantClient, "assistant");
  expect(rows.every((r) => r.unitCost === undefined && r.inventoryValue === undefined)).toBe(true);
});

test("buildStockListRows includes cost fields for the owner", async () => {
  const rows = await buildStockListRows(ownerClient, "owner");
  expect(rows.some((r) => typeof r.unitCost === "number")).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/lib/stock-list.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `buildStockListRows` in `lib/stock-list.ts`**

One row per active item: sku, name, category, qty on hand, unit, and (gated by `canSeeCost`) unit cost of the oldest remaining batch and total inventory value.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/stock-list.test.ts`
Expected: PASS

- [ ] **Step 5: Build the stock list page with a print stylesheet**

`app/(dashboard)/stock-list/page.tsx`: table from `buildStockListRows`, a "Print" button triggering `window.print()`, and a print-specific stylesheet showing the Auto Batt logo in the header and hiding the sidebar/nav.

- [ ] **Step 6: Build the PDF export route**

`app/api/stock-list/pdf/route.ts`: calls `buildStockListRows`, renders via `@react-pdf/renderer`, returns `application/pdf`.

- [ ] **Step 7: Build the Excel export route**

`app/api/stock-list/excel/route.ts`: calls `buildStockListRows`, builds a workbook via `exceljs` with a header row matching the visible columns, returns `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

- [ ] **Step 8: Commit**

```bash
git add lib/stock-list.ts app/\(dashboard\)/stock-list app/api/stock-list tests/lib/stock-list.test.ts
git commit -m "feat: stock list view with PDF and Excel export"
```

---

## Task 14: Activity (Audit Log) Screen

**Files:**
- Create: `app/(dashboard)/activity/page.tsx`, `lib/activity.ts`
- Test: `tests/lib/activity.test.ts`

**Interfaces:**
- Consumes: `audit_log` rows written by Tasks 5–11.
- Produces: `listAuditLog(supabase, filters?: { itemId?: string; actorId?: string; action?: string }): Promise<AuditEntry[]>` in `lib/activity.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/activity.test.ts
test("listAuditLog filters by entity_id", async () => {
  const entries = await listAuditLog(ownerClient, { itemId });
  expect(entries.every((e) => e.entityId === itemId)).toBe(true);
});

test("listAuditLog returns empty for an assistant caller (RLS-enforced)", async () => {
  const entries = await listAuditLog(assistantClient, {});
  expect(entries).toEqual([]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/lib/activity.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `listAuditLog` in `lib/activity.ts`**

Queries `audit_log`, newest first, applying any given filters; relies on the Task 5 RLS policy to naturally return nothing for a non-owner.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/activity.test.ts`
Expected: PASS

- [ ] **Step 5: Build the Activity page**

`app/(dashboard)/activity/page.tsx` (owner only, per `isOwnerOnlyRoute` from Task 4): list with filter controls for item, user, and action type.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/activity lib/activity.ts tests/lib/activity.test.ts
git commit -m "feat: owner-only activity/audit log screen"
```

---

## Task 15: Add User (Owner Only)

**Files:**
- Create: `app/api/users/route.ts`, `app/(dashboard)/users/page.tsx`, `lib/users.ts`
- Test: `tests/api/users.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` (Task 2), `recordAudit` (Task 5), the `handle_new_user` trigger (Task 3).
- Produces: `POST /api/users` accepting `{ email, password, fullName, role }`, returning the created user's id.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/users.test.ts
test("owner can create a new assistant user", async () => {
  const res = await fetch("http://localhost:3000/api/users", {
    method: "POST",
    headers: { ...ownerAuthHeaders, "content-type": "application/json" },
    body: JSON.stringify({ email: "new-assistant@example.com", password: "temp-pass-123", fullName: "New Assistant", role: "assistant" }),
  });
  expect(res.status).toBe(201);
  const { data: profile } = await adminClient.from("profiles").select("role").eq("full_name", "New Assistant").single();
  expect(profile?.role).toBe("assistant");
});

test("an assistant cannot create a user", async () => {
  const res = await fetch("http://localhost:3000/api/users", {
    method: "POST",
    headers: { ...assistantAuthHeaders, "content-type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", password: "temp-pass-123", fullName: "X", role: "assistant" }),
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/api/users.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `POST /api/users` in `app/api/users/route.ts`**

Reads the caller's session via `createServerClient`; if the caller's role isn't `owner`, return 403. Otherwise use `createAdminClient().auth.admin.createUser()` with `raw_user_meta_data.role` set to the requested role (consumed by the Task 3 trigger), then call `recordAudit` with `action: "user.created"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/api/users.test.ts`
Expected: PASS

- [ ] **Step 5: Build the Add User page**

`app/(dashboard)/users/page.tsx` (owner only): form for email, temporary password, full name, role; posts to `/api/users`.

- [ ] **Step 6: Commit**

```bash
git add app/api/users app/\(dashboard\)/users lib/users.ts tests/api/users.test.ts
git commit -m "feat: owner-only add-user screen"
```

---

## Task 16: Daily Email Summary

**Files:**
- Create: `lib/email/dailySummary.ts`, `lib/email/DailySummaryEmail.tsx`, `app/api/cron/daily-email/route.ts`
- Modify: `vercel.json` (cron schedule)
- Test: `tests/lib/dailySummary.test.ts`

**Interfaces:**
- Consumes: `stock_movements` (Tasks 8–10), `getItemStockSummary`/low-stock logic (Task 12), `getSettings` (Task 11).
- Produces: `buildDailySummary(supabase, date: string): Promise<{ hasActivity: boolean; itemsWithActivity: {...}[]; lowStockItems: {...}[] }>` in `lib/email/dailySummary.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/dailySummary.test.ts
test("buildDailySummary groups IN/OUT quantities per item for the given date", async () => {
  await recordStockIn(supabase, ASSISTANT_ID, { itemId, qty: 10, unitCost: 1000, batchDate: "2026-11-12" });
  await recordStockOut(supabase, ASSISTANT_ID, { itemId, qty: 2, movementDate: "2026-11-12" });
  const summary = await buildDailySummary(supabase, "2026-11-12");
  expect(summary.itemsWithActivity).toContainEqual(expect.objectContaining({ itemId, qtyIn: 10, qtyOut: 2 }));
});

test("buildDailySummary reports hasActivity:false and no low-stock items on an empty day for a fresh system", async () => {
  const summary = await buildDailySummary(freshSupabaseWithNoItems, "2026-01-01");
  expect(summary.hasActivity).toBe(false);
  expect(summary.lowStockItems).toEqual([]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/lib/dailySummary.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `buildDailySummary` in `lib/email/dailySummary.ts`**

Queries non-voided `stock_movements` where `movement_date = date`, grouped by item, summing `IN`/`OUT` quantities; queries all active items and filters to those at/below their low-stock threshold (reusing the threshold logic from Task 12). `hasActivity` is true when either list is non-empty.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/dailySummary.test.ts`
Expected: PASS

- [ ] **Step 5: Build the email template**

`DailySummaryEmail.tsx` using `@react-email/components`: item/qty-in/qty-out table, a low-stock warning section, no profit figures (per spec).

- [ ] **Step 6: Build the cron route**

`app/api/cron/daily-email/route.ts`: calls `buildDailySummary` for today (Asia/Manila), and if `hasActivity` is true, sends via Resend to `app_settings.notification_emails`; otherwise returns 200 without sending. Must not throw on an empty-system day (covered by Step 1's second test).

- [ ] **Step 7: Configure the cron schedule**

In `vercel.json`, add a `crons` entry hitting `/api/cron/daily-email` once daily at a UTC time corresponding to `app_settings.daily_email_send_time` in Asia/Manila (default 20:00 ICT = 12:00 UTC).

- [ ] **Step 8: Commit**

```bash
git add lib/email app/api/cron vercel.json tests/lib/dailySummary.test.ts
git commit -m "feat: daily email summary via Resend"
```

---

## Task 17: Opening Stock Import

**Files:**
- Create: `app/(dashboard)/import/page.tsx`, `lib/import.ts`
- Test: `tests/lib/import.test.ts`

**Interfaces:**
- Consumes: `createItem` (Task 7), `recordStockIn` (Task 8, with `source: 'opening_stock'`).
- Produces: `importOpeningStock(supabase, actorId, rows: { sku, name, category, qty, lastKnownUnitCost, lowStockThreshold? }[]): Promise<{ succeeded: number; errors: { row: number; message: string }[] }>` in `lib/import.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/import.test.ts
test("importOpeningStock creates one item and one opening_stock batch per row", async () => {
  const result = await importOpeningStock(supabase, OWNER_ID, [
    { sku: "AB-100", name: "Test Battery", category: "Batteries", qty: 18, lastKnownUnitCost: 1200 },
  ]);
  expect(result.succeeded).toBe(1);
  const { data: item } = await supabase.from("items").select("id").eq("sku", "AB-100").single();
  const { data: batch } = await supabase.from("batches").select("*").eq("item_id", item!.id).single();
  expect(batch?.source).toBe("opening_stock");
  expect(batch?.qty_remaining).toBe(18);
});

test("importOpeningStock reports a clear per-row error for a SKU that already exists", async () => {
  await importOpeningStock(supabase, OWNER_ID, [{ sku: "AB-101", name: "Existing", category: "Batteries", qty: 5, lastKnownUnitCost: 1000 }]);
  const result = await importOpeningStock(supabase, OWNER_ID, [{ sku: "AB-101", name: "Existing", category: "Batteries", qty: 5, lastKnownUnitCost: 1000 }]);
  expect(result.succeeded).toBe(0);
  expect(result.errors[0].message).toMatch(/already exists/i);
  const { data: items } = await supabase.from("items").select("id").eq("sku", "AB-101");
  expect(items).toHaveLength(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/lib/import.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `importOpeningStock` in `lib/import.ts`**

For each row: look up or create the category by name; check for an existing item with that `sku` first and, if found, push a per-row error (`"SKU already exists"`) and skip it rather than calling `createItem` (whose own unique-constraint error would otherwise be the only signal); otherwise call `createItem` then `recordStockIn` with `source: 'opening_stock'` and `batchDate` = today. Collect `{ succeeded, errors }` across all rows rather than aborting on the first failure.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/import.test.ts`
Expected: PASS

- [ ] **Step 5: Build the import page**

`app/(dashboard)/import/page.tsx` (owner only): CSV upload or manual entry grid (sku, name, category, qty, last known unit cost, optional low-stock threshold), submits to `importOpeningStock`, and displays the per-row error list for anything that failed.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/import lib/import.ts tests/lib/import.test.ts
git commit -m "feat: opening stock import"
```

---

## Self-Review Notes

- **Spec coverage:** every "What Was Decided" bullet in the design doc maps to a task — FIFO batch tracking (8–9), role-gated cost visibility (11), categories (6), SKU uniqueness (7), low-stock warning (12, 16), daily email (16), historical data as opening-stock-only (17), printable/exportable stock list (13), void + re-enter corrections (10), decimal quantities (2's schema), in-app Add User (15), branding (4), audit log (5, 14).
- **Type/name consistency check:** `recordStockIn`/`recordStockOut`/`voidMovement` (Task 8–10) are the only mutators of `batches`/`stock_movements`, and every later consumer (12, 13, 16, 17) reads through `getItemStockSummary`/`buildStockListRows`/`buildDailySummary` rather than querying raw tables directly, so a change to the movement/allocation shape only has one producer to update.
- **Review Focus coverage:** concurrent OUT → Task 9 Step 1 third test; partially-sold void → Task 10 Step 1 second test; assistant bypassing UI for cost → Task 11 Step 1 fourth test; empty-system cron day → Task 16 Step 1 second test; duplicate-SKU import → Task 17 Step 1 second test.
- **`reverses_movement_id`** (named in the design doc's data model) is included in the Task 2 schema but intentionally not required by Task 10's void logic — voiding flags the original movement in place (`voided_at`/`voided_by`), which is sufficient for correctness and audit. The column is left available for an optional future enhancement (letting a user explicitly link a corrected re-entry back to the voided movement it replaces); wiring that into the UI is not required for this MVP.
