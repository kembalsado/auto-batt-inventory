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
  // batches/stock_movements.item_id reference items with no cascade — a
  // single `items.delete().in(...)` is one SQL statement, so if ANY
  // tracked id still has batch/movement rows (the blocked-delete test's
  // item), Postgres rolls back that whole statement and deletes NOTHING,
  // including every other otherwise-deletable id in the same `in()`
  // list. Clear history first so this cleanup can't be all-or-nothing.
  await admin.from("stock_movements").delete().in("item_id", createdItemIds);
  await admin.from("batches").delete().in("item_id", createdItemIds);
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

  test("an unauthenticated request is rejected", async () => {
    // middleware.ts redirects any unauthenticated request outside
    // PUBLIC_PATHS to /login before it ever reaches the route handler —
    // same documented behavior/rationale as tests/api/users.test.ts's
    // "an unauthenticated request is rejected". With `redirect: "manual"`
    // (not followed), a passing fetch here never reaches this route's own
    // 401 branch, which is why it's not exercised directly by an HTTP
    // test: it only matters if middleware's path coverage ever changes.
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

    const res = await fetch(`${BASE_URL}/api/items/${item.id}`, {
      method: "DELETE",
      redirect: "manual",
    });

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  test("deleting an item that no longer exists gets a friendly 400, not a raw PostgREST message", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-items-route-4@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);

    const cookie = await signInCookieHeader("test-items-route-4@example.com", "test-password-123");

    const res = await fetch(`${BASE_URL}/api/items/00000000-0000-0000-0000-000000000000`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "This item no longer exists, or you don't have permission to delete it."
    );
  });
});
