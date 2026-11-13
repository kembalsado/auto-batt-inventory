import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordStockIn } from "@/lib/movements";
import { randomUUID } from "node:crypto";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (recordStockIn writes a row via recordAudit on every call).
let ASSISTANT_ID: string;
let itemId: string;

// Tracked and cleaned up in afterAll, in FK order, so the suite is safely
// rerunnable without a manual `supabase db reset`:
// stock_movements/batches -> audit_log (by actor_id) -> profiles -> auth.users.
const createdMovementIds: string[] = [];
const createdBatchIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdItemIds: string[] = [];

// Unique per run so reruns never collide on items.sku/categories.name.
const runId = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = createAdminClient();
  const { data: assistant } = await admin.auth.admin.createUser({
    email: `test-stock-in-assistant-${runId}@example.com`,
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
});

afterAll(async () => {
  const admin = createAdminClient();
  await admin.from("stock_movements").delete().in("id", createdMovementIds);
  await admin.from("batches").delete().in("id", createdBatchIds);
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().eq("actor_id", ASSISTANT_ID);
  await admin.from("profiles").delete().eq("id", ASSISTANT_ID);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
});

test("recordStockIn creates a batch with qty_remaining = qty_received", async () => {
  const supabase = createAdminClient();
  const { batchId, movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 10,
    unitCost: 1000,
    batchDate: "2026-11-12",
  });
  createdBatchIds.push(batchId);
  createdMovementIds.push(movementId);

  const { data: batch } = await supabase
    .from("batches")
    .select("*")
    .eq("id", batchId)
    .single();

  expect(batch?.qty_received).toBe(10);
  expect(batch?.qty_remaining).toBe(10);
  expect(batch?.unit_cost).toBe(1000);
  expect(batch?.source).toBe("purchase");
  expect(batch?.item_id).toBe(itemId);
});

test("recordStockIn creates a matching IN movement linked to the new batch", async () => {
  const supabase = createAdminClient();
  const { batchId, movementId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 7,
    unitCost: 800,
    batchDate: "2026-11-13",
  });
  createdBatchIds.push(batchId);
  createdMovementIds.push(movementId);

  const { data: movement } = await supabase
    .from("stock_movements")
    .select("*")
    .eq("id", movementId)
    .single();

  expect(movement?.type).toBe("IN");
  expect(movement?.quantity).toBe(7);
  expect(movement?.batch_id).toBe(batchId);
  expect(movement?.item_id).toBe(itemId);
});

test("recordStockIn writes an audit log entry", async () => {
  const supabase = createAdminClient();
  const { movementId, batchId } = await recordStockIn(supabase, ASSISTANT_ID, {
    itemId,
    qty: 5,
    unitCost: 500,
    batchDate: "2026-11-13",
  });
  createdBatchIds.push(batchId);
  createdMovementIds.push(movementId);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", movementId)
    .single();

  expect(log?.action).toBe("movement.created");
  expect(log?.entity_type).toBe("stock_movement");
});

test("record_stock_in RPC alone (no lib/movements.ts wrapper) writes the audit log entry — the audit write is inside the SQL transaction, not bolted on by application code", async () => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .rpc("record_stock_in", {
      p_item_id: itemId,
      p_qty: 3,
      p_unit_cost: 300,
      p_batch_date: "2026-11-14",
      p_note: null,
      p_actor_id: ASSISTANT_ID,
    })
    .single();

  expect(error).toBeNull();
  const result = data as { batch_id: string; movement_id: string };
  createdBatchIds.push(result.batch_id);
  createdMovementIds.push(result.movement_id);

  const { data: log } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_id", result.movement_id)
    .single();

  expect(log?.action).toBe("movement.created");
  expect(log?.entity_type).toBe("stock_movement");
  expect(log?.summary).toContain("IN 3x");
});

test("anon key cannot call record_stock_in via RPC (permission denied, not a business-logic error)", async () => {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await anon.rpc("record_stock_in", {
    p_item_id: itemId,
    p_qty: 1,
    p_unit_cost: 1,
    p_batch_date: "2026-11-14",
    p_note: null,
    p_actor_id: ASSISTANT_ID,
  });

  expect(error).not.toBeNull();
  // Postgres permission-denied is SQLSTATE 42501, surfaced by PostgREST
  // as a 401/403-class error — must NOT be the 23503 FK-violation (or any
  // other business-logic error) an authenticated/admin call would get.
  expect(error?.code).toBe("42501");
});
