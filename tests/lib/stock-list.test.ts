import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordStockIn } from "@/lib/movements";
import { getSettings, updateSettings, type AppSettings } from "@/lib/settings";
import { buildStockListRows } from "@/lib/stock-list";
import { randomUUID } from "node:crypto";

// Same anon-client-signed-in-as-a-real-user pattern as
// tests/lib/cost-visibility.test.ts, so buildStockListRows is exercised
// against real RLS/view behavior, not just an admin client that bypasses
// it entirely.
function createAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: `test-${randomUUID()}`,
      },
    }
  );
}

const PASSWORD = "test-password-123";

let OWNER_ID: string;
let ASSISTANT_ID: string;
let OWNER_EMAIL: string;
let ASSISTANT_EMAIL: string;
let categoryId: string;
let itemWithStockId: string;
let itemNoStockId: string;
const createdItemIds: string[] = [];

const runId = randomUUID().slice(0, 8);
const skuPrefix = `AB-SL-${runId}`;

// app_settings is a single GLOBAL row (see tests/lib/cost-visibility.test.ts
// for the caveat) — this file flips show_cost_to_assistant, so it saves
// and restores the pre-existing value in afterAll.
let originalSettings: AppSettings;

beforeAll(async () => {
  const admin = createAdminClient();
  originalSettings = await getSettings(admin);

  OWNER_EMAIL = `test-stock-list-owner-${runId}@example.com`;
  ASSISTANT_EMAIL = `test-stock-list-assistant-${runId}@example.com`;

  const { data: owner } = await admin.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;

  const { data: assistant } = await admin.auth.admin.createUser({
    email: ASSISTANT_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;

  const category = await createCategory(admin, OWNER_ID, `Batteries-SL-${runId}`);
  categoryId = category.id;

  const itemWithStock = await createItem(admin, OWNER_ID, {
    sku: `${skuPrefix}-001`,
    name: "12V Battery",
    categoryId,
    unit: "pcs",
  });
  itemWithStockId = itemWithStock.id;
  createdItemIds.push(itemWithStockId);

  // Two batches at different costs/dates so FIFO ordering (oldest
  // remaining batch's cost) and the summed inventory value are both
  // exercised, not just a single-batch item.
  await recordStockIn(admin, OWNER_ID, {
    itemId: itemWithStockId,
    qty: 10,
    unitCost: 100,
    batchDate: "2026-01-01",
  });
  await recordStockIn(admin, OWNER_ID, {
    itemId: itemWithStockId,
    qty: 5,
    unitCost: 200,
    batchDate: "2026-02-01",
  });

  // A second active item with no stock movements at all, to prove it
  // still appears (qtyOnHand 0) and doesn't blow up cost computation.
  const itemNoStock = await createItem(admin, OWNER_ID, {
    sku: `${skuPrefix}-002`,
    name: "6V Battery",
    categoryId,
    unit: "pcs",
  });
  itemNoStockId = itemNoStock.id;
  createdItemIds.push(itemNoStockId);

  // An inactive item must never show up in the stock list.
  const inactiveItem = await createItem(admin, OWNER_ID, {
    sku: `${skuPrefix}-003`,
    name: "Inactive Battery",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(inactiveItem.id);
  await admin.from("items").update({ is_active: false }).eq("id", inactiveItem.id);
});

afterAll(async () => {
  const admin = createAdminClient();

  await updateSettings(admin, OWNER_ID, originalSettings);

  const { data: batches } = await admin
    .from("batches")
    .select("id")
    .in("item_id", createdItemIds);
  const batchIds = (batches ?? []).map((b) => b.id);

  const { data: movements } = await admin
    .from("stock_movements")
    .select("id")
    .in("item_id", createdItemIds);
  const movementIds = (movements ?? []).map((m) => m.id);

  if (movementIds.length) {
    await admin.from("movement_allocations").delete().in("movement_id", movementIds);
  }
  await admin.from("stock_movements").delete().in("item_id", createdItemIds);
  if (batchIds.length) {
    await admin.from("batches").delete().in("id", batchIds);
  }
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().eq("id", categoryId);
  await admin.from("audit_log").delete().in("actor_id", [OWNER_ID, ASSISTANT_ID]);
  await admin.from("profiles").delete().in("id", [OWNER_ID, ASSISTANT_ID]);
  await admin.auth.admin.deleteUser(OWNER_ID);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
});

async function signIn(email: string) {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(error).toBeNull();
  return client;
}

test("buildStockListRows omits cost fields for an assistant when cost is hidden", async () => {
  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: false });

  const assistantClient = await signIn(ASSISTANT_EMAIL);
  const rows = await buildStockListRows(assistantClient, "assistant");
  const ownRows = rows.filter((r) => r.sku.startsWith(skuPrefix));

  expect(ownRows.length).toBeGreaterThan(0);
  expect(ownRows.every((r) => r.unitCost === undefined && r.inventoryValue === undefined)).toBe(
    true
  );
  // Genuinely absent, not just undefined-valued — a hidden viewer's row
  // must not carry the keys at all.
  expect(ownRows.every((r) => !("unitCost" in r) && !("inventoryValue" in r))).toBe(true);
});

test("buildStockListRows includes cost fields for the owner", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const ownRows = rows.filter((r) => r.sku.startsWith(skuPrefix));

  expect(ownRows.length).toBeGreaterThan(0);
  expect(ownRows.some((r) => typeof r.unitCost === "number")).toBe(true);
  expect(ownRows.some((r) => typeof r.inventoryValue === "number")).toBe(true);
});

test("buildStockListRows includes cost fields for an assistant once the owner shows cost", async () => {
  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: true });

  const assistantClient = await signIn(ASSISTANT_EMAIL);
  const rows = await buildStockListRows(assistantClient, "assistant");
  const ownRows = rows.filter((r) => r.sku.startsWith(skuPrefix));

  expect(ownRows.some((r) => typeof r.unitCost === "number")).toBe(true);
});

