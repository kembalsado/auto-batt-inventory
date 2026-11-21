import { createAdminClient } from "@/lib/supabase/admin";
import { createBrowserClient } from "@/lib/supabase/client";
import { createItem } from "@/lib/items";

// This file exercises the real `PATCH`/`DELETE /api/categories/[id]` routes
// over HTTP (not by importing the handlers directly), because the thing
// under test — the route reading the caller's own session cookie and
// rejecting a non-owner — can only be proven end-to-end. It therefore
// needs a live `next dev` server on localhost:3000, the same documented,
// pre-existing dependency as tests/api/users.test.ts.
const BASE_URL = "http://localhost:3000";

// Signs in via the real browser client so @supabase/ssr writes an actual
// session cookie to `document.cookie`, then hands back the Cookie header
// to replay with plain `fetch` — the same technique tests/api/users.test.ts
// uses.
async function signInCookieHeader(
  email: string,
  password: string
): Promise<string> {
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
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
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
  );
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
    const { data: category } = await admin
      .from("categories")
      .insert({ name: "Route Rename Before" })
      .select()
      .single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader(
      "test-cat-route-owner-1@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Route Rename After" }),
    });

    expect(res.status).toBe(200);
    const { data: renamed } = await admin
      .from("categories")
      .select("name")
      .eq("id", category!.id)
      .single();
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
    const { data: category } = await admin
      .from("categories")
      .insert({ name: "Route Rename Blocked" })
      .select()
      .single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader(
      "test-cat-route-assistant-1@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Should Not Rename" }),
    });

    expect(res.status).toBe(403);
    const { data: unchanged } = await admin
      .from("categories")
      .select("name")
      .eq("id", category!.id)
      .single();
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
    const { data: category } = await admin
      .from("categories")
      .insert({ name: "Route Blank Guard" })
      .select()
      .single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader(
      "test-cat-route-owner-2@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    expect(res.status).toBe(400);
    const { data: unchanged } = await admin
      .from("categories")
      .select("name")
      .eq("id", category!.id)
      .single();
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
    const { data: existing } = await admin
      .from("categories")
      .insert({ name: "Route Dup Target" })
      .select()
      .single();
    const { data: toRename } = await admin
      .from("categories")
      .insert({ name: "Route Dup Source" })
      .select()
      .single();
    createdCategoryIds.push(existing!.id, toRename!.id);

    const cookie = await signInCookieHeader(
      "test-cat-route-owner-3@example.com",
      "test-password-123"
    );

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
    const { data: category } = await admin
      .from("categories")
      .insert({ name: "Route Delete Me" })
      .select()
      .single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader(
      "test-cat-route-owner-4@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    const { data } = await admin
      .from("categories")
      .select("id")
      .eq("id", category!.id)
      .maybeSingle();
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
    const { data: category } = await admin
      .from("categories")
      .insert({ name: "Route In Use" })
      .select()
      .single();
    createdCategoryIds.push(category!.id);
    const item = await createItem(admin, owner!.user!.id, {
      sku: `AB-ROUTE-INUSE-${category!.id.slice(0, 8)}`,
      name: "Blocks route delete",
      categoryId: category!.id,
      unit: "pcs",
    });
    createdItemIds.push(item.id);

    const cookie = await signInCookieHeader(
      "test-cat-route-owner-5@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/in use/i);
    const { data } = await admin
      .from("categories")
      .select("id")
      .eq("id", category!.id)
      .maybeSingle();
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
    const { data: category } = await admin
      .from("categories")
      .insert({ name: "Route Delete Blocked" })
      .select()
      .single();
    createdCategoryIds.push(category!.id);

    const cookie = await signInCookieHeader(
      "test-cat-route-assistant-2@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/categories/${category!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(403);
    const { data } = await admin
      .from("categories")
      .select("id")
      .eq("id", category!.id)
      .maybeSingle();
    expect(data).not.toBeNull();
  });
});
