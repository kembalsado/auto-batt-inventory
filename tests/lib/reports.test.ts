import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createItem } from "@/lib/items";
import { createCategory } from "@/lib/categories";
import { recordStockIn, recordStockOut, voidMovement } from "@/lib/movements";
import { getPurchasesByDate, getStockOutValueByDate } from "@/lib/reports";

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
});
