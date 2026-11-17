import { createAdminClient } from "@/lib/supabase/admin";
import { createCarMake, listCarMakes } from "@/lib/car-makes";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordAudit writes a row on every createCarMake call).
let OWNER_ID: string;

// Every car make and audit_log row created by this file's tests is
// tracked here and deleted in afterAll, so the suite is safely rerunnable
// without a manual `supabase db reset` (car_makes.name is unique, so a
// leftover "Toyota"/"Honda" row would otherwise fail the next run).
const createdMakeIds: string[] = [];

beforeAll(async () => {
  const admin = createAdminClient();
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
