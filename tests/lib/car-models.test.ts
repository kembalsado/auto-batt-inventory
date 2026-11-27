import { createAdminClient } from "@/lib/supabase/admin";
import { createCarMake } from "@/lib/car-makes";
import { createCarModel, listCarModels, updateCarModel, deleteCarModel } from "@/lib/car-models";
import { randomUUID } from "node:crypto";

// Every fixture name below gets this suffix so it can never collide with
// real seeded data or with another concurrent test run's rows — see
// tests/lib/errors.test.ts and tests/db/schema.test.ts for the same pattern.
const runId = randomUUID().slice(0, 8);

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordAudit writes a row on every createCarModel call).
let OWNER_ID: string;

// Every car make, car model, and audit_log row created by this file's tests
// is tracked here and deleted in afterAll.
const createdMakeIds: string[] = [];
const createdModelIds: string[] = [];

beforeAll(async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-car-models-owner-${runId}@example.com`,
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
  await admin.from("car_models").delete().in("id", createdModelIds);
  await admin.from("car_makes").delete().in("id", createdMakeIds);
  await admin.from("audit_log").delete().eq("actor_id", OWNER_ID);
  await admin.from("profiles").delete().eq("id", OWNER_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
});

test("createCarModel inserts a model under a make and writes an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Toyota-${runId}`);
  createdMakeIds.push(make.id);

  const model = await createCarModel(supabase, OWNER_ID, make.id, `Camry-${runId}`);
  createdModelIds.push(model.id);

  expect(model.makeId).toBe(make.id);
  expect(model.name).toBe(`Camry-${runId}`);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", model.id)
    .single();
  expect(log?.action).toBe("car_model.created");
});

test("createCarModel rejects a duplicate name under the same make", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Honda-${runId}`);
  createdMakeIds.push(make.id);

  const model = await createCarModel(supabase, OWNER_ID, make.id, `Civic-${runId}`);
  createdModelIds.push(model.id);

  await expect(createCarModel(supabase, OWNER_ID, make.id, `Civic-${runId}`)).rejects.toThrow();
});

test("createCarModel allows the same name under two different makes", async () => {
  const supabase = createAdminClient();
  const toyota = await createCarMake(supabase, OWNER_ID, `Toyota-${runId}-make2`);
  const honda = await createCarMake(supabase, OWNER_ID, `Honda-${runId}-make2`);
  createdMakeIds.push(toyota.id, honda.id);

  const model1 = await createCarModel(supabase, OWNER_ID, toyota.id, `Accord-${runId}`);
  const model2 = await createCarModel(supabase, OWNER_ID, honda.id, `Accord-${runId}`);
  createdModelIds.push(model1.id, model2.id);

  expect(model1.makeId).toBe(toyota.id);
  expect(model1.name).toBe(`Accord-${runId}`);
  expect(model2.makeId).toBe(honda.id);
  expect(model2.name).toBe(`Accord-${runId}`);
});

test("listCarModels returns created models ordered by name", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Mazda-${runId}`);
  createdMakeIds.push(make.id);

  const model1 = await createCarModel(supabase, OWNER_ID, make.id, `ZZZ-CX9-${runId}`);
  const model2 = await createCarModel(supabase, OWNER_ID, make.id, `AAA-CX3-${runId}`);
  createdModelIds.push(model1.id, model2.id);

  const models = await listCarModels(supabase);
  const names = models.map((m) => m.name);

  expect(names.indexOf(`AAA-CX3-${runId}`)).toBeLessThan(names.indexOf(`ZZZ-CX9-${runId}`));
});

test("updateCarModel renames a model and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Ford-${runId}`);
  createdMakeIds.push(make.id);

  const model = await createCarModel(supabase, OWNER_ID, make.id, `Focus-${runId}`);
  createdModelIds.push(model.id);

  const updated = await updateCarModel(supabase, OWNER_ID, model.id, `Mustang-${runId}`);
  expect(updated.name).toBe(`Mustang-${runId}`);
  expect(updated.makeId).toBe(make.id);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", model.id)
    .eq("action", "car_model.updated")
    .single();
  expect(log?.summary).toContain(`Mustang-${runId}`);
});

test("updateCarModel rejects renaming to a name that collides within the same make", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `BMW-${runId}`);
  createdMakeIds.push(make.id);

  const model1 = await createCarModel(supabase, OWNER_ID, make.id, `Series3-${runId}`);
  const model2 = await createCarModel(supabase, OWNER_ID, make.id, `Series5-${runId}`);
  createdModelIds.push(model1.id, model2.id);

  await expect(updateCarModel(supabase, OWNER_ID, model2.id, `Series3-${runId}`)).rejects.toThrow();
});

test("deleteCarModel removes a model and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, OWNER_ID, `Audi-${runId}`);
  createdMakeIds.push(make.id);

  const model = await createCarModel(supabase, OWNER_ID, make.id, `A4-${runId}`);

  await deleteCarModel(supabase, OWNER_ID, model.id);

  const { data } = await supabase.from("car_models").select("id").eq("id", model.id).maybeSingle();
  expect(data).toBeNull();

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", model.id)
    .eq("action", "car_model.deleted")
    .single();
  expect(log?.summary).toContain(`A4-${runId}`);
});
