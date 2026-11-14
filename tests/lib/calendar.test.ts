import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createItem } from "@/lib/items";
import { createCategory } from "@/lib/categories";
import { recordStockIn, recordStockOut, voidMovement } from "@/lib/movements";
import { daysInMonth, firstWeekdayOfMonth, getMonthActivity } from "@/lib/calendar";

test("daysInMonth returns the correct count, including a leap February", () => {
  expect(daysInMonth(2026, 11)).toBe(30);
  expect(daysInMonth(2026, 1)).toBe(31);
  expect(daysInMonth(2026, 2)).toBe(28);
  expect(daysInMonth(2028, 2)).toBe(29); // 2028 is a leap year
});

test("firstWeekdayOfMonth returns 0-6 (Sun-Sat) for the 1st of the month", () => {
  // 2026-11-01 is a Sunday.
  expect(firstWeekdayOfMonth(2026, 11)).toBe(0);
  // 2026-12-01 is a Tuesday.
  expect(firstWeekdayOfMonth(2026, 12)).toBe(2);
});

describe("getMonthActivity", () => {
  const supabase = createAdminClient();
  const createdItemIds: string[] = [];
  const createdCategoryIds: string[] = [];
  let OWNER_ID: string;

  beforeAll(async () => {
    const { data: user } = await supabase.auth.admin.createUser({
      email: `test-calendar-owner-${randomUUID()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    OWNER_ID = user!.user!.id;
  });

  afterAll(async () => {
    // FK order matters: movement_allocations references both
    // stock_movements and batches (both non-cascading), so it must go
    // first — deleting stock_movements before it is exactly the mistake
    // Task 17's review caught: the delete fails on the FK violation, and
    // a caller that doesn't check `.error` never finds out, leaving every
    // row downstream (batches, items) orphaned. Checking `.error` here
    // isn't optional cleanup polish; it's what would have caught this
    // same mistake the first time instead of leaking items into the
    // shared test database.
    const { data: batchRows } = await supabase
      .from("batches")
      .select("id")
      .in("item_id", createdItemIds);
    const batchIds = (batchRows ?? []).map((b) => b.id);

    const steps: [string, () => PromiseLike<{ error: unknown }>][] = [
      ["movement_allocations", () =>
        batchIds.length > 0
          ? supabase.from("movement_allocations").delete().in("batch_id", batchIds)
          : Promise.resolve({ error: null })],
      ["stock_movements", () =>
        supabase.from("stock_movements").delete().in("item_id", createdItemIds)],
      ["batches", () => supabase.from("batches").delete().in("item_id", createdItemIds)],
      ["audit_log", () => supabase.from("audit_log").delete().eq("actor_id", OWNER_ID)],
      ["items", () => supabase.from("items").delete().in("id", createdItemIds)],
      ["categories", () => supabase.from("categories").delete().in("id", createdCategoryIds)],
      ["profiles", () => supabase.from("profiles").delete().eq("id", OWNER_ID)],
    ];
    for (const [table, run] of steps) {
      const { error } = await run();
      if (error) {
        throw new Error(`calendar.test.ts cleanup failed deleting ${table}: ${JSON.stringify(error)}`);
      }
    }
    await supabase.auth.admin.deleteUser(OWNER_ID);
  });

  test("sums IN and OUT per day across items, for one bulk month range", async () => {
    const category = await createCategory(supabase, OWNER_ID, `Calendar-${randomUUID()}`);
    createdCategoryIds.push(category.id);

    const itemA = await createItem(supabase, OWNER_ID, {
      sku: `CAL-A-${randomUUID()}`,
      name: "Calendar Item A",
      categoryId: category.id,
      unit: "pcs",
    });
    const itemB = await createItem(supabase, OWNER_ID, {
      sku: `CAL-B-${randomUUID()}`,
      name: "Calendar Item B",
      categoryId: category.id,
      unit: "pcs",
    });
    createdItemIds.push(itemA.id, itemB.id);

    // Same day, two items: 10 + 5 = 15 IN; one OUT of 3.
    await recordStockIn(supabase, OWNER_ID, {
      itemId: itemA.id,
      qty: 10,
      unitCost: 100,
      batchDate: "2026-11-12",
    });
    await recordStockIn(supabase, OWNER_ID, {
      itemId: itemB.id,
      qty: 5,
      unitCost: 50,
      batchDate: "2026-11-12",
    });
    await recordStockOut(supabase, OWNER_ID, {
      itemId: itemA.id,
      qty: 3,
      movementDate: "2026-11-12",
    });
    // A different day in the same month — must not be merged into Nov 12.
    await recordStockIn(supabase, OWNER_ID, {
      itemId: itemA.id,
      qty: 2,
      unitCost: 100,
      batchDate: "2026-11-20",
    });
    // Outside the queried month entirely — must not appear at all.
    await recordStockIn(supabase, OWNER_ID, {
      itemId: itemA.id,
      qty: 99,
      unitCost: 100,
      batchDate: "2026-10-31",
    });

    const days = await getMonthActivity(supabase, 2026, 11);

    const nov12 = days.find((d) => d.date === "2026-11-12");
    expect(nov12).toEqual({ date: "2026-11-12", qtyIn: 15, qtyOut: 3 });

    const nov20 = days.find((d) => d.date === "2026-11-20");
    expect(nov20).toEqual({ date: "2026-11-20", qtyIn: 2, qtyOut: 0 });

    expect(days.find((d) => d.date === "2026-10-31")).toBeUndefined();
  });

  test("a voided movement does not contribute to that day's totals", async () => {
    const category = await createCategory(supabase, OWNER_ID, `Calendar-${randomUUID()}`);
    createdCategoryIds.push(category.id);
    const item = await createItem(supabase, OWNER_ID, {
      sku: `CAL-V-${randomUUID()}`,
      name: "Calendar Voided Item",
      categoryId: category.id,
      unit: "pcs",
    });
    createdItemIds.push(item.id);

    const { movementId } = await recordStockIn(supabase, OWNER_ID, {
      itemId: item.id,
      qty: 7,
      unitCost: 10,
      batchDate: "2026-11-25",
    });
    await voidMovement(supabase, OWNER_ID, movementId);

    const days = await getMonthActivity(supabase, 2026, 11);
    expect(days.find((d) => d.date === "2026-11-25")).toBeUndefined();
  });
});
