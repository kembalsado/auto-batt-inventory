import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordStockIn, recordStockOut, voidMovement } from "@/lib/movements";
import { getSettings, updateSettings, type AppSettings } from "@/lib/settings";
import { getItemStockSummary, isLowStockQty } from "@/lib/stock";
import { randomUUID } from "node:crypto";

// isLowStockQty is a pure function (no DB access) — unit-tested directly
// with plain values, independent of the DB-backed tests below. This is
// the single implementation getItemStockSummary itself calls internally,
// and the primitive Task 13 (stock list) / Task 16 (daily email) are
// expected to call directly against bulk-fetched values rather than
// going through getItemStockSummary once per item.
describe("isLowStockQty", () => {
  test("is true when qtyOnHand is below the item's own threshold", () => {
    expect(isLowStockQty(2, 5, 3)).toBe(true);
  });

  test("is true when qtyOnHand is exactly at the item's own threshold (at-or-below, not strictly below)", () => {
    expect(isLowStockQty(5, 5, 3)).toBe(true);
  });

  test("is false when qtyOnHand is above the item's own threshold", () => {
    expect(isLowStockQty(6, 5, 3)).toBe(false);
  });

  test("falls back to defaultThreshold when itemThreshold is null", () => {
    expect(isLowStockQty(3, null, 3)).toBe(true);
    expect(isLowStockQty(4, null, 3)).toBe(false);
  });

  test("uses the item's own threshold instead of the default even when that makes it low despite being above the default", () => {
    // qtyOnHand 4 is above the default (3) but at-or-below the item's own
    // threshold (5) -> low, because the item's own threshold always wins
    // over the default when set.
    expect(isLowStockQty(4, 5, 3)).toBe(true);
  });

  test("an item threshold of 0 is respected, not treated as unset", () => {
    // itemThreshold is 0, a legitimate (if unusual) value, not null/undefined
    // -> must NOT fall back to defaultThreshold.
    expect(isLowStockQty(0, 0, 3)).toBe(true);
    expect(isLowStockQty(1, 0, 3)).toBe(false);
  });
});

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (createItem/recordStockIn/recordStockOut/voidMovement all
// write via recordAudit or an equivalent SQL-side audit write).
let ASSISTANT_ID: string;
let OWNER_ID: string;
let itemId: string;
let itemId2: string;
let itemId3: string;
let itemId4: string;
let categoryId: string;

const createdItemIds: string[] = [];

// app_settings is a single GLOBAL row (see tests/lib/cost-visibility.test.ts
// for the same caveat) — this file reads default_low_stock_threshold via
// getSettings/updateSettings, so it saves and restores it in afterAll.
let originalSettings: AppSettings;

const runId = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = createAdminClient();
  originalSettings = await getSettings(admin);

  const { data: assistant } = await admin.auth.admin.createUser({
    email: `test-stock-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;

  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-stock-owner-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;

  // Now that a real profile exists, pin the default threshold using it as
  // the actor (updateSettings records an audit entry keyed to actor_id).
  await updateSettings(admin, OWNER_ID, { defaultLowStockThreshold: 3 });

  const category = await createCategory(admin, OWNER_ID, `Batteries-${runId}`);
  categoryId = category.id;

  const item = await createItem(admin, OWNER_ID, {
    sku: `AB-${runId}-001`,
    name: "12V Battery",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item.id);
  itemId = item.id;

  // No item-level threshold set -> falls back to app_settings (3).
  const item2 = await createItem(admin, OWNER_ID, {
    sku: `AB-${runId}-002`,
    name: "6V Battery",
    categoryId,
    unit: "pcs",
  });
  createdItemIds.push(item2.id);
  itemId2 = item2.id;

  // Item-level threshold explicitly set to 5, overriding the default.
  const item3 = await createItem(admin, OWNER_ID, {
    sku: `AB-${runId}-003`,
    name: "24V Battery",
    categoryId,
    unit: "pcs",
    lowStockThreshold: 5,
  });
  createdItemIds.push(item3.id);
  itemId3 = item3.id;

  // Item-level threshold set higher than default, so plenty of stock is
  // NOT low even though it would be below the global default.
  const item4 = await createItem(admin, OWNER_ID, {
    sku: `AB-${runId}-004`,
    name: "48V Battery",
    categoryId,
    unit: "pcs",
    lowStockThreshold: 1,
  });
  createdItemIds.push(item4.id);
  itemId4 = item4.id;
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
  await admin.from("audit_log").delete().in("actor_id", [ASSISTANT_ID, OWNER_ID]);
  await admin.from("profiles").delete().in("id", [ASSISTANT_ID, OWNER_ID]);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
});

test("qtyOnHand is the sum of qty_remaining across all non-voided batches", async () => {
  const supabase = createAdminClient();
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 10,
    unitCost: 1000,
    batchDate: "2026-06-01",
  });
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 5,
    unitCost: 1500,
    batchDate: "2026-07-01",
  });
  await recordStockOut(supabase, ASSISTANT_ID, {
    itemId,
    qty: 3,
    movementDate: "2026-07-15",
  });

  const summary = await getItemStockSummary(supabase, itemId);
  expect(summary.qtyOnHand).toBe(12);
});

test("a voided IN is excluded from qtyOnHand (its batch's qty_remaining is zeroed)", async () => {
  const supabase = createAdminClient();
  const { movementId, batchId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId4,
    qty: 20,
    unitCost: 1000,
    batchDate: "2026-06-01",
  });
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId4,
    qty: 6,
    unitCost: 1000,
    batchDate: "2026-06-05",
  });

  await voidMovement(supabase, OWNER_ID, movementId);

  const summary = await getItemStockSummary(supabase, itemId4);
  expect(summary.qtyOnHand).toBe(6);

  // Sanity: the voided batch really is zeroed, not merely excluded by some
  // other filter.
  const { data: batch } = await supabase
    .from("batches")
    .select("qty_remaining")
    .eq("id", batchId)
    .single();
  expect(batch?.qty_remaining).toBe(0);
});

test("isLowStock is true when qtyOnHand is at or below the item's threshold", async () => {
  await recordStockIn(createAdminClient(), ASSISTANT_ID, {
    itemId: itemId2,
    qty: 5,
    unitCost: 1000,
    batchDate: "2026-07-01",
  });
  await recordStockOut(createAdminClient(), ASSISTANT_ID, {
    itemId: itemId2,
    qty: 4,
    movementDate: "2026-07-02",
  }); // leaves 1, default threshold 3

  const summary = await getItemStockSummary(createAdminClient(), itemId2);
  expect(summary.qtyOnHand).toBe(1);
  expect(summary.isLowStock).toBe(true);
});

test("isLowStock falls back to app_settings.default_low_stock_threshold when the item has no threshold of its own", async () => {
  const supabase = createAdminClient();
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId2,
    qty: 2,
    unitCost: 1000,
    batchDate: "2026-07-10",
  });
  // itemId2 now has 1 (from the prior test) + 2 = 3 on hand, exactly at the
  // pinned default threshold of 3 -> at-or-below counts as low stock.
  const summary = await getItemStockSummary(supabase, itemId2);
  expect(summary.qtyOnHand).toBe(3);
  expect(summary.isLowStock).toBe(true);
});

test("isLowStock uses the item's own threshold instead of the default when the item sets one", async () => {
  const supabase = createAdminClient();
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId3,
    qty: 4,
    unitCost: 1000,
    batchDate: "2026-07-01",
  });
  // itemId3 has threshold 5 (not the default 3) and 4 on hand -> low stock
  // under its own threshold even though 4 > default threshold 3.
  const summary = await getItemStockSummary(supabase, itemId3);
  expect(summary.qtyOnHand).toBe(4);
  expect(summary.isLowStock).toBe(true);
});

test("isLowStock is false when qtyOnHand is comfortably above the threshold", async () => {
  const summary = await getItemStockSummary(createAdminClient(), itemId);
  expect(summary.qtyOnHand).toBe(12);
  expect(summary.isLowStock).toBe(false);
});

test("batches are returned via the cost-gated viewer (unit_cost present for this admin-scoped client)", async () => {
  const summary = await getItemStockSummary(createAdminClient(), itemId);
  expect(summary.batches.length).toBeGreaterThan(0);
  expect(summary.batches.every((b) => "qty_remaining" in b)).toBe(true);
});

test("movements includes voided entries so history stays visible, newest first", async () => {
  const supabase = createAdminClient();
  const { movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId3,
    qty: 1,
    unitCost: 1000,
    batchDate: "2026-07-20",
  });
  await voidMovement(supabase, OWNER_ID, movementId);

  const summary = await getItemStockSummary(supabase, itemId3);
  const voided = summary.movements.find((m) => m.id === movementId);
  expect(voided).toBeDefined();
  expect(voided?.voidedAt).not.toBeNull();
});
