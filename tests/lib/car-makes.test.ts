import { createAdminClient } from "@/lib/supabase/admin";
import { createCarMake, listCarMakes, updateCarMake, deleteCarMake } from "@/lib/car-makes";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordAudit writes a row on every createCarMake call).
let OWNER_ID: string;

// Every car make and audit_log row created by this file's tests is
// tracked here and deleted in afterAll, so the suite is safely rerunnable
// without a manual `supabase db reset` (car_makes.name is unique, so a
// leftover "Toyota"/"Honda" row would otherwise fail the next run).
const createdMakeIds: string[] = [];

// Track created categories for FK test cleanup
const createdCategoryIds: string[] = [];

beforeAll(async () => {
  const admin = createAdminClient();

  // Clean up any test car makes from previous runs (since car_makes.name is unique,
  // leftover makes from interrupted test runs will cause duplicate key violations)
  const testMakeNames = [
    "Toyota",
    "Honda",
    "ZZZ-Toyota",
    "AAA-Honda",
    "Ford",
    "BMW",
    "Mercedes",
    "Audi",
    "Chevrolet",
    "In Use Make",
  ];

  for (const name of testMakeNames) {
    // Get the make ID first
    const { data: makeData } = await admin.from("car_makes").select("id").eq("name", name).maybeSingle();
    if (makeData) {
      // Delete items that reference this make first (due to FK constraint)
      await admin.from("items").delete().eq("make_id", makeData.id);
      // Then delete the make
      await admin.from("car_makes").delete().eq("id", makeData.id);
    }
  }

  // Clean up test categories from previous runs
  const testCategoryNames = [
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
    email: "test-car-makes-owner@example.com",
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
  await admin.from("car_makes").delete().in("id", createdMakeIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().eq("actor_id", OWNER_ID);
  await admin.from("profiles").delete().eq("id", OWNER_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
});

test("createCarMake inserts a make and writes an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, "Toyota");
  createdMakeIds.push(make.id);

  expect(make.name).toBe("Toyota");

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .single();
  expect(log?.action).toBe("car_make.created");
});

test("createCarMake rejects a duplicate name", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, "Honda");
  createdMakeIds.push(make.id);

  await expect(createCarMake(supabase, OWNER_ID, "Honda")).rejects.toThrow();
});

test("listCarMakes returns created makes ordered by name", async () => {
  const supabase = createAdminClient();
  const toyota = await createCarMake(supabase, OWNER_ID, "ZZZ-Toyota");
  const honda = await createCarMake(supabase, OWNER_ID, "AAA-Honda");
  createdMakeIds.push(toyota.id, honda.id);

  const makes = await listCarMakes(supabase);
  const names = makes.map((m) => m.name);

  expect(names.indexOf("AAA-Honda")).toBeLessThan(names.indexOf("ZZZ-Toyota"));
});

test("updateCarMake renames a car make and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, "Ford");
  createdMakeIds.push(make.id);

  const updated = await updateCarMake(supabase, OWNER_ID, make.id, "Chevrolet");
  expect(updated.name).toBe("Chevrolet");

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .eq("action", "car_make.updated")
    .single();
  expect(log?.summary).toContain("Chevrolet");
});

test("updateCarMake rejects renaming to a name that collides with a different car make", async () => {
  const supabase = createAdminClient();
  const a = await createCarMake(supabase, OWNER_ID, "BMW");
  const b = await createCarMake(supabase, OWNER_ID, "Mercedes");
  createdMakeIds.push(a.id, b.id);

  await expect(updateCarMake(supabase, OWNER_ID, b.id, "BMW")).rejects.toThrow();
});

test("deleteCarMake removes an unused car make and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, "Audi");

  await deleteCarMake(supabase, OWNER_ID, make.id);

  const { data } = await supabase.from("car_makes").select("id").eq("id", make.id).maybeSingle();
  expect(data).toBeNull();

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .eq("action", "car_make.deleted")
    .single();
  expect(log?.summary).toContain("Audi");
});

test("deleteCarMake rejects deleting a car make that's still referenced by an item", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, "In Use Make");
  createdMakeIds.push(make.id);
  const category = await createCategory(supabase, OWNER_ID, "In Use Category");
  createdCategoryIds.push(category.id);
  const item = await createItem(supabase, OWNER_ID, {
    sku: `AB-MAKE-INUSE-${make.id.slice(0, 8)}`,
    name: "Blocks delete",
    categoryId: category.id,
    makeId: make.id,
    unit: "pcs",
  });

  await expect(deleteCarMake(supabase, OWNER_ID, make.id)).rejects.toThrow();

  await supabase.from("items").delete().eq("id", item.id);
});
