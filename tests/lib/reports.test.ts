import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createItem } from "@/lib/items";
import { createCategory } from "@/lib/categories";
import { recordStockIn, recordStockOut, voidMovement } from "@/lib/movements";
import {
  getPurchasesByDate,
  getStockOutValueByDate,
  getDailyReport,
  getMonthlyReport,
  getAnnualReport,
  getItemActivityByDate,
} from "@/lib/reports";

// Plain anon-key client used to sign in as a real user and exercise RLS /
// batches_for_viewer's auth.uid()-based cost gate, as opposed to `admin`
// below (service-role, bypasses RLS and has no auth.uid() at all). See
// tests/lib/cost-visibility.test.ts for the original pattern this copies.
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

describe("getPurchasesByDate / getStockOutValueByDate", () => {
  // `admin` seeds data and is the required `adminSupabase` argument to
  // getStockOutValueByDate (the only function allowed to read
  // movement_allocations). `ownerClient` is a real signed-in owner
  // session — the required `supabase` argument to getPurchasesByDate.
  //
  // getPurchasesByDate must NOT be called with `admin`: batches_for_viewer's
  // cost gate resolves against auth.uid(), which is null for the
  // service-role client, so it would silently return unit_cost: null for
  // every batch regardless of role. Signing in as an owner sidesteps any
  // dependency on app_settings.show_cost_to_assistant entirely (an owner
  // sees cost unconditionally).
  const admin = createAdminClient();
  let ownerClient: ReturnType<typeof createAnonClient>;

  const createdItemIds: string[] = [];
  const createdCategoryIds: string[] = [];
  let OWNER_ID: string;
  let OWNER_EMAIL: string;
  let itemId: string;

  beforeAll(async () => {
    const runId = randomUUID().slice(0, 8);
    OWNER_EMAIL = `test-reports-owner-${runId}@example.com`;

    const { data: user } = await admin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    OWNER_ID = user!.user!.id;

    ownerClient = createAnonClient();
    const { error: signInError } = await ownerClient.auth.signInWithPassword({
      email: OWNER_EMAIL,
      password: PASSWORD,
    });
    if (signInError) {
      throw signInError;
    }

    const category = await createCategory(admin, OWNER_ID, `Reports-${runId}`);
    createdCategoryIds.push(category.id);

    const item = await createItem(admin, OWNER_ID, {
      sku: `RPT-${runId}-001`,
      name: "Reports Test Item",
      categoryId: category.id,
      unit: "pcs",
    });
    itemId = item.id;
    createdItemIds.push(itemId);
  });

  afterAll(async () => {
    // FK order matters: movement_allocations references both
    // stock_movements and batches (both non-cascading), so it must go
    // first — see tests/lib/calendar.test.ts's cleanup for the same
    // reasoning.
    const { data: batchRows } = await admin
      .from("batches")
      .select("id")
      .in("item_id", createdItemIds);
    const batchIds = (batchRows ?? []).map((b) => b.id);

    const steps: [string, () => PromiseLike<{ error: unknown }>][] = [
      ["movement_allocations", () =>
        batchIds.length > 0
          ? admin.from("movement_allocations").delete().in("batch_id", batchIds)
          : Promise.resolve({ error: null })],
      ["stock_movements", () =>
        admin.from("stock_movements").delete().in("item_id", createdItemIds)],
      ["batches", () => admin.from("batches").delete().in("item_id", createdItemIds)],
      ["audit_log", () => admin.from("audit_log").delete().eq("actor_id", OWNER_ID)],
      ["items", () => admin.from("items").delete().in("id", createdItemIds)],
      ["categories", () => admin.from("categories").delete().in("id", createdCategoryIds)],
      ["profiles", () => admin.from("profiles").delete().eq("id", OWNER_ID)],
    ];
    for (const [table, run] of steps) {
      const { error } = await run();
      if (error) {
        throw new Error(`reports.test.ts cleanup failed deleting ${table}: ${JSON.stringify(error)}`);
      }
    }
    await admin.auth.admin.deleteUser(OWNER_ID);
  });

  describe("getPurchasesByDate", () => {
    test("sums real-purchase cost per day, across items, for one bulk range", async () => {
      const runId = randomUUID().slice(0, 8);
      const category = await createCategory(admin, OWNER_ID, `Reports-B-${runId}`);
      createdCategoryIds.push(category.id);
      const itemB = await createItem(admin, OWNER_ID, {
        sku: `RPT-B-${runId}`,
        name: "Reports Test Item B",
        categoryId: category.id,
        unit: "pcs",
      });
      createdItemIds.push(itemB.id);

      await recordStockIn(admin, OWNER_ID, {
        itemId,
        qty: 10,
        unitCost: 100,
        batchDate: "2026-11-12",
      });
      await recordStockIn(admin, OWNER_ID, {
        itemId: itemB.id,
        qty: 5,
        unitCost: 50,
        batchDate: "2026-11-12",
      });
      // A different day — must not merge into Nov 12.
      await recordStockIn(admin, OWNER_ID, {
        itemId,
        qty: 2,
        unitCost: 100,
        batchDate: "2026-11-20",
      });
      // Outside the queried range entirely — must not appear.
      await recordStockIn(admin, OWNER_ID, {
        itemId,
        qty: 1,
        unitCost: 100,
        batchDate: "2026-10-31",
      });

      const result = await getPurchasesByDate(ownerClient, "2026-11-01", "2026-11-30");
      expect(result.get("2026-11-12")).toBe(1250); // 10*100 + 5*50
      expect(result.get("2026-11-20")).toBe(200);
      expect(result.has("2026-10-31")).toBe(false);
    });

    test("excludes opening-stock imports from Purchases", async () => {
      const openingStockDate = "2026-11-15";

      const { data: batch, error: batchError } = await admin
        .from("batches")
        .insert({
          item_id: itemId,
          batch_date: openingStockDate,
          qty_received: 3,
          qty_remaining: 3,
          unit_cost: 77,
          source: "opening_stock",
          created_by: OWNER_ID,
        })
        .select("id")
        .single();
      if (batchError) {
        throw batchError;
      }

      const { error: movementError } = await admin.from("stock_movements").insert({
        item_id: itemId,
        type: "IN",
        quantity: 3,
        batch_id: batch.id,
        movement_date: openingStockDate,
        created_by: OWNER_ID,
      });
      if (movementError) {
        throw movementError;
      }

      const result = await getPurchasesByDate(ownerClient, "2026-11-01", "2026-11-30");
      expect(result.has(openingStockDate)).toBe(false);
    });

    test("a voided IN movement contributes nothing", async () => {
      const { movementId } = await recordStockIn(admin, OWNER_ID, {
        itemId,
        qty: 7,
        unitCost: 10,
        batchDate: "2026-11-25",
      });
      await voidMovement(admin, OWNER_ID, movementId);

      const result = await getPurchasesByDate(ownerClient, "2026-11-01", "2026-11-30");
      expect(result.has("2026-11-25")).toBe(false);
    });

    test(
      "chunks/pages the batches_for_viewer lookup so more than one chunk's worth of batches still sums correctly (Finding 1 regression)",
      async () => {
        // Forces getPurchasesByDate's batches_for_viewer lookup through
        // more than one internal chunk (lib/reports.ts's CHUNK_SIZE = 150):
        // 170 distinct batches on the same item/date means 170 distinct
        // batch_ids collected from the movements step, split into two
        // `.in(...)` chunks (150 + 20) by `fetchAllForIds`. This doesn't
        // reach PostgREST's real HTTP-414 threshold (~216 ids) or its
        // 1000-row cap — it doesn't need to — it proves the chunking/
        // paging loop itself correctly merges every chunk's rows instead
        // of silently dropping any of them, which is the actual
        // regression Finding 1 of the branch-wide review called out.
        const runId = randomUUID().slice(0, 8);
        const category = await createCategory(admin, OWNER_ID, `Reports-Chunk-${runId}`);
        createdCategoryIds.push(category.id);
        const chunkItem = await createItem(admin, OWNER_ID, {
          sku: `RPT-CHUNK-${runId}`,
          name: "Reports Chunking Test Item",
          categoryId: category.id,
          unit: "pcs",
        });
        createdItemIds.push(chunkItem.id);

        const BATCH_COUNT = 170;
        const batchDate = "2026-08-15";
        for (let i = 0; i < BATCH_COUNT; i++) {
          await recordStockIn(admin, OWNER_ID, {
            itemId: chunkItem.id,
            qty: 1,
            unitCost: 1,
            batchDate,
          });
        }

        const result = await getPurchasesByDate(ownerClient, "2026-08-01", "2026-08-31");
        // Each batch contributes 1*1 = 1; a dropped chunk (e.g. only the
        // first 150) would under-report this total rather than error, the
        // same silent-truncation shape as the real bug.
        expect(result.get(batchDate)).toBe(BATCH_COUNT);
      },
      60000
    );
  });

  describe("getStockOutValueByDate", () => {
    test("sums FIFO allocation cost per day, across items, for one bulk range", async () => {
      await recordStockIn(admin, OWNER_ID, {
        itemId,
        qty: 10,
        unitCost: 100,
        batchDate: "2026-11-01",
      });
      await recordStockOut(admin, OWNER_ID, {
        itemId,
        qty: 4,
        movementDate: "2026-11-05",
      });

      const result = await getStockOutValueByDate(admin, "2026-11-01", "2026-11-30");
      expect(result.get("2026-11-05")).toBe(400); // 4 * 100
    });

    test("a voided OUT movement contributes nothing, even though its movement_allocations rows still exist", async () => {
      const { movementId } = await recordStockOut(admin, OWNER_ID, {
        itemId,
        qty: 4,
        movementDate: "2026-11-06",
      });
      await voidMovement(admin, OWNER_ID, movementId);

      const result = await getStockOutValueByDate(admin, "2026-11-01", "2026-11-30");
      expect(result.has("2026-11-06")).toBe(false);
    });
  });

  test("an empty range returns an empty map, not an error", async () => {
    const purchases = await getPurchasesByDate(ownerClient, "2099-01-01", "2099-01-31");
    const stockOut = await getStockOutValueByDate(admin, "2099-01-01", "2099-01-31");
    expect(purchases.size).toBe(0);
    expect(stockOut.size).toBe(0);
  });

  describe("getItemActivityByDate", () => {
    test("reports qty and cost per item, separating IN and OUT on the same date", async () => {
      const runId = randomUUID().slice(0, 8);
      const category = await createCategory(admin, OWNER_ID, `ItemActivity-${runId}`);
      createdCategoryIds.push(category.id);
      const item = await createItem(admin, OWNER_ID, {
        sku: `IA-${runId}`,
        name: "Item Activity Test Item",
        categoryId: category.id,
        unit: "pcs",
      });
      createdItemIds.push(item.id);

      await recordStockIn(admin, OWNER_ID, {
        itemId: item.id,
        qty: 10,
        unitCost: 100,
        batchDate: "2026-11-20",
      });
      await recordStockOut(admin, OWNER_ID, {
        itemId: item.id,
        qty: 3,
        movementDate: "2026-11-20",
      });

      const result = await getItemActivityByDate(ownerClient, admin, "2026-11-20");
      const row = result.find((r) => r.itemId === item.id)!;
      expect(row.qtyIn).toBe(10);
      expect(row.costIn).toBe(1000);
      expect(row.qtyOut).toBe(3);
      expect(row.costOut).toBe(300); // FIFO: 3 * 100
      expect(row.name).toBe("Item Activity Test Item");
      expect(row.sku).toBe(`IA-${runId}`);
    });

    test("a day with no qualifying movement returns an empty array", async () => {
      const result = await getItemActivityByDate(ownerClient, admin, "2020-01-01");
      expect(result).toEqual([]);
    });

    test("a voided movement contributes nothing", async () => {
      const { movementId } = await recordStockIn(admin, OWNER_ID, {
        itemId,
        qty: 7,
        unitCost: 10,
        batchDate: "2026-11-21",
      });
      await voidMovement(admin, OWNER_ID, movementId);

      const result = await getItemActivityByDate(ownerClient, admin, "2026-11-21");
      expect(result.find((r) => r.itemId === itemId)).toBeUndefined();
    });

    test("an opening-stock import shows qty with zero cost, not excluded", async () => {
      const openingStockDate = "2026-11-22";
      const { data: batch, error: batchError } = await admin
        .from("batches")
        .insert({
          item_id: itemId,
          batch_date: openingStockDate,
          qty_received: 5,
          qty_remaining: 5,
          unit_cost: 77,
          source: "opening_stock",
          created_by: OWNER_ID,
        })
        .select("id")
        .single();
      if (batchError) throw batchError;

      const { error: movementError } = await admin.from("stock_movements").insert({
        item_id: itemId,
        type: "IN",
        quantity: 5,
        batch_id: batch.id,
        movement_date: openingStockDate,
        created_by: OWNER_ID,
      });
      if (movementError) throw movementError;

      const result = await getItemActivityByDate(ownerClient, admin, openingStockDate);
      const row = result.find((r) => r.itemId === itemId)!;
      expect(row.qtyIn).toBe(5);
      expect(row.costIn).toBe(0);
    });

    test("a deactivated item that moved stock still appears", async () => {
      const runId = randomUUID().slice(0, 8);
      const category = await createCategory(admin, OWNER_ID, `ItemActivity-Deact-${runId}`);
      createdCategoryIds.push(category.id);
      const item = await createItem(admin, OWNER_ID, {
        sku: `IA-DEACT-${runId}`,
        name: "Deactivated Item",
        categoryId: category.id,
        unit: "pcs",
      });
      createdItemIds.push(item.id);

      await recordStockIn(admin, OWNER_ID, {
        itemId: item.id,
        qty: 2,
        unitCost: 50,
        batchDate: "2026-11-23",
      });
      await admin.from("items").update({ is_active: false }).eq("id", item.id);

      const result = await getItemActivityByDate(ownerClient, admin, "2026-11-23");
      const row = result.find((r) => r.itemId === item.id)!;
      expect(row.qtyIn).toBe(2);
      expect(row.costIn).toBe(100);
    });

    test(
      "per-item cost sums equal getPurchasesByDate/getStockOutValueByDate's totals for the same date (Finding 1 regression)",
      async () => {
        // Locks in the sum-equality invariant the Finding-1 paging fix
        // protects: getItemActivityByDate's per-item costIn/costOut must
        // always roll up to the exact same single-day totals
        // getPurchasesByDate/getStockOutValueByDate compute independently,
        // across two or more items on one date, each with both an IN and
        // an OUT movement.
        const runId = randomUUID().slice(0, 8);
        const date = "2026-11-24";

        const categoryA = await createCategory(admin, OWNER_ID, `ItemActivity-SumA-${runId}`);
        createdCategoryIds.push(categoryA.id);
        const itemA = await createItem(admin, OWNER_ID, {
          sku: `IA-SUM-A-${runId}`,
          name: "Item Activity Sum Test A",
          categoryId: categoryA.id,
          unit: "pcs",
        });
        createdItemIds.push(itemA.id);

        const categoryB = await createCategory(admin, OWNER_ID, `ItemActivity-SumB-${runId}`);
        createdCategoryIds.push(categoryB.id);
        const itemB = await createItem(admin, OWNER_ID, {
          sku: `IA-SUM-B-${runId}`,
          name: "Item Activity Sum Test B",
          categoryId: categoryB.id,
          unit: "pcs",
        });
        createdItemIds.push(itemB.id);

        await recordStockIn(admin, OWNER_ID, {
          itemId: itemA.id,
          qty: 6,
          unitCost: 50,
          batchDate: date,
        });
        await recordStockIn(admin, OWNER_ID, {
          itemId: itemB.id,
          qty: 4,
          unitCost: 25,
          batchDate: date,
        });
        await recordStockOut(admin, OWNER_ID, {
          itemId: itemA.id,
          qty: 2,
          movementDate: date,
        });
        await recordStockOut(admin, OWNER_ID, {
          itemId: itemB.id,
          qty: 1,
          movementDate: date,
        });

        const [itemActivity, purchasesByDate, stockOutByDate] = await Promise.all([
          getItemActivityByDate(ownerClient, admin, date),
          getPurchasesByDate(ownerClient, date, date),
          getStockOutValueByDate(admin, date, date),
        ]);

        const costInSum = itemActivity.reduce((sum, r) => sum + r.costIn, 0);
        const costOutSum = itemActivity.reduce((sum, r) => sum + r.costOut, 0);

        expect(costInSum).toBeGreaterThan(0);
        expect(costOutSum).toBeGreaterThan(0);
        expect(costInSum).toBe(purchasesByDate.get(date) ?? 0);
        expect(costOutSum).toBe(stockOutByDate.get(date) ?? 0);
      }
    );
  });

  describe("getDailyReport / getMonthlyReport / getAnnualReport", () => {
    // Each test below uses a dedicated item on dates no other test in this
    // file (or Task 2's queries, which scan stock_movements/
    // movement_allocations globally, not per-owner) touches — 2026-06,
    // 2026-07, and 2027 are otherwise untouched by the fixtures above
    // (which live in 2026-10 and 2026-11), so FIFO allocation and date
    // bucketing can't pick up stray data from earlier tests in this file.
    async function makeCompositionItem(label: string) {
      const runId = randomUUID().slice(0, 8);
      const category = await createCategory(admin, OWNER_ID, `Reports-${label}-${runId}`);
      createdCategoryIds.push(category.id);
      const item = await createItem(admin, OWNER_ID, {
        sku: `RPT-${label}-${runId}`,
        name: `Reports Composition Item ${label}`,
        categoryId: category.id,
        unit: "pcs",
      });
      createdItemIds.push(item.id);
      return item.id;
    }

    test("getDailyReport returns one date's totals", async () => {
      const compositionItemId = await makeCompositionItem("daily");
      await recordStockIn(admin, OWNER_ID, {
        itemId: compositionItemId,
        qty: 10,
        unitCost: 100,
        batchDate: "2026-06-10",
      });
      await recordStockOut(admin, OWNER_ID, {
        itemId: compositionItemId,
        qty: 4,
        movementDate: "2026-06-10",
      });

      const report = await getDailyReport(ownerClient, admin, "2026-06-10");
      expect(report).toEqual({ date: "2026-06-10", purchases: 1000, stockOutValue: 400 });
    });

    test("getMonthlyReport rolls up every day of the month, zero-filled", async () => {
      const compositionItemId = await makeCompositionItem("monthly");
      await recordStockIn(admin, OWNER_ID, {
        itemId: compositionItemId,
        qty: 10,
        unitCost: 100,
        batchDate: "2026-07-12",
      });

      const report = await getMonthlyReport(ownerClient, admin, 2026, 7);
      expect(report.days).toHaveLength(31);
      expect(report.days.find((d) => d.date === "2026-07-01")).toEqual({
        date: "2026-07-01",
        purchases: 0,
        stockOutValue: 0,
      });
      expect(report.days.find((d) => d.date === "2026-07-12")).toEqual({
        date: "2026-07-12",
        purchases: 1000,
        stockOutValue: 0,
      });
      expect(report.purchases).toBe(1000);
      expect(report.stockOutValue).toBe(0);
    });

    test("getAnnualReport buckets the year's first and last day into the right months, and nothing outside 12 entries", async () => {
      const compositionItemId = await makeCompositionItem("annual");
      await recordStockIn(admin, OWNER_ID, {
        itemId: compositionItemId,
        qty: 1,
        unitCost: 10,
        batchDate: "2027-01-01",
      });
      await recordStockIn(admin, OWNER_ID, {
        itemId: compositionItemId,
        qty: 2,
        unitCost: 20,
        batchDate: "2027-12-31",
      });

      const report = await getAnnualReport(ownerClient, admin, 2027);
      expect(report.months).toHaveLength(12);
      expect(report.months[0]).toMatchObject({ month: 1, purchases: 10 });
      expect(report.months[11]).toMatchObject({ month: 12, purchases: 40 });
      expect(report.purchases).toBe(50);
    });

    test("getMonthlyReport handles a leap-year February with 29 days", async () => {
      const report = await getMonthlyReport(ownerClient, admin, 2028, 2);
      expect(report.days).toHaveLength(29);
      expect(report.days[0].date).toBe("2028-02-01");
      expect(report.days[28].date).toBe("2028-02-29");
    });

    test("an empty period returns real zeros, not undefined or an error", async () => {
      const report = await getMonthlyReport(ownerClient, admin, 2099, 1);
      expect(report.purchases).toBe(0);
      expect(report.stockOutValue).toBe(0);
      expect(report.days.every((d) => d.purchases === 0 && d.stockOutValue === 0)).toBe(true);
    });
  });
});
