# Delete Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Delete item" action to the Edit Item page that permanently removes the item, blocked with a friendly error when the item already has stock history.

**Architecture:** A `deleteItem` data function in `lib/items.ts` (delete + audit log, mirroring `lib/categories.ts`'s `deleteCategory`), exposed via a new `DELETE /api/items/[id]` route (mirroring `app/api/categories/[id]/route.ts`'s `DELETE` handler), triggered from a small client component on the edit page (mirroring `components/lookup-list-table.tsx`'s existing delete-button logic).

**Tech Stack:** Next.js App Router, Supabase (Postgres + supabase-js), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-delete-item-design.md`

## Global Constraints

- Delete requires only a signed-in user — no owner-only role check (matches item edit/update's existing permission model).
- A delete blocked by stock history must respond 400 with exactly: `"Can't delete — this item has stock history. Only items with no batches or movements can be deleted."`
- No pre-check queries for existing batches/movements — rely on the database's foreign-key constraint (SQLSTATE `23503`, `lib/errors.ts`'s `isForeignKeyViolation`), consistent with how categories/makes already do this.
- Audit log action name: `item.deleted`; summary: `` `Deleted item ${sku}` ``.

## Review Focus

- **Deleting an item with existing batches/movements must not 500 or silently "succeed."** `deleteItem` must throw the underlying FK-violation error, and the route must turn it into the documented 400 — not describeError's generic message. (Covered by Task 1 + Task 2 tests.)
- **Deleting an item with no history must actually remove the row and leave no orphaned audit/UI state.** (Covered by Task 1's happy-path test and Task 2's route test.)
- **An unauthenticated request must get 401, not a crash or a silent no-op.** (Covered by Task 2.)
- **The confirm dialog must name the specific item (SKU + name), not a generic "are you sure?"** — this project already had a real incident class around silently losing/misapplying per-item data on forms (see `app/(dashboard)/items/[id]/edit/page.tsx`'s `buildErrorRedirectParams` docstring), so the confirm text is pinned exactly in Task 3.
- **A failed delete (blocked by history) must leave the user on the edit page with the error visible inline**, not navigate them away or lose the error silently. (Covered by Task 3.)

---

## Task 1: `deleteItem` in `lib/items.ts`

**Files:**
- Modify: `lib/items.ts`
- Test: `tests/lib/items.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (`lib/audit.ts`, already imported in `lib/items.ts`); `createItem` (existing, for test fixtures); `recordStockIn` (`lib/movements.ts`, `RecordStockInInput: { itemId: string; qty: number; unitCost: number; batchDate: string; note?: string | null }`, for the blocked-delete test fixture).
- Produces: `deleteItem(supabase: SupabaseClient, actorId: string, itemId: string): Promise<void>` — later tasks (the API route) call this directly.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/items.test.ts` (adjust the top-of-file imports to add `deleteItem` to the existing `from "@/lib/items"` import, and `recordStockIn` from `@/lib/movements`):

```ts
test("deleteItem removes an item with no history and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `AB-DEL-OK-${runId}`,
    name: "Delete Me",
    categoryId,
    unit: "pcs",
  });

  await deleteItem(supabase, ASSISTANT_ID, item.id);

  const { data } = await supabase.from("items").select("id").eq("id", item.id).maybeSingle();
  expect(data).toBeNull();

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", item.id)
    .eq("action", "item.deleted")
    .single();
  expect(log?.summary).toContain(`AB-DEL-OK-${runId}`);
});

