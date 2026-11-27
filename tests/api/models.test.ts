import { createAdminClient } from "@/lib/supabase/admin";
import { createBrowserClient } from "@/lib/supabase/client";

// This file exercises the real `PATCH`/`DELETE /api/models/[id]` routes
// over HTTP (not by importing the handlers directly), because the thing
// under test — the route reading the caller's own session cookie and
// rejecting a non-owner — can only be proven end-to-end. It therefore
// needs a live `next dev` server on localhost:3000, the same documented,
// pre-existing dependency as tests/api/makes.test.ts.
const BASE_URL = "http://localhost:3000";

// Signs in via the real browser client so @supabase/ssr writes an actual
// session cookie to `document.cookie`, then hands back the Cookie header
// to replay with plain `fetch` — the same technique tests/api/makes.test.ts
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
const createdMakeIds: string[] = [];
const createdModelIds: string[] = [];

afterAll(async () => {
  const admin = createAdminClient();
  await admin.from("car_models").delete().in("id", createdModelIds);
  await admin.from("car_makes").delete().in("id", createdMakeIds);
  await admin.from("audit_log").delete().in("actor_id", createdUserIds);
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
  );
});

describe("PATCH /api/models/[id]", () => {
  test("owner can rename a model", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-model-route-owner-1@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: make } = await admin
      .from("car_makes")
      .insert({ name: "Route Test Make 1" })
      .select()
      .single();
    createdMakeIds.push(make!.id);
    const { data: model } = await admin
      .from("car_models")
      .insert({ make_id: make!.id, name: "Route Rename Before" })
      .select()
      .single();
    createdModelIds.push(model!.id);

    const cookie = await signInCookieHeader(
      "test-model-route-owner-1@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/models/${model!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Route Rename After" }),
    });

    expect(res.status).toBe(200);
    const { data: renamed } = await admin
      .from("car_models")
      .select("name")
      .eq("id", model!.id)
      .single();
    expect(renamed?.name).toBe("Route Rename After");
  });

  test("an assistant cannot rename a model", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-model-route-assistant-1@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);
    const { data: make } = await admin
      .from("car_makes")
      .insert({ name: "Route Test Make 2" })
      .select()
      .single();
    createdMakeIds.push(make!.id);
    const { data: model } = await admin
      .from("car_models")
      .insert({ make_id: make!.id, name: "Route Rename Blocked" })
      .select()
      .single();
    createdModelIds.push(model!.id);

    const cookie = await signInCookieHeader(
      "test-model-route-assistant-1@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/models/${model!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Should Not Rename" }),
    });

    expect(res.status).toBe(403);
    const { data: unchanged } = await admin
      .from("car_models")
      .select("name")
      .eq("id", model!.id)
      .single();
    expect(unchanged?.name).toBe("Route Rename Blocked");
  });

  test("owner renaming to a blank name gets a 400, not a crash", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-model-route-owner-2@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: make } = await admin
      .from("car_makes")
      .insert({ name: "Route Test Make 3" })
      .select()
      .single();
    createdMakeIds.push(make!.id);
    const { data: model } = await admin
      .from("car_models")
      .insert({ make_id: make!.id, name: "Route Blank Guard" })
      .select()
      .single();
    createdModelIds.push(model!.id);

    const cookie = await signInCookieHeader(
      "test-model-route-owner-2@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/models/${model!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    expect(res.status).toBe(400);
    const { data: unchanged } = await admin
      .from("car_models")
      .select("name")
      .eq("id", model!.id)
      .single();
    expect(unchanged?.name).toBe("Route Blank Guard");
  });

  test("owner renaming to a name that collides with another model in the SAME make gets a friendly 400", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-model-route-owner-3@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: make } = await admin
      .from("car_makes")
      .insert({ name: "Route Test Make 4" })
      .select()
      .single();
    createdMakeIds.push(make!.id);
    const { data: existing } = await admin
      .from("car_models")
      .insert({ make_id: make!.id, name: "Route Dup Target" })
      .select()
      .single();
    createdModelIds.push(existing!.id);
    const { data: toRename } = await admin
      .from("car_models")
      .insert({ make_id: make!.id, name: "Route Dup Source" })
      .select()
      .single();
    createdModelIds.push(toRename!.id);

    const cookie = await signInCookieHeader(
      "test-model-route-owner-3@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/models/${toRename!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Route Dup Target" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("That model already exists for this make.");
  });
});

describe("DELETE /api/models/[id]", () => {
  test("owner can delete an unused model", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-model-route-owner-4@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);
    const { data: make } = await admin
      .from("car_makes")
      .insert({ name: "Route Test Make 5" })
      .select()
      .single();
    createdMakeIds.push(make!.id);
    const { data: model } = await admin
      .from("car_models")
      .insert({ make_id: make!.id, name: "Route Delete Me" })
      .select()
      .single();
    createdModelIds.push(model!.id);

    const cookie = await signInCookieHeader(
      "test-model-route-owner-4@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/models/${model!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    const { data } = await admin
      .from("car_models")
      .select("id")
      .eq("id", model!.id)
      .maybeSingle();
    expect(data).toBeNull();
  });

  test("an assistant cannot delete a model", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-model-route-assistant-2@example.com",
      password: "test-password-123",
      email_confirm: true,
    });
    createdUserIds.push(assistant!.user!.id);
    const { data: make } = await admin
      .from("car_makes")
      .insert({ name: "Route Test Make 6" })
      .select()
      .single();
    createdMakeIds.push(make!.id);
    const { data: model } = await admin
      .from("car_models")
      .insert({ make_id: make!.id, name: "Route Delete Blocked" })
      .select()
      .single();
    createdModelIds.push(model!.id);

    const cookie = await signInCookieHeader(
      "test-model-route-assistant-2@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/models/${model!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(403);
    const { data } = await admin
      .from("car_models")
      .select("id")
      .eq("id", model!.id)
      .maybeSingle();
    expect(data).not.toBeNull();
  });
});
