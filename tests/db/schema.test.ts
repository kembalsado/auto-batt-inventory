import { createAdminClient } from "@/lib/supabase/admin";

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
