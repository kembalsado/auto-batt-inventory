import { createAdminClient } from "@/lib/supabase/admin";
import { createCarMake, listCarMakes, updateCarMake, deleteCarMake } from "@/lib/car-makes";
import { createCarModel } from "@/lib/car-models";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { replaceFitmentsForItem } from "@/lib/item-fitments";
import { randomUUID } from "node:crypto";

// Every fixture name below gets this suffix so it can never collide with
// real seeded data (an auto-battery-inventory app plausibly has real
// makes named "Toyota", "Honda", etc.) or with another concurrent test
// run's rows — see tests/lib/errors.test.ts and tests/db/schema.test.ts
// for the same pattern. Because every name is run-unique, there is nothing
// for a previous run to have left behind, so (unlike this file's earlier
// version) there is no by-name leftover cleanup here.
const runId = randomUUID().slice(0, 8);

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordAudit writes a row on every createCarMake call).
let OWNER_ID: string;

// Every car make and audit_log row created by this file's tests is
// tracked here and deleted in afterAll, so the suite is safely rerunnable
// without a manual `supabase db reset`.
const createdMakeIds: string[] = [];

// Track created categories for FK test cleanup
const createdCategoryIds: string[] = [];

beforeAll(async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-car-makes-owner-${runId}@example.com`,
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
  const make = await createCarMake(supabase, OWNER_ID, `Toyota-${runId}`);
  createdMakeIds.push(make.id);

  expect(make.name).toBe(`Toyota-${runId}`);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .single();
  expect(log?.action).toBe("car_make.created");
});

test("createCarMake rejects a duplicate name", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Honda-${runId}`);
  createdMakeIds.push(make.id);

  await expect(createCarMake(supabase, OWNER_ID, `Honda-${runId}`)).rejects.toThrow();
});

test("listCarMakes returns created makes ordered by name", async () => {
  const supabase = createAdminClient();
  const toyota = await createCarMake(supabase, OWNER_ID, `ZZZ-Toyota-${runId}`);
  const honda = await createCarMake(supabase, OWNER_ID, `AAA-Honda-${runId}`);
  createdMakeIds.push(toyota.id, honda.id);

  const makes = await listCarMakes(supabase);
  const names = makes.map((m) => m.name);

  expect(names.indexOf(`AAA-Honda-${runId}`)).toBeLessThan(names.indexOf(`ZZZ-Toyota-${runId}`));
});

test("updateCarMake renames a car make and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Ford-${runId}`);
  createdMakeIds.push(make.id);

  const updated = await updateCarMake(supabase, OWNER_ID, make.id, `Chevrolet-${runId}`);
  expect(updated.name).toBe(`Chevrolet-${runId}`);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .eq("action", "car_make.updated")
    .single();
  expect(log?.summary).toContain(`Chevrolet-${runId}`);
});

test("updateCarMake rejects renaming to a name that collides with a different car make", async () => {
  const supabase = createAdminClient();
  const a = await createCarMake(supabase, OWNER_ID, `BMW-${runId}`);
  const b = await createCarMake(supabase, OWNER_ID, `Mercedes-${runId}`);
  createdMakeIds.push(a.id, b.id);

  await expect(updateCarMake(supabase, OWNER_ID, b.id, `BMW-${runId}`)).rejects.toThrow();
});

test("deleteCarMake removes an unused car make and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Audi-${runId}`);

  await deleteCarMake(supabase, OWNER_ID, make.id);

  const { data } = await supabase.from("car_makes").select("id").eq("id", make.id).maybeSingle();
  expect(data).toBeNull();

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .eq("action", "car_make.deleted")
    .single();
  expect(log?.summary).toContain(`Audi-${runId}`);
});

test("deleteCarMake's audit summary mentions the model count when the make has models", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Lexus-${runId}`);
  const model1 = await createCarModel(supabase, OWNER_ID, make.id, `ES-${runId}`);
  const model2 = await createCarModel(supabase, OWNER_ID, make.id, `RX-${runId}`);

  await deleteCarMake(supabase, OWNER_ID, make.id);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .eq("action", "car_make.deleted")
    .single();
  expect(log?.summary).toContain(`Lexus-${runId}`);
  expect(log?.summary).toContain("2 model(s)");

  // The cascade already deleted both models along with the make.
  const { data: remainingModels } = await supabase
    .from("car_models")
    .select("id")
    .in("id", [model1.id, model2.id]);
  expect(remainingModels).toHaveLength(0);
});

test("deleteCarMake's audit summary omits any model mention when the make has no models", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Jeep-${runId}`);

  await deleteCarMake(supabase, OWNER_ID, make.id);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", make.id)
    .eq("action", "car_make.deleted")
    .single();
  expect(log?.summary).toBe(`Deleted car make Jeep-${runId}`);
  expect(log?.summary).not.toContain("model");
});

test("deleteCarMake rejects deleting a car make that's still referenced by an item", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `In Use Make-${runId}`);
  createdMakeIds.push(make.id);
  const category = await createCategory(supabase, OWNER_ID, `In Use Category-${runId}`);
  createdCategoryIds.push(category.id);
  const item = await createItem(supabase, OWNER_ID, {
    sku: `AB-MAKE-INUSE-${make.id.slice(0, 8)}`,
    name: "Blocks delete",
    categoryId: category.id,
    unit: "pcs",
  });
  await replaceFitmentsForItem(supabase, item.id, [
    { makeId: make.id, model: null, variant: null, yearFrom: null, yearTo: null },
  ]);

  try {
    await expect(deleteCarMake(supabase, OWNER_ID, make.id)).rejects.toThrow();
  } finally {
    // The item's cascade delete (item_fitments.item_id references items
    // with on delete cascade) takes the fitment row with it.
    await supabase.from("items").delete().eq("id", item.id);
  }
});
