import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import {
  recordStockIn,
  recordStockOut,
  voidMovement,
  AlreadyVoidedError,
  BatchAlreadySoldError,
} from "@/lib/movements";
import { randomUUID } from "node:crypto";

// A real profile row is required for both actors: audit_log.actor_id has a
// FK to profiles(id), and voidMovement's own audit write (inside the SQL
// transaction) uses whichever actor id is passed to it. ASSISTANT_ID
// records the original movements; OWNER_ID performs the voids, mirroring
// how voiding is expected to be an owner-only correction in real use.
let ASSISTANT_ID: string;
let OWNER_ID: string;
let itemId: string;
let itemId2: string;
let itemId3: string;
let itemId4: string;
let itemId5: string;

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
    email: `test-void-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;

  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-void-owner-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;

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

  const item5 = await createItem(admin, ASSISTANT_ID, {
    sku: `AB-${runId}-005`,
    name: "9V Battery",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item5.id);
  itemId5 = item5.id;
});

afterAll(async () => {
  const admin = createAdminClient();
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
  await admin.from("audit_log").delete().in("actor_id", [ASSISTANT_ID, OWNER_ID]);
  await admin.from("profiles").delete().in("id", [ASSISTANT_ID, OWNER_ID]);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
});

test("voiding an untouched IN zeroes out the batch", async () => {
  const supabase = createAdminClient();
  const { movementId, batchId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 10,
    unitCost: 1000,
    batchDate: "2026-07-01",
  });

  await voidMovement(supabase, OWNER_ID, movementId);

  const { data: batch } = await supabase
    .from("batches")
    .select("qty_remaining")
    .eq("id", batchId)
    .single();
  expect(batch?.qty_remaining).toBe(0);

  const { data: movement } = await supabase
    .from("stock_movements")
    .select("voided_at, voided_by")
    .eq("id", movementId)
    .single();
  expect(movement?.voided_at).not.toBeNull();
  expect(movement?.voided_by).toBe(OWNER_ID);
});

test("voiding an IN that has already been partially sold is rejected", async () => {
  const supabase = createAdminClient();
  const { movementId, batchId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId2,
    qty: 10,
    unitCost: 1000,
    batchDate: "2026-07-01",
  });
  await recordStockOut(supabase, ASSISTANT_ID, {
    itemId: itemId2,
    qty: 2,
    movementDate: "2026-07-02",
  });

  await expect(voidMovement(supabase, OWNER_ID, movementId)).rejects.toThrow(
    /already been sold/i
  );
  await expect(voidMovement(supabase, OWNER_ID, movementId)).rejects.toBeInstanceOf(
    BatchAlreadySoldError
  );

  // Rejection must not have changed anything: the batch keeps its partially
  // sold qty_remaining and the movement stays un-voided.
  const { data: batch } = await supabase
    .from("batches")
    .select("qty_remaining")
    .eq("id", batchId)
    .single();
  expect(batch?.qty_remaining).toBe(8);

  const { data: movement } = await supabase
    .from("stock_movements")
    .select("voided_at")
    .eq("id", movementId)
    .single();
  expect(movement?.voided_at).toBeNull();
});

test("voiding an OUT restores quantity across every batch it drew from", async () => {
  const supabase = createAdminClient();
  const batch1 = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId3,
    qty: 5,
    unitCost: 1000,
    batchDate: "2026-06-01",
  });
  const batch2 = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId3,
    qty: 5,
    unitCost: 1500,
    batchDate: "2026-07-01",
  });
  const { movementId } = await recordStockOut(supabase, ASSISTANT_ID, {
    itemId: itemId3,
    qty: 7,
    movementDate: "2026-07-15",
  });

  await voidMovement(supabase, OWNER_ID, movementId);

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
  expect(b1?.qty_remaining).toBe(5);
  expect(b2?.qty_remaining).toBe(5);

  const { data: movement } = await supabase
    .from("stock_movements")
    .select("voided_at, voided_by")
    .eq("id", movementId)
    .single();
  expect(movement?.voided_at).not.toBeNull();
  expect(movement?.voided_by).toBe(OWNER_ID);
});

test("voiding an already-voided movement is rejected", async () => {
  const supabase = createAdminClient();
  const { movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId4,
    qty: 4,
    unitCost: 1000,
    batchDate: "2026-07-01",
  });

  await voidMovement(supabase, OWNER_ID, movementId);

  await expect(voidMovement(supabase, OWNER_ID, movementId)).rejects.toThrow(
    /already voided/i
  );
  await expect(voidMovement(supabase, OWNER_ID, movementId)).rejects.toBeInstanceOf(
    AlreadyVoidedError
  );
});

test("voidMovement writes an audit log entry inside the same transaction", async () => {
  const supabase = createAdminClient();
  const { movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId5,
    qty: 6,
    unitCost: 900,
    batchDate: "2026-07-01",
  });

  await voidMovement(supabase, OWNER_ID, movementId);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", movementId)
    .eq("action", "movement.voided")
    .single();

  expect(log?.action).toBe("movement.voided");
  expect(log?.entity_type).toBe("stock_movement");
  expect(log?.actor_id).toBe(OWNER_ID);
});

test("void_movement RPC alone (no lib/movements.ts wrapper) writes the audit log entry", async () => {
  const supabase = createAdminClient();
  const { movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId5,
    qty: 2,
    unitCost: 500,
    batchDate: "2026-07-05",
  });

  const { error } = await supabase.rpc("void_movement", {
    p_movement_id: movementId,
    p_actor_id: OWNER_ID,
  });
  expect(error).toBeNull();

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", movementId)
    .eq("action", "movement.voided")
    .single();

  expect(log?.action).toBe("movement.voided");
});

test("two concurrent void requests for the same movement never both succeed", async () => {
  const supabase = createAdminClient();
  const { movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId: itemId5,
    qty: 3,
    unitCost: 800,
    batchDate: "2026-07-10",
  });

  const results = await Promise.allSettled([
    voidMovement(createAdminClient(), OWNER_ID, movementId),
    voidMovement(createAdminClient(), OWNER_ID, movementId),
  ]);

  const succeeded = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");
  expect(succeeded).toHaveLength(1);
  expect(failed).toHaveLength(1);
  expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(/already voided/i);

  const { data: movement } = await supabase
    .from("stock_movements")
    .select("voided_at")
    .eq("id", movementId)
    .single();
  expect(movement?.voided_at).not.toBeNull();
});

test("anon key cannot call void_movement via RPC (permission denied, not a business-logic error)", async () => {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await anon.rpc("void_movement", {
    p_movement_id: randomUUID(),
    p_actor_id: OWNER_ID,
  });

  expect(error).not.toBeNull();
  // Postgres permission-denied is SQLSTATE 42501, surfaced by PostgREST —
  // must NOT be a business-logic error (e.g. "movement not found"), which
  // would mean the lockdown failed and anon reached the function body.
  expect(error?.code).toBe("42501");
});
