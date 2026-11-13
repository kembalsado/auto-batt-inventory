import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordStockIn, recordStockOut, voidMovement } from "@/lib/movements";
import { getSettings, updateSettings, type AppSettings } from "@/lib/settings";
import { buildDailySummary } from "@/lib/email/dailySummary";
import { randomUUID } from "node:crypto";

// This test is deliberately declared first, at the top level of the file
// (outside the describe/beforeAll block below). Combined with
// vitest.config.ts's `fileParallelism: false` (every test file in the suite
// runs to completion, including its own afterAll cleanup, before the next
// file starts) and every other test file in this suite fully deleting what
// it creates (see tests/lib/stock-list.test.ts / tests/lib/stock.test.ts's
// afterAll blocks), the items table is empty at this point in a healthy
// run — the same "clean shared DB" assumption the rest of this suite
// already relies on. What this test really pins down is that
// buildDailySummary doesn't throw when there are zero items and zero
// movements (empty `.in()` arrays, nothing to group, nothing to compare
// against a threshold).
test("buildDailySummary reports hasActivity:false and no low-stock items on an empty day for a fresh system", async () => {
  const admin = createAdminClient();
  const summary = await buildDailySummary(admin, "2026-01-01");

  expect(summary.hasActivity).toBe(false);
  expect(summary.itemsWithActivity).toEqual([]);
  expect(summary.lowStockItems).toEqual([]);
});

const PASSWORD = "test-password-123";

let OWNER_ID: string;
let ASSISTANT_ID: string;
let categoryId: string;
let itemId: string;
let lowStockItemId: string;
let wellStockedItemId: string;
const createdItemIds: string[] = [];

const runId = randomUUID().slice(0, 8);
const skuPrefix = `AB-DS-${runId}`;

// app_settings is a single GLOBAL row (see tests/lib/cost-visibility.test.ts
// for the caveat) — this describe block pins default_low_stock_threshold,
// so it saves and restores the pre-existing value in afterAll.
let originalSettings: AppSettings;

