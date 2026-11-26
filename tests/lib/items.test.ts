import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createCarMake } from "@/lib/car-makes";
import { createItem, listItems, updateItem, deleteItem } from "@/lib/items";
import { listFitmentsForItem } from "@/lib/item-fitments";
import { recordStockIn } from "@/lib/movements";
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
  //
  // batches/stock_movements.item_id also reference items with no cascade
  // — a single `items.delete().in(...)` is one SQL statement, so if ANY
  // tracked id still has batch/movement rows (the deleteItem
  // stock-history-blocked test's item), Postgres rolls back that whole
  // statement and deletes NOTHING, including every other otherwise-
  // deletable id in the same `in()` list. Clear history first.
  await admin.from("stock_movements").delete().in("item_id", createdItemIds);
  await admin.from("batches").delete().in("item_id", createdItemIds);
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

test("createItem writes fitments via replaceFitmentsForItem and they're readable afterward", async () => {
  const supabase = createAdminClient();
  const make = await createCarMake(supabase, ASSISTANT_ID, `ItemsFitment-Make-${runId}`);
  createdMakeIds.push(make.id);
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-FIT-${runId}`, name: "Vehicle item", categoryId, unit: "pcs",
    fitments: [{ makeId: make.id, model: "Vios", variant: "1.3 E CVT", yearFrom: 2017, yearTo: 2017 }],
  });
  createdItemIds.push(item.id);
  const fitments = await listFitmentsForItem(supabase, item.id);
  expect(fitments).toHaveLength(1);
  expect(fitments[0]).toMatchObject({ makeId: make.id, model: "Vios", variant: "1.3 E CVT", yearFrom: 2017, yearTo: 2017 });
});

test("createItem with no fitments leaves the item with zero tags", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, { sku: `ITEMS-NOFIT-${runId}`, name: "General item", categoryId, unit: "pcs" });
  createdItemIds.push(item.id);
  expect(await listFitmentsForItem(supabase, item.id)).toEqual([]);
});

test("createItem leaves no orphaned item behind when the fitments write fails", async () => {
  // The item insert and the fitments write are two separate statements
  // with no surrounding transaction. A fitment referencing a make_id that
  // doesn't exist violates item_fitments' FK to car_makes, so the second
  // statement throws after the first has already committed. createItem
  // must then delete the item it just created — otherwise the user's
  // retry hits "duplicate SKU" on a tag-less, audit-less ghost row.
  const supabase = createAdminClient();
  const sku = `ITEMS-FIT-FAIL-${runId}`;
  const missingMakeId = randomUUID();

  await expect(
    createItem(supabase, ASSISTANT_ID, {
      sku, name: "Doomed", categoryId, unit: "pcs",
      fitments: [{ makeId: missingMakeId, model: "Vios", variant: null, yearFrom: null, yearTo: null }],
    })
  ).rejects.toThrow();

  const { data: survivors } = await supabase.from("items").select("id").eq("sku", sku);
  expect(survivors).toEqual([]);

  // The same sku is therefore free again — the retry a real user makes.
  const retried = await createItem(supabase, ASSISTANT_ID, {
    sku, name: "Doomed", categoryId, unit: "pcs",
  });
  createdItemIds.push(retried.id);
  expect(retried.sku).toBe(sku);
});

test("updateItem changes an item's fields and writes an item.updated audit entry", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `ITEMS-UPD-${runId}`, name: "Before", categoryId, unit: "pcs",
  });
  createdItemIds.push(item.id);
  const updated = await updateItem(supabase, ASSISTANT_ID, item.id, {
    sku: item.sku, name: "After", categoryId, unit: "pcs",
  });
  expect(updated.name).toBe("After");
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

test("deleteItem removes an item with no history and records an audit log entry", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `AB-DEL-OK-${runId}`,
    name: "Delete Me",
    categoryId,
    unit: "pcs",
  });

  await deleteItem(supabase, ASSISTANT_ID, item.id);

  const { data } = await supabase.from("items").select("id").eq("id", item.id).maybeSingle();
  expect(data).toBeNull();

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", item.id)
    .eq("action", "item.deleted")
    .single();
  expect(log?.summary).toContain(`AB-DEL-OK-${runId}`);
});

test("deleteItem rejects deleting an item that already has stock history", async () => {
  const supabase = createAdminClient();
  const item = await createItem(supabase, ASSISTANT_ID, {
    sku: `AB-DEL-BLOCKED-${runId}`,
    name: "Blocks delete",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item.id);

  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: item.id,
    qty: 5,
    unitCost: 10,
    batchDate: "2026-01-01",
  });

  await expect(deleteItem(supabase, ASSISTANT_ID, item.id)).rejects.toThrow();

  const { data } = await supabase.from("items").select("id").eq("id", item.id).maybeSingle();
  expect(data).not.toBeNull();
});