test("qtyOnHand sums qty_remaining across an item's batches", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const row = rows.find((r) => r.sku === `${skuPrefix}-001`);

  expect(row?.qtyOnHand).toBe(15);
});

test("unitCost reflects the oldest remaining batch (FIFO), not the newest or an average", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const row = rows.find((r) => r.sku === `${skuPrefix}-001`);

  expect(row?.unitCost).toBe(100);
});

test("inventoryValue totals qty_remaining * unit_cost across all remaining batches", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const row = rows.find((r) => r.sku === `${skuPrefix}-001`);

  // 10 @ 100 + 5 @ 200 = 2000
  expect(row?.inventoryValue).toBe(2000);
});

test("an item with no batches appears with qtyOnHand 0 and no unitCost", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const row = rows.find((r) => r.sku === `${skuPrefix}-002`);

  expect(row).toBeDefined();
  expect(row?.qtyOnHand).toBe(0);
  expect(row?.unitCost).toBeUndefined();
  expect(row?.inventoryValue).toBe(0);
});

test("an inactive item is excluded from the stock list", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const row = rows.find((r) => r.sku === `${skuPrefix}-003`);

  expect(row).toBeUndefined();
});

// The Items list (app/(dashboard)/items/page.tsx) renders from these same
// rows instead of calling getItemStockSummary once per item (3 queries
// each, including the item's full movement history). That needs the id to
// link with, the low-stock flag to badge with, and inactive items
// included — all computed from the same bulk queries, no extra round
// trips.
test("rows carry the item's id, so a list can link to /items/<id> without a second query", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const row = rows.find((r) => r.sku === `${skuPrefix}-001`);

  expect(row?.id).toBe(itemWithStockId);
});

test("isLowStock uses the shared isLowStockQty rule against the global default threshold", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");

  // 15 on hand, default threshold 5 -> not low.
  expect(rows.find((r) => r.sku === `${skuPrefix}-001`)?.isLowStock).toBe(false);
  // 0 on hand -> at or below the threshold -> low.
  expect(rows.find((r) => r.sku === `${skuPrefix}-002`)?.isLowStock).toBe(true);
});

test("isLowStock honours an item's own threshold over the global default", async () => {
  const admin = createAdminClient();
  // 15 on hand with a per-item threshold of 20 is low, even though the
  // global default (5) would say otherwise.
  await admin
    .from("items")
    .update({ low_stock_threshold: 20 })
    .eq("id", itemWithStockId);

  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  expect(rows.find((r) => r.sku === `${skuPrefix}-001`)?.isLowStock).toBe(true);

  await admin
    .from("items")
    .update({ low_stock_threshold: null })
    .eq("id", itemWithStockId);
});

test("includeInactive brings deactivated items back, marked as inactive", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);

  const defaultRows = await buildStockListRows(ownerClient, "owner");
  expect(defaultRows.find((r) => r.sku === `${skuPrefix}-003`)).toBeUndefined();
  expect(defaultRows.every((r) => r.isActive)).toBe(true);

  const allRows = await buildStockListRows(ownerClient, "owner", {
    includeInactive: true,
  });
  const inactive = allRows.find((r) => r.sku === `${skuPrefix}-003`);
  expect(inactive).toBeDefined();
  expect(inactive?.isActive).toBe(false);
  // The active ones still come through, still flagged active.
  expect(allRows.find((r) => r.sku === `${skuPrefix}-001`)?.isActive).toBe(true);
});

test("rows carry the item's category name and unit", async () => {
  const ownerClient = await signIn(OWNER_EMAIL);
  const rows = await buildStockListRows(ownerClient, "owner");
  const row = rows.find((r) => r.sku === `${skuPrefix}-001`);

  expect(row?.category).toBe(`Batteries-SL-${runId}`);
  expect(row?.unit).toBe("pcs");
  expect(row?.name).toBe("12V Battery");
});
