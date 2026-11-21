import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory, listCategories, updateCategory, deleteCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordAudit writes a row on every createCategory call).
let OWNER_ID: string;

// Every category and audit_log row created by this file's tests is
// tracked here and deleted in afterAll, so the suite is safely rerunnable
// without a manual `supabase db reset` (categories.name is unique, so a
// leftover "Batteries"/"Oil" row would otherwise fail the next run).
const createdCategoryIds: string[] = [];

beforeAll(async () => {
  const admin = createAdminClient();

  // Clean up any test categories from previous runs (since categories.name is unique,
  // leftover categories from interrupted test runs will cause duplicate key violations)
  const testCategoryNames = [
    "Batteries",
    "Oil",
    "Filters",
    "Antifreeze",
    "Brakes",
    "Coolant",
    "Lubricant",
    "Wiper Blades",
    "Brake Parts",
    "In Use Category",
  ];

  for (const name of testCategoryNames) {
    // Get the category ID first
    const { data: catData } = await admin.from("categories").select("id").eq("name", name).maybeSingle();
    if (catData) {
      // Delete items that reference this category first (due to FK constraint)
      await admin.from("items").delete().eq("category_id", catData.id);
      // Then delete the category
      await admin.from("categories").delete().eq("id", catData.id);
    }
  }

  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-categories-owner@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;
});

afterAll(async () => {
  const admin = createAdminClient();
  // Deletion order matters: audit_log.actor_id -> profiles.id -> auth.users.id
  // are both non-cascading FKs, so audit_log rows must go first, then
  // profiles, then the auth user.
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().eq("actor_id", OWNER_ID);
  await admin.from("profiles").delete().eq("id", OWNER_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
});

test("createCategory inserts a category and writes an audit log entry", async () => {
  const supabase = createAdminClient();
  const category = await createCategory(supabase, OWNER_ID, "Batteries");
  createdCategoryIds.push(category.id);

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
  const category = await createCategory(supabase, OWNER_ID, "Oil");
  createdCategoryIds.push(category.id);

  await expect(createCategory(supabase, OWNER_ID, "Oil")).rejects.toThrow();
});

test("listCategories returns created categories ordered by name", async () => {
  const supabase = createAdminClient();
  const filters = await createCategory(supabase, OWNER_ID, "Filters");
  const antifreeze = await createCategory(supabase, OWNER_ID, "Antifreeze");
  createdCategoryIds.push(filters.id, antifreeze.id);

  const categories = await listCategories(supabase);
  const names = categories.map((c) => c.name);

  expect(names.indexOf("Antifreeze")).toBeLessThan(names.indexOf("Filters"));
});

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
