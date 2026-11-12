import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem, listItems } from "@/lib/items";
import { randomUUID } from "node:crypto";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordAudit writes a row on every createItem call).
let ASSISTANT_ID: string;
let categoryId: string;

// Every item, category, and audit_log row created by this file's tests is
// tracked here and deleted in afterAll, so the suite is safely rerunnable
// without a manual `supabase db reset` (items.sku is unique, so a leftover
// row would otherwise fail the next run).
const createdItemIds: string[] = [];
const createdCategoryIds: string[] = [];

// Unique per run so reruns never collide on categories.name either.
const runId = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = createAdminClient();
  const { data: assistant } = await admin.auth.admin.createUser({
    email: `test-items-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;

  const category = await createCategory(admin, ASSISTANT_ID, `Batteries-${runId}`);
  createdCategoryIds.push(category.id);
  categoryId = category.id;
});

afterAll(async () => {
  const admin = createAdminClient();
  // Deletion order matters: audit_log.actor_id -> profiles.id -> auth.users.id
  // are both non-cascading FKs, so audit_log rows must go first, then
  // profiles, then the auth user. items/categories have no FK pointing at
  // them from audit_log, but items must go before categories isn't
  // required here since category_id has no ON DELETE restrict... delete
  // items first anyway to be safe.
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().eq("actor_id", ASSISTANT_ID);
  await admin.from("profiles").delete().eq("id", ASSISTANT_ID);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
});

test("createItem succeeds with a unique SKU and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const sku = `AB-${runId}-001`;
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku,
    name: "12V Battery",
    categoryId,
    unit: "pcs",
    lowStockThreshold: 5,
  });
  createdItemIds.push(item.id);

  expect(item.sku).toBe(sku);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", item.id)
    .eq("action", "item.created")
    .single();
  expect(log?.action).toBe("item.created");
});

test("createItem rejects a duplicate SKU", async () => {
  const supabase = createAdminClient();
  const sku = `AB-${runId}-002`;
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku,
    name: "Battery",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  await expect(
    createItem(supabase, ASSISTANT_ID, {
      sku,
      name: "Other",
      categoryId,
      unit: "pcs",
    })
  ).rejects.toThrow();
});

test("listItems returns created items", async () => {
  const supabase = createAdminClient();
  const sku = `AB-${runId}-003`;
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku,
    name: "Alternator",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  const items = await listItems(supabase);
  const skus = items.map((i) => i.sku);
  expect(skus).toContain(sku);
});