describe("buildDailySummary with fixtures", () => {
  beforeAll(async () => {
    const admin = createAdminClient();
    originalSettings = await getSettings(admin);

    const { data: owner } = await admin.auth.admin.createUser({
      email: `test-daily-summary-owner-${runId}@example.com`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    OWNER_ID = owner!.user!.id;

    const { data: assistant } = await admin.auth.admin.createUser({
      email: `test-daily-summary-assistant-${runId}@example.com`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "assistant" },
    });
    ASSISTANT_ID = assistant!.user!.id;

    await updateSettings(admin, OWNER_ID, { defaultLowStockThreshold: 3 });

    const category = await createCategory(admin, OWNER_ID, `Batteries-DS-${runId}`);
    categoryId = category.id;

    // Plain item used for the IN/OUT grouping test — given plenty of stock
    // so it never incidentally counts as low stock too.
    const item = await createItem(admin, OWNER_ID, {
      sku: `${skuPrefix}-001`,
      name: "12V Battery",
      categoryId,
      unit: "pcs",
    });
    itemId = item.id;
    createdItemIds.push(itemId);
    await recordStockIn(admin, ASSISTANT_ID, {
      itemId,
      qty: 50,
      unitCost: 1000,
      batchDate: "2026-01-01",
    });

    // Item with no item-level threshold, left with 1 on hand (<= the
    // pinned default of 3) -> exercises the default-threshold fallback
    // path of isLowStockQty.
    const lowStockItem = await createItem(admin, OWNER_ID, {
      sku: `${skuPrefix}-002`,
      name: "6V Battery",
      categoryId,
      unit: "pcs",
    });
    lowStockItemId = lowStockItem.id;
    createdItemIds.push(lowStockItemId);
    await recordStockIn(admin, ASSISTANT_ID, {
      itemId: lowStockItemId,
      qty: 5,
      unitCost: 500,
      batchDate: "2026-02-01",
    });
    await recordStockOut(admin, ASSISTANT_ID, {
      itemId: lowStockItemId,
      qty: 4,
      movementDate: "2026-02-10",
    }); // leaves 1 on hand

    // Item with an item-level threshold (10) comfortably above its own
    // qty on hand (20), so it must NOT show up as low stock even though a
    // naive "below the global default" check might be tempted to use 3.
    const wellStockedItem = await createItem(admin, OWNER_ID, {
      sku: `${skuPrefix}-003`,
      name: "24V Battery",
      categoryId,
      unit: "pcs",
      lowStockThreshold: 10,
    });
    wellStockedItemId = wellStockedItem.id;
    createdItemIds.push(wellStockedItemId);
    await recordStockIn(admin, ASSISTANT_ID, {
      itemId: wellStockedItemId,
      qty: 20,
      unitCost: 300,
      batchDate: "2026-01-05",
    });
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

  test("buildDailySummary groups IN/OUT quantities per item for the given date", async () => {
    const admin = createAdminClient();
    await recordStockIn(admin, ASSISTANT_ID, {
      itemId,
      qty: 10,
      unitCost: 1000,
      batchDate: "2026-11-12",
    });
    await recordStockOut(admin, ASSISTANT_ID, {
      itemId,
      qty: 2,
      movementDate: "2026-11-12",
    });

    const summary = await buildDailySummary(admin, "2026-11-12");

    expect(summary.itemsWithActivity).toContainEqual(
      expect.objectContaining({ itemId, qtyIn: 10, qtyOut: 2 })
    );
    expect(summary.hasActivity).toBe(true);
  });

  test("movements on a different date are not included in the day's totals", async () => {
    const admin = createAdminClient();
    await recordStockIn(admin, ASSISTANT_ID, {
      itemId,
      qty: 7,
      unitCost: 1000,
      batchDate: "2026-11-13",
    });

    const summary = await buildDailySummary(admin, "2026-11-12");

    const entry = summary.itemsWithActivity.find((i) => i.itemId === itemId);
    // Only the 10 IN / 2 OUT from the previous test's 2026-11-12 activity,
    // not this test's 2026-11-13 IN.
    expect(entry).toEqual(expect.objectContaining({ qtyIn: 10, qtyOut: 2 }));
  });

  test("a voided movement is excluded from the day's activity totals", async () => {
    const admin = createAdminClient();
    const { movementId } = await recordStockIn(admin, ASSISTANT_ID, {
      itemId: wellStockedItemId,
      qty: 99,
      unitCost: 1000,
      batchDate: "2026-11-14",
    });
    await voidMovement(admin, OWNER_ID, movementId);

    const summary = await buildDailySummary(admin, "2026-11-14");

    const entry = summary.itemsWithActivity.find((i) => i.itemId === wellStockedItemId);
    expect(entry).toBeUndefined();
  });

  test("lowStockItems includes an item at or below its threshold (default-threshold fallback)", async () => {
    const admin = createAdminClient();
    const summary = await buildDailySummary(admin, "2026-03-01");

    expect(summary.lowStockItems).toContainEqual(
      expect.objectContaining({ itemId: lowStockItemId, qtyOnHand: 1, threshold: 3 })
    );
  });

  test("lowStockItems excludes an item comfortably above its own item-level threshold", async () => {
    const admin = createAdminClient();
    const summary = await buildDailySummary(admin, "2026-03-01");

    const entry = summary.lowStockItems.find((i) => i.itemId === wellStockedItemId);
    expect(entry).toBeUndefined();
  });

  test("hasActivity is true when there is a low-stock item even on a day with no movements at all", async () => {
    const admin = createAdminClient();
    const summary = await buildDailySummary(admin, "2099-12-31");

    expect(summary.itemsWithActivity).toEqual([]);
    expect(summary.lowStockItems.some((i) => i.itemId === lowStockItemId)).toBe(true);
    expect(summary.hasActivity).toBe(true);
  });
});
