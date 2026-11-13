import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordStockIn, recordStockOut } from "@/lib/movements";
import { randomUUID } from "node:crypto";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordStockOut writes a row via its own SQL transaction on
// every call).
let ASSISTANT_ID: string;
let itemId: string;
let itemId2: string;
let itemId3: string;
let itemId4: string;

// Tracked and cleaned up in afterAll, in FK order, so the suite is safely
// rerunnable without a manual `supabase db reset`:
// movement_allocations -> stock_movements/batches -> items -> categories ->
// audit_log (by actor_id) -> profiles -> auth.users.
const createdItemIds: string[] = [];
const createdCategoryIds: string[] = [];

// Unique per run so reruns never collide on items.sku/categories.name.
const runId = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = createAdminClient();
  const { data: assistant } = await admin.auth.admin.createUser({
    email: `test-stock-out-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;

  const category = await createCategory(admin, ASSISTANT_ID, `Batteries-${runId}`);
  createdCategoryIds.push(category.id);

  const item = await createItem(admin, ASSISTANT_ID, {
    sku: `AB-${runId}-001`,
    name: "12V Battery",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item.id);
  itemId = item.id;

  const item2 = await createItem(admin, ASSISTANT_ID, {
    sku: `AB-${runId}-002`,
    name: "6V Battery",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item2.id);
  itemId2 = item2.id;

  const item3 = await createItem(admin, ASSISTANT_ID, {
    sku: `AB-${runId}-003`,
    name: "24V Battery",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item3.id);
  itemId3 = item3.id;

  const item4 = await createItem(admin, ASSISTANT_ID, {
    sku: `AB-${runId}-004`,
    name: "48V Battery",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item4.id);
  itemId4 = item4.id;
});

afterAll(async () => {
  const admin = createAdminClient();
  // movement_allocations/stock_movements/batches all reference items, which
  // the DB doesn't cascade-delete — clean up in FK order, scoped by item.
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
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().eq("actor_id", ASSISTANT_ID);
  await admin.from("profiles").delete().eq("id", ASSISTANT_ID);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
});

test("recordStockOut allocates from the oldest batch first", async () => {
  const supabase = createAdminClient();
  const batch1 = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 10,
    unitCost: 1000,
    batchDate: "2026-06-01",
  });
  const batch2 = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 10,
    unitCost: 1500,
    batchDate: "2026-07-01",
  });

  const { movementId } = await recordStockOut(supabase, ASSISTANT_ID, {
    itemId,
    qty: 12,
    movementDate: "2026-07-15",
  });

  const { data: b1 } = await supabase
    .from("batches")
    .select("qty_remaining")
    .eq("id", batch1.batchId)
    .single();
  const { data: b2 } = await supabase
    .from("batches")
    .select("qty_remaining")
    .eq("id", batch2.batchId)
    .single();
  expect(b1?.qty_remaining).toBe(0);
  expect(b2?.qty_remaining).toBe(8);

  // The allocation rows must reflect exactly where the 12 units came from:
  // all 10 of batch1 at its cost, then 2 of batch2 at its (different) cost.
  const { data: allocations } = await supabase
    .from("movement_allocations")
    .select("*")
    .eq("movement_id", movementId)
    .order("unit_cost_at_allocation", { ascending: true });

  expect(allocations).toHaveLength(2);
  expect(allocations?.[0]).toMatchObject({
    batch_id: batch1.batchId,
    qty_allocated: 10,
    unit_cost_at_allocation: 1000,
  });
  expect(allocations?.[1]).toMatchObject({
    batch_id: batch2.batchId,
    qty_allocated: 2,
    unit_cost_at_allocation: 1500,
  });

  const { data: movement } = await supabase
    .from("stock_movements")
    .select("*")
    .eq("id", movementId)
    .single();
  expect(movement?.type).toBe("OUT");
  expect(movement?.quantity).toBe(12);
  expect(movement?.item_id).toBe(itemId);
});

test("recordStockOut writes an audit log entry inside the same transaction", async () => {
  const supabase = createAdminClient();
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId4,
    qty: 6,
    unitCost: 900,
    batchDate: "2026-07-01",
  });

  const { movementId } = await recordStockOut(supabase, ASSISTANT_ID, {
    itemId: itemId4,
    qty: 4,
    movementDate: "2026-07-20",
  });

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", movementId)
    .single();

  expect(log?.action).toBe("movement.created");
  expect(log?.entity_type).toBe("stock_movement");
  expect(log?.summary).toContain("OUT 4x");
});

test("record_stock_out RPC alone (no lib/movements.ts wrapper) writes the audit log entry — the audit write is inside the SQL transaction, not bolted on by application code", async () => {
  const supabase = createAdminClient();
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId4,
    qty: 5,
    unitCost: 700,
    batchDate: "2026-07-25",
  });

  const { data, error } = await supabase
    .rpc("record_stock_out", {
      p_item_id: itemId4,
      p_qty: 2,
      p_movement_date: "2026-07-26",
      p_note: null,
      p_actor_id: ASSISTANT_ID,
    })
    .single();

  expect(error).toBeNull();
  const result = data as { movement_id: string };

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", result.movement_id)
    .single();

  expect(log?.action).toBe("movement.created");
  expect(log?.summary).toContain("OUT 2x");
});

test("recordStockOut rejects when requested quantity exceeds available stock", async () => {
  const supabase = createAdminClient();
  await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId2,
    qty: 3,
    unitCost: 1000,
    batchDate: "2026-07-01",
  });

  await expect(
    recordStockOut(supabase, ASSISTANT_ID, {
      itemId: itemId2,
      qty: 5,
      movementDate: "2026-07-15",
    })
  ).rejects.toThrow(/insufficient stock/i);

  // Rejection must not have partially decremented the batch or left stray
  // rows behind.
  const { data: batch } = await supabase
    .from("batches")
    .select("qty_remaining")
    .eq("item_id", itemId2)
    .single();
  expect(batch?.qty_remaining).toBe(3);

  const { data: movements } = await supabase
    .from("stock_movements")
    .select("id")
    .eq("item_id", itemId2)
    .eq("type", "OUT");
  expect(movements).toHaveLength(0);
});

test("recordStockOut rejects a sale for an item with zero stock", async () => {
  const supabase = createAdminClient();
  const admin = createAdminClient();
  const category = await supabase.from("categories").select("id").limit(1).single();
  const zeroStockItem = await createItem(admin, ASSISTANT_ID, {
    sku: `AB-${runId}-zero`,
    name: "No Stock Battery",
    categoryId: category.data!.id,
    unit: "pcs",
  });
  createdItemIds.push(zeroStockItem.id);

  await expect(
    recordStockOut(supabase, ASSISTANT_ID, {
      itemId: zeroStockItem.id,
      qty: 1,
      movementDate: "2026-07-15",
    })
  ).rejects.toThrow(/insufficient stock/i);
});

test("two concurrent OUT requests against the same 10-unit batch never jointly oversell", async () => {
  const supabase = createAdminClient();
  const batch = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId3,
    qty: 10,
    unitCost: 1000,
    batchDate: "2026-07-01",
  });

  const results = await Promise.allSettled([
    recordStockOut(createAdminClient(), ASSISTANT_ID, {
      itemId: itemId3,
      qty: 7,
      movementDate: "2026-07-15",
    }),
    recordStockOut(createAdminClient(), ASSISTANT_ID, {
      itemId: itemId3,
      qty: 7,
      movementDate: "2026-07-15",
    }),
  ]);

  const succeeded = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");
  expect(succeeded).toHaveLength(1);
  expect(failed).toHaveLength(1);
  expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(
    /insufficient stock/i
  );

  const { data: b } = await supabase
    .from("batches")
    .select("qty_remaining")
    .eq("id", batch.batchId)
    .single();
  expect(b?.qty_remaining).toBe(3);

  // Exactly one OUT movement should exist for this item, for exactly 7
  // units — the loser must not have left a partial/stray movement row.
  const { data: outMovements } = await supabase
    .from("stock_movements")
    .select("*")
    .eq("item_id", itemId3)
    .eq("type", "OUT");
  expect(outMovements).toHaveLength(1);
  expect(outMovements?.[0].quantity).toBe(7);
});

test("an authenticated assistant cannot read movement_allocations at all — unit_cost_at_allocation is locked down the same way batches.unit_cost is", async () => {
  const admin = createAdminClient();

  // Seed a real allocation row carrying a real cost, so this test is
  // proving "the cost is there but unreachable", not "the table happened
  // to be empty".
  const seedItem = await createItem(admin, ASSISTANT_ID, {
    sku: `AB-${runId}-alloc`,
    name: "Allocation Lockdown Battery",
    categoryId: createdCategoryIds[0],
    unit: "pcs",
  });
  createdItemIds.push(seedItem.id);
  await recordStockIn(admin, ASSISTANT_ID, {
    itemId: seedItem.id,
    qty: 5,
    unitCost: 4242,
    batchDate: "2026-07-01",
  });
  const { movementId } = await recordStockOut(admin, ASSISTANT_ID, {
    itemId: seedItem.id,
    qty: 2,
    movementDate: "2026-07-02",
  });

  // The service-role client still sees the cost — this is a grant on
  // anon/authenticated only, not a blanket table lockout.
  const { data: adminRows } = await admin
    .from("movement_allocations")
    .select("unit_cost_at_allocation")
    .eq("movement_id", movementId);
  expect(adminRows?.[0]?.unit_cost_at_allocation).toBe(4242);

  const assistantClient = createClient(
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
  const { error: signInError } = await assistantClient.auth.signInWithPassword({
    email: `test-stock-out-assistant-${runId}@example.com`,
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  // Before supabase/migrations/0011_movement_allocations_lockdown.sql this
  // returned the real 4242 — 0007's `using (true)` SELECT policy was
  // row-level only, and Task 11's cost lockdown only covered `batches`.
  const direct = await assistantClient
    .from("movement_allocations")
    .select("unit_cost_at_allocation")
    .eq("movement_id", movementId);
  expect(direct.error?.code).toBe("42501");
  expect(direct.data).toBeNull();

  const wildcard = await assistantClient.from("movement_allocations").select("*");
  expect(wildcard.error?.code).toBe("42501");
  expect(wildcard.data).toBeNull();
});

test("anon key cannot call record_stock_out via RPC (permission denied, not a business-logic error)", async () => {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await anon.rpc("record_stock_out", {
    p_item_id: itemId,
    p_qty: 1,
    p_movement_date: "2026-07-15",
    p_note: null,
    p_actor_id: ASSISTANT_ID,
  });

  expect(error).not.toBeNull();
  // Postgres permission-denied is SQLSTATE 42501, surfaced by PostgREST
  // as a 401/403-class error — must NOT be a business-logic error (e.g.
  // the 'insufficient stock' exception) an authenticated/admin call would
  // get, which would mean the lockdown failed and anon reached the
  // function body.
  expect(error?.code).toBe("42501");
});
