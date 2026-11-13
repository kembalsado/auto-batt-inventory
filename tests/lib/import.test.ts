import { createAdminClient } from "@/lib/supabase/admin";
import { importOpeningStock } from "@/lib/import";
import { randomUUID } from "node:crypto";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id), and createItem/recordAudit both write via it.
let OWNER_ID: string;

// Every item, category, batch, movement, and audit_log row created by this
// file's tests is tracked here and deleted in afterAll, so the suite is
// safely rerunnable without a manual `supabase db reset` (items.sku is
// unique, so a leftover row would otherwise fail the next run).
const createdItemIds: string[] = [];
const createdCategoryNames = new Set<string>();

// Unique per run so reruns never collide on items.sku/categories.name.
const runId = randomUUID().slice(0, 8);

async function trackItemBySku(sku: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("items").select("id").eq("sku", sku).single();
  if (data) createdItemIds.push(data.id);
}

beforeAll(async () => {
  const admin = createAdminClient();
  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-import-owner-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;
});

afterAll(async () => {
  const admin = createAdminClient();
  // Deletion order: batches/stock_movements reference items, and
  // audit_log.actor_id -> profiles.id -> auth.users.id are non-cascading
  // FKs, so those must go first, then profiles, then the auth user.
  await admin.from("stock_movements").delete().in("item_id", createdItemIds);
  await admin.from("batches").delete().in("item_id", createdItemIds);
  await admin.from("items").delete().in("id", createdItemIds);
  await admin
    .from("categories")
    .delete()
    .in("name", Array.from(createdCategoryNames));
  await admin.from("audit_log").delete().eq("actor_id", OWNER_ID);
  await admin.from("profiles").delete().eq("id", OWNER_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
});

test("importOpeningStock creates one item and one opening_stock batch per row", async () => {
  const admin = createAdminClient();
  const sku = `AB-${runId}-100`;
  const categoryName = `Batteries-${runId}`;
  createdCategoryNames.add(categoryName);

  const result = await importOpeningStock(admin, OWNER_ID, [
    {
      sku,
      name: "Test Battery",
      category: categoryName,
      qty: 18,
      lastKnownUnitCost: 1200,
    },
  ]);
  expect(result.succeeded).toBe(1);
  expect(result.errors).toHaveLength(0);

  const { data: item } = await admin
    .from("items")
    .select("id, category_id")
    .eq("sku", sku)
    .single();
  expect(item).not.toBeNull();
  createdItemIds.push(item!.id);

  const { data: category } = await admin
    .from("categories")
    .select("id, name")
    .eq("name", categoryName)
    .single();
  expect(item!.category_id).toBe(category!.id);

  const { data: batch } = await admin
    .from("batches")
    .select("*")
    .eq("item_id", item!.id)
    .single();
  expect(batch?.source).toBe("opening_stock");
  expect(batch?.qty_remaining).toBe(18);
  expect(batch?.qty_received).toBe(18);
  expect(Number(batch?.unit_cost)).toBe(1200);

  const { data: movement } = await admin
    .from("stock_movements")
    .select("*")
    .eq("item_id", item!.id)
    .single();
  expect(movement?.type).toBe("IN");
  expect(movement?.quantity).toBe(18);
  expect(movement?.batch_id).toBe(batch!.id);

  const { data: log } = await admin
    .from("audit_log")
    .select("*")
    .eq("entity_id", batch!.id)
    .single();
  expect(log).not.toBeNull();
});

test("importOpeningStock reports a clear per-row error for a SKU that already exists", async () => {
  const admin = createAdminClient();
  const sku = `AB-${runId}-101`;
  const categoryName = `Batteries-${runId}`;
  createdCategoryNames.add(categoryName);

  const first = await importOpeningStock(admin, OWNER_ID, [
    { sku, name: "Existing", category: categoryName, qty: 5, lastKnownUnitCost: 1000 },
  ]);
  expect(first.succeeded).toBe(1);
  await trackItemBySku(sku);

  const result = await importOpeningStock(admin, OWNER_ID, [
    { sku, name: "Existing", category: categoryName, qty: 5, lastKnownUnitCost: 1000 },
  ]);
  expect(result.succeeded).toBe(0);
  expect(result.errors[0].message).toMatch(/already exists/i);

  const { data: items } = await admin.from("items").select("id").eq("sku", sku);
  expect(items).toHaveLength(1);
});

test("importOpeningStock processes remaining rows after one row fails, and reuses an existing category by name", async () => {
  const admin = createAdminClient();
  const dupSku = `AB-${runId}-102`;
  const okSku = `AB-${runId}-103`;
  const categoryName = `Batteries-${runId}`;
  createdCategoryNames.add(categoryName);

  await importOpeningStock(admin, OWNER_ID, [
    { sku: dupSku, name: "Dup", category: categoryName, qty: 3, lastKnownUnitCost: 500 },
  ]);
  await trackItemBySku(dupSku);

  const result = await importOpeningStock(admin, OWNER_ID, [
    { sku: dupSku, name: "Dup", category: categoryName, qty: 3, lastKnownUnitCost: 500 },
    {
      sku: okSku,
      name: "OK Item",
      category: categoryName,
      qty: 7,
      lastKnownUnitCost: 800,
      lowStockThreshold: 2,
    },
  ]);

  expect(result.succeeded).toBe(1);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].row).toBe(0);

  const { data: item } = await admin
    .from("items")
    .select("id, low_stock_threshold")
    .eq("sku", okSku)
    .single();
  expect(item).not.toBeNull();
  createdItemIds.push(item!.id);
  expect(item!.low_stock_threshold).toBe(2);

  // Category was looked up by name, not duplicated.
  const { data: categories } = await admin
    .from("categories")
    .select("id")
    .eq("name", categoryName);
  expect(categories).toHaveLength(1);
});