test("deleteItem rejects deleting an item that already has stock history", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `AB-DEL-BLOCKED-${runId}`,
    name: "Blocks delete",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: item.id,
    qty: 5,
    unitCost: 10,
    batchDate: "2026-01-01",
  });

  await expect(deleteItem(supabase, ASSISTANT_ID, item.id)).rejects.toThrow();

  const { data } = await supabase.from("items").select("id").eq("id", item.id).maybeSingle();
  expect(data).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/items.test.ts -t "deleteItem"`
Expected: FAIL — `deleteItem is not a function` / not exported.

- [ ] **Step 3: Implement `deleteItem(supabase: SupabaseClient, actorId: string, itemId: string): Promise<void>` in `lib/items.ts`**

Add the `deleteItem` named export (place it after `updateItem`, before `listItems`). Mirror `lib/categories.ts`'s `deleteCategory` exactly: `.from("items").delete().eq("id", itemId).select().single()`, throw on `error`, else `recordAudit(supabase, { actorId, action: "item.deleted", entityType: "item", entityId: itemId, summary: \`Deleted item ${data.sku}\` })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/items.test.ts -t "deleteItem"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/items.ts tests/lib/items.test.ts
git commit -m "feat: add deleteItem to lib/items.ts"
```

---

## Task 2: `DELETE /api/items/[id]` route

**Files:**
- Create: `app/api/items/[id]/route.ts`
- Test: `tests/api/items.test.ts` (new file)

**Interfaces:**
- Consumes: `deleteItem` (Task 1); `createServerClient` (`@/lib/supabase/server`); `isForeignKeyViolation`, `describeError` (`@/lib/errors`); `createItem` (`@/lib/items`, test fixtures); `recordStockIn` (`@/lib/movements`, test fixture); `createAdminClient` (`@/lib/supabase/admin`); `createBrowserClient` (`@/lib/supabase/client`).
- Produces: a live `DELETE /api/items/[id]` HTTP endpoint — Task 3's client component calls it by URL, not by import.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/items.test.ts`, following `tests/api/categories.test.ts`'s exact structure (same `BASE_URL`, same `signInCookieHeader` helper, same cleanup-array-in-`afterAll` pattern — `createdUserIds`, `createdItemIds`, `createdCategoryIds`):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { createBrowserClient } from "@/lib/supabase/client";
import { createItem } from "@/lib/items";
import { recordStockIn } from "@/lib/movements";

const BASE_URL = "http://localhost:3000";

async function signInCookieHeader(email: string, password: string): Promise<string> {
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return document.cookie;
}

const createdUserIds: string[] = [];
const createdItemIds: string[] = [];
const createdCategoryIds: string[] = [];

afterAll(async () => {
  const admin = createAdminClient();
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().in("actor_id", createdUserIds);
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
});

describe("DELETE /api/items/[id]", () => {
  test("a signed-in user can delete an item with no history", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-items-route-1@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);
    const item = await createItem(admin, assistant!.user!.id, {
      sku: "AB-ROUTE-DEL-OK",
      name: "Route Delete Me",
      categoryId: null,
      unit: "pcs",
    });

    const cookie = await signInCookieHeader("test-items-route-1@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/items/${item.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    const { data } = await admin.from("items").select("id").eq("id", item.id).maybeSingle();
    expect(data).toBeNull();
  });

  test("deleting an item with stock history gets a friendly 400, and the item survives", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-items-route-2@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);
    const item = await createItem(admin, assistant!.user!.id, {
      sku: "AB-ROUTE-DEL-BLOCKED",
      name: "Route Blocks Delete",
      categoryId: null,
      unit: "pcs",
    });
    createdItemIds.push(item.id);
    await recordStockIn(admin, assistant!.user!.id, {
      itemId: item.id,
      qty: 3,
      unitCost: 5,
      batchDate: "2026-01-01",
    });

    const cookie = await signInCookieHeader("test-items-route-2@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/items/${item.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "Can't delete — this item has stock history. Only items with no batches or movements can be deleted."
    );
    const { data } = await admin.from("items").select("id").eq("id", item.id).maybeSingle();
    expect(data).not.toBeNull();
  });

  test("an unauthenticated request gets 401", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-items-route-3@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);
    const item = await createItem(admin, assistant!.user!.id, {
      sku: "AB-ROUTE-DEL-NOAUTH",
      name: "No auth",
      categoryId: null,
      unit: "pcs",
    });
    createdItemIds.push(item.id);

    const res = await fetch(`${BASE_URL}/api/items/${item.id}`, { method: "DELETE" });

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Ensure a dev server is running first (`npm run dev`, separate terminal — this test file hits real HTTP, same documented pre-existing dependency as `tests/api/categories.test.ts`).

Run: `npx vitest run tests/api/items.test.ts`
Expected: FAIL with a connection/404 error — the route doesn't exist yet.

- [ ] **Step 3: Implement the route in `app/api/items/[id]/route.ts`**

Mirror `app/api/categories/[id]/route.ts`'s `DELETE` handler shape exactly, but with no role check:

```ts
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { deleteItem } from "@/lib/items";
import { isForeignKeyViolation, describeError } from "@/lib/errors";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteItem(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return NextResponse.json(
        {
          error:
            "Can't delete — this item has stock history. Only items with no batches or movements can be deleted.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/items.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/items/[id]/route.ts tests/api/items.test.ts
git commit -m "feat: add DELETE /api/items/[id] route"
```

---

## Task 3: Delete button on the Edit Item page

**Files:**
- Create: `app/(dashboard)/items/[id]/edit/delete-item-button.tsx`
- Modify: `app/(dashboard)/items/[id]/edit/page.tsx`
- Test: `tests/components/delete-item-button.test.tsx` (new file)

**Interfaces:**
- Consumes: `DELETE /api/items/[id]` (Task 2, by URL); `Button` (`@/components/ui/button`); `useRouter` from `next/navigation`.
- Produces: `DeleteItemButton({ itemId, sku, name }: { itemId: string; sku: string; name: string })` — a client component, default-exported-free (named export), rendered by `page.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/delete-item-button.test.tsx`, following `tests/components/lookup-list-table.test.tsx`'s existing render/mock conventions exactly (`vi.mock("next/navigation", ...)`, `vi.spyOn(window, "confirm")`, `vi.stubGlobal("fetch", ...)`, `fireEvent` — not `userEvent`, which isn't a project dependency):

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeleteItemButton } from "@/app/(dashboard)/items/[id]/edit/delete-item-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

