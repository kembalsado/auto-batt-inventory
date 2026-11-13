import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { describeError, isUniqueViolation } from "@/lib/errors";
import { randomUUID } from "node:crypto";

const runId = randomUUID().slice(0, 8);

let ACTOR_ID: string;
let categoryId: string;
const createdItemIds: string[] = [];
const createdCategoryIds: string[] = [];

beforeAll(async () => {
  const admin = createAdminClient();
  const { data: actor } = await admin.auth.admin.createUser({
    email: `test-errors-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  ACTOR_ID = actor!.user!.id;

  const category = await createCategory(admin, ACTOR_ID, `Errors-${runId}`);
  createdCategoryIds.push(category.id);
  categoryId = category.id;
});

afterAll(async () => {
  const admin = createAdminClient();
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().eq("actor_id", ACTOR_ID);
  await admin.from("profiles").delete().eq("id", ACTOR_ID);
  await admin.auth.admin.deleteUser(ACTOR_ID);
});

test("describeError reads the message off a supabase PostgrestError, which is not an Error instance", () => {
  const postgrestError = {
    message: "permission denied for table batches",
    code: "42501",
    details: null,
    hint: null,
  };

  expect(postgrestError).not.toBeInstanceOf(Error);
  expect(describeError(postgrestError)).toBe(
    "permission denied for table batches"
  );
  // The old `String(err)` fallback produced this, which is what the
  // import screen actually showed the user.
  expect(describeError(postgrestError)).not.toBe("[object Object]");
});

test("describeError still handles real Errors and plain values", () => {
  expect(describeError(new Error("boom"))).toBe("boom");
  expect(describeError("just a string")).toBe("just a string");
  expect(describeError(null)).toBe("null");
});

// Proven against the real database rather than a hand-written object, so
// the code this checks for is the code Postgres/PostgREST actually sends.
test("isUniqueViolation recognises a real duplicate-SKU rejection", async () => {
  const admin = createAdminClient();
  const sku = `AB-ERR-${runId}`;

  const item = await createItem(admin, ACTOR_ID, {
    sku,
    name: "First",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  let caught: unknown;
  try {
    await createItem(admin, ACTOR_ID, {
      sku,
      name: "Duplicate",
      categoryId,
      unit: "pcs",
    });
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  expect(isUniqueViolation(caught)).toBe(true);
});

test("isUniqueViolation recognises a real duplicate-category-name rejection", async () => {
  const admin = createAdminClient();
  const name = `Errors-${runId}`;

  let caught: unknown;
  try {
    await createCategory(admin, ACTOR_ID, name);
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  expect(isUniqueViolation(caught)).toBe(true);
});

test("isUniqueViolation is false for other failures", () => {
  expect(isUniqueViolation({ code: "42501", message: "permission denied" })).toBe(
    false
  );
  expect(isUniqueViolation(new Error("boom"))).toBe(false);
  expect(isUniqueViolation(null)).toBe(false);
  expect(isUniqueViolation(undefined)).toBe(false);
});
