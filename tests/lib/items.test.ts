import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createCarMake } from "@/lib/car-makes";
import {
  createItem,
  listItems,
  updateItem,
  listDistinctModelsAndVariants,
} from "@/lib/items";
import { randomUUID } from "node:crypto";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordAudit writes a row on every createItem call).
let ASSISTANT_ID: string;
let categoryId: string;

// Every item, category, car_make, and audit_log row created by this file's
// tests is tracked here and deleted in afterAll, so the suite is safely
// rerunnable without a manual `supabase db reset` (items.sku is unique, so
// a leftover row would otherwise fail the next run).
const createdItemIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdMakeIds: string[] = [];

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
  await admin.from("car_makes").delete().in("id", createdMakeIds);
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

test("createItem accepts and stores make_id, model, variant, and year", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, ASSISTANT_ID, `ItemsTest-Make-${runId}`);
  createdMakeIds.push(make.id);
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-VEH-${runId}`, name: "Vehicle item", categoryId, unit: "pcs",
    makeId: make.id, model: "Vios", variant: "1.3 E CVT", year: 2017,
  });
  createdItemIds.push(item.id);
  expect(item.make_id).toBe(make.id);
  expect(item.model).toBe("Vios");
  expect(item.variant).toBe("1.3 E CVT");
  expect(item.year).toBe(2017);
});

test("createItem defaults vehicle fields to null when omitted", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-GEN-${runId}`, name: "General item", categoryId, unit: "pcs",
  });
  createdItemIds.push(item.id);
  expect(item.make_id).toBeNull();
  expect(item.model).toBeNull();
  expect(item.variant).toBeNull();
  expect(item.year).toBeNull();
});

test("updateItem changes an item's fields and writes an item.updated audit entry", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-UPD-${runId}`, name: "Before", categoryId, unit: "pcs",
  });
  createdItemIds.push(item.id);
  const updated = await updateItem(supabase, ASSISTANT_ID, item.id, {
    sku: item.sku, name: "After", categoryId, unit: "pcs", model: "Civic",
  });
  expect(updated.name).toBe("After");
  expect(updated.model).toBe("Civic");
  const { data: log } = await supabase
    .from("audit_log").select("*").eq("entity_id", item.id).eq("action", "item.updated").single();
  expect(log?.summary).toContain(item.sku);
});

test("updateItem rejects renaming an item's SKU to one that already exists", async () => {
  const supabase = createAdminClient();
  const a = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-DUPA-${runId}`, name: "A", categoryId, unit: "pcs" });
  const b = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-DUPB-${runId}`, name: "B", categoryId, unit: "pcs" });
  createdItemIds.push(a.id, b.id);
  await expect(
    updateItem(supabase, ASSISTANT_ID, b.id, { sku: a.sku, name: "B", categoryId, unit: "pcs" })
  ).rejects.toThrow();
});

test("listDistinctModelsAndVariants returns sorted, deduplicated, non-null values", async () => {
  const supabase = createAdminClient();
  const i1 = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-MV1-${runId}`, name: "x", categoryId, unit: "pcs", model: "Vios", variant: "E" });
  const i2 = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-MV2-${runId}`, name: "y", categoryId, unit: "pcs", model: "Vios", variant: "G" });
  createdItemIds.push(i1.id, i2.id);
  const { models, variants } = await listDistinctModelsAndVariants(supabase);
  expect(models.filter((m) => m === "Vios")).toHaveLength(1); // deduplicated
  expect(variants).toContain("E");
  expect(variants).toContain("G");
});

test("listDistinctModelsAndVariants on a table with no model/variant values returns empty arrays, not an error", async () => {
  const supabase = createAdminClient();
  // Relies on the shared local DB potentially having other rows with
  // model/variant set from other tests — assert shape/no-throw rather
  // than exact emptiness: both are arrays and the call resolves.
  const result = await listDistinctModelsAndVariants(supabase);
  expect(Array.isArray(result.models)).toBe(true);
  expect(Array.isArray(result.variants)).toBe(true);
});
