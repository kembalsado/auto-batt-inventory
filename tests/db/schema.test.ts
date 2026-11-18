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