test("confirms with the item's SKU and name, then deletes and navigates to /items", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(window.confirm).toHaveBeenCalledWith(
    "Delete AB-001 — 12V Battery? This can't be undone."
  );
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/items/item-1", expect.objectContaining({ method: "DELETE" }))
  );
  await waitFor(() => expect(push).toHaveBeenCalledWith("/items"));
});

test("declining the confirm dialog makes no request and does not navigate", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(fetchMock).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test("shows the server's error inline and does not navigate away on failure", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Can't delete — this item has stock history." }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(await screen.findByText(/stock history/i)).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/delete-item-button.test.tsx`
Expected: FAIL — module `.../delete-item-button` does not exist.

- [ ] **Step 3: Implement `DeleteItemButton` in `app/(dashboard)/items/[id]/edit/delete-item-button.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DeleteItemButton({
  itemId,
  sku,
  name,
}: {
  itemId: string;
  sku: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmed = window.confirm(`Delete ${sku} — ${name}? This can't be undone.`);
    if (!confirmed) return;

    setPending(true);
    setError(null);

    const res = await fetch(`/api/items/${itemId}`, { method: "DELETE" });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to delete item.");
      setPending(false);
      return;
    }

    router.push("/items");
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={handleDelete}
      >
        {pending ? "Deleting…" : "Delete item"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/delete-item-button.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire it into the edit page**

In `app/(dashboard)/items/[id]/edit/page.tsx`: import `DeleteItemButton` from `./delete-item-button`, render it immediately after the closing `</form>` tag (sibling, not inside the form — it isn't a form field), passing `itemId={item.id} sku={item.sku} name={item.name}`.

- [ ] **Step 6: Manual check**

Run: `npm run dev`, open `/items/<some-item-id>/edit` for an item with no stock history, click "Delete item", confirm the dialog, verify redirect to `/items` and the item is gone from the list. Then repeat for an item that has stock history and verify the inline error appears and the page stays put.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/items/[id]/edit/delete-item-button.tsx" "app/(dashboard)/items/[id]/edit/page.tsx" tests/components/delete-item-button.test.tsx
git commit -m "feat: add Delete item button to the Edit Item page"
```
