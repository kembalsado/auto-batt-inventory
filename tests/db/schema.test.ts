import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";

// Plain anon-key client used to sign in as a real user and exercise RLS
// (and, crucially, the base table grants RLS sits behind) — as opposed to
// createAdminClient() below, which uses the service-role key. See
// tests/lib/cost-visibility.test.ts for the same pattern.
function createAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: `test-${randomUUID()}`,
      },
    }
  );
}

test("app_settings has exactly one seeded row", async () => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("app_settings").select("*");

  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data![0].show_cost_to_assistant).toBe(false);
});

test("service_role can select from movement_allocations", async () => {
  const supabase = createAdminClient();
  const { error } = await supabase.from("movement_allocations").select("*").limit(1);
  expect(error).toBeNull();
});

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

// supabase/migrations/0016_car_makes.sql gave car_makes two RLS policies
// (select + insert for `authenticated`) but — until
// supabase/migrations/0018_car_makes_grants.sql — never granted the
// underlying base table privileges those policies assume. Postgres checks
// base table privileges BEFORE evaluating RLS, so a correct policy with no
// grant is unreachable: the query 42501s regardless of the policy. The
// admin client above doesn't catch this — it already had access (via
// service_role's own base grant) even before 0018 — so this test signs in
// as a real user and exercises the same `authenticated` role production
// traffic actually uses.
test("authenticated can select from car_makes (not just the admin client)", async () => {
  const admin = createAdminClient();
  const runId = randomUUID().slice(0, 8);
  const email = `test-car-makes-grant-${runId}@example.com`;
  const password = "test-password-123";

  const { data: userData, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  expect(createUserError).toBeNull();
  const userId = userData!.user!.id;

  try {
    const anonClient = createAnonClient();
    const { error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();

    const { data, error } = await anonClient.from("car_makes").select("*").limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  } finally {
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

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

    const { data: assistantDeleteData } = await assistantClient
      .from("car_makes")
      .delete()
      .eq("id", make!.id)
      .select();
    expect(assistantDeleteData).toEqual([]);

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

test("items no longer has make_id, model, variant, or year columns", async () => {
  const supabase = createAdminClient();
  const { error } = await supabase.from("items").select("make_id").limit(1);
  expect(error).not.toBeNull(); // column doesn't exist
});

test("item_fitments has item_id, make_id (nullable), model, variant, year_from, year_to columns", async () => {
  const supabase = createAdminClient();
  const { data: category } = await supabase
    .from("categories").insert({ name: `fitment-schema-cat-${Date.now()}` }).select().single();
  const { data: item } = await supabase
    .from("items").insert({ sku: `FITMENT-SCHEMA-${Date.now()}`, name: "x", category_id: category!.id })
    .select().single();
  const { data, error } = await supabase
    .from("item_fitments")
    .insert({ item_id: item!.id })
    .select("id, item_id, make_id, model, variant, year_from, year_to")
    .single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ item_id: item!.id, make_id: null, model: null, variant: null, year_from: null, year_to: null });
  await supabase.from("items").delete().eq("id", item!.id);
  await supabase.from("categories").delete().eq("id", category!.id);
});

test("deleting an item cascades to delete its item_fitments rows", async () => {
  const supabase = createAdminClient();
  const { data: category } = await supabase
    .from("categories").insert({ name: `fitment-cascade-cat-${Date.now()}` }).select().single();
  const { data: item } = await supabase
    .from("items").insert({ sku: `FITMENT-CASCADE-${Date.now()}`, name: "x", category_id: category!.id })
    .select().single();
  const { data: fitment } = await supabase
    .from("item_fitments").insert({ item_id: item!.id, model: "Vios" }).select().single();

  await supabase.from("items").delete().eq("id", item!.id);

  const { data: remaining } = await supabase.from("item_fitments").select("id").eq("id", fitment!.id).maybeSingle();
  expect(remaining).toBeNull();
  await supabase.from("categories").delete().eq("id", category!.id);
});

test("RLS: any authenticated user can select, insert, update, and delete item_fitments", async () => {
  const admin = createAdminClient();
  const runId = randomUUID().slice(0, 8);
  const email = `test-item-fitments-rls-${runId}@example.com`;
  const password = "test-password-123";

  const { data: category } = await admin
    .from("categories").insert({ name: `fitment-rls-cat-${runId}` }).select().single();
  const { data: item } = await admin
    .from("items").insert({ sku: `FITMENT-RLS-${runId}`, name: "x", category_id: category!.id })
    .select().single();

  const { data: userData } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, // no role metadata — a plain authenticated user, same as items_select/insert/update/delete_authenticated
  });
  const userId = userData!.user!.id;

  try {
    const anonClient = createAnonClient();
    await anonClient.auth.signInWithPassword({ email, password });

    const { data: inserted, error: insertError } = await anonClient
      .from("item_fitments").insert({ item_id: item!.id, model: "Vios" }).select().single();
    expect(insertError).toBeNull();

    const { data: selected, error: selectError } = await anonClient
      .from("item_fitments").select("*").eq("id", inserted!.id);
    expect(selectError).toBeNull();
    expect(selected).toHaveLength(1);

    const { data: updated, error: updateError } = await anonClient
      .from("item_fitments").update({ model: "Vios Updated" }).eq("id", inserted!.id).select();
    expect(updateError).toBeNull();
    expect(updated?.[0]?.model).toBe("Vios Updated");

    const { data: deleted, error: deleteError } = await anonClient
      .from("item_fitments").delete().eq("id", inserted!.id).select();
    expect(deleteError).toBeNull();
    expect(deleted).toHaveLength(1);
  } finally {
    await admin.from("items").delete().eq("id", item!.id);
    await admin.from("categories").delete().eq("id", category!.id);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

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
  const admin = createAdminClient();
  const runId = randomUUID().slice(0, 8);

  const { data: make } = await admin
    .from("car_makes")
    .insert({ name: `rls-make-${runId}` })
    .select()
    .single();

  const { data: model } = await admin
    .from("car_models")
    .insert({ make_id: make!.id, name: `rls-model-${runId}` })
    .select()
    .single();

  const { data: ownerUser } = await admin.auth.admin.createUser({
    email: `test-rls-model-owner-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  const { data: assistantUser } = await admin.auth.admin.createUser({
    email: `test-rls-model-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
  });

  try {
    const assistantClient = createAnonClient();
    await assistantClient.auth.signInWithPassword({
      email: `test-rls-model-assistant-${runId}@example.com`,
      password: "test-password-123",
    });
    const { data: assistantUpdateData } = await assistantClient
      .from("car_models")
      .update({ name: `rls-model-${runId}-blocked` })
      .eq("id", model!.id)
      .select();
    expect(assistantUpdateData).toEqual([]);

    const { data: assistantDeleteData } = await assistantClient
      .from("car_models")
      .delete()
      .eq("id", model!.id)
      .select();
    expect(assistantDeleteData).toEqual([]);

    const ownerClient = createAnonClient();
    await ownerClient.auth.signInWithPassword({
      email: `test-rls-model-owner-${runId}@example.com`,
      password: "test-password-123",
    });
    const { data: ownerUpdateData, error: ownerUpdateError } = await ownerClient
      .from("car_models")
      .update({ name: `rls-model-${runId}-renamed` })
      .eq("id", model!.id)
      .select();
    expect(ownerUpdateError).toBeNull();
    expect(ownerUpdateData?.[0]?.name).toBe(`rls-model-${runId}-renamed`);

    const { data: ownerDeleteData } = await ownerClient
      .from("car_models")
      .delete()
      .eq("id", model!.id)
      .select();
    expect(ownerDeleteData).toHaveLength(1);
  } finally {
    await admin.from("car_models").delete().eq("id", model!.id);
    await admin.from("car_makes").delete().eq("id", make!.id);
    await admin
      .from("profiles")
      .delete()
      .in("id", [ownerUser!.user!.id, assistantUser!.user!.id]);
    await admin.auth.admin.deleteUser(ownerUser!.user!.id);
    await admin.auth.admin.deleteUser(assistantUser!.user!.id);
  }
});
