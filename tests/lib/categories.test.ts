import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory, listCategories } from "@/lib/categories";

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
