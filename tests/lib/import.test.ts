import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  importOpeningStock,
  importOpeningStockAsOwner,
  ForbiddenError,
} from "@/lib/import";
import { randomUUID } from "node:crypto";

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id), and createItem/recordAudit both write via it.
let OWNER_ID: string;
let ASSISTANT_ID: string;

// Every item, category, batch, movement, and audit_log row created by this
// file's tests is tracked here and deleted in afterAll, so the suite is
// safely rerunnable without a manual `supabase db reset` (items.sku is
// unique, so a leftover row would otherwise fail the next run).
const createdItemIds: string[] = [];
const createdCategoryNames = new Set<string>();

// Unique per run so reruns never collide on items.sku/categories.name.
const runId = randomUUID().slice(0, 8);

const PASSWORD = "test-password-123";
const OWNER_EMAIL = `test-import-owner-${runId}@example.com`;

/**
 * A plain anon-key client signed in as a REAL user, the way the import
 * Server Action's own `createServerClient()` session behaves — subject to
 * RLS and to column grants.
 *
 * Every test in this file originally used `createAdminClient()` (service
 * role), which bypasses both. That is precisely why C2 went undetected:
 * `lib/import.ts`'s batches insert did a bare `.select()` (= `select=*`),
 * which names `unit_cost` — a column
 * 0010_batches_cost_column_lockdown.sql revoked from `authenticated` — so
 * the insert failed with "permission denied for table batches" for every
 * real user while passing for the service role. Same pattern as
 * tests/lib/cost-visibility.test.ts.
 */
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

async function signedInOwnerClient(): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

async function trackItemBySku(sku: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("items").select("id").eq("sku", sku).single();
  if (data) createdItemIds.push(data.id);
}

/**
 * Wraps `admin` so every `audit_log` insert whose payload matches
 * `failWhen` resolves with a simulated error instead of actually
 * inserting — used to force the "audit insert fails after the batch and
 * movement have already been written" partial-failure path (Finding 3)
 * without needing to break the real DB. Every other table (and every
 * other `audit_log` insert) passes straight through to `admin`, so
 * `createItem`/`createCategory`'s own audit writes still succeed
 * normally.
 */
function withFailingAuditInsert(
  admin: SupabaseClient,
  failWhen: (payload: { action?: string }) => boolean
): SupabaseClient {
  return {
    from(table: string) {
      if (table === "audit_log") {
        return {
          insert(payload: { action?: string }) {
            if (failWhen(payload)) {
              return Promise.resolve({
                data: null,
                error: new Error("simulated audit failure"),
              });
            }
            return admin.from("audit_log").insert(payload);
          },
        };
      }
      return admin.from(table);
    },
  } as unknown as SupabaseClient;
}

beforeAll(async () => {
  const admin = createAdminClient();
  const { data: owner } = await admin.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;

  const { data: assistant } = await admin.auth.admin.createUser({
    email: `test-import-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;
});

afterAll(async () => {
  const admin = createAdminClient();
  // Deletion order: stock_movements -> batches -> items (same FK order
  // importOpeningStock's own cleanup follows), and audit_log.actor_id ->
  // profiles.id -> auth.users.id are both non-cascading FKs, so those go
  // first, then profiles, then the auth users.
  await admin.from("stock_movements").delete().in("item_id", createdItemIds);
  await admin.from("batches").delete().in("item_id", createdItemIds);
  await admin.from("items").delete().in("id", createdItemIds);
  await admin
    .from("categories")
    .delete()
    .in("name", Array.from(createdCategoryNames));
  await admin.from("audit_log").delete().eq("actor_id", OWNER_ID);
  await admin.from("audit_log").delete().eq("actor_id", ASSISTANT_ID);
  await admin.from("profiles").delete().eq("id", OWNER_ID);
  await admin.from("profiles").delete().eq("id", ASSISTANT_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
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

  // entity_id points at the MOVEMENT's id, matching the convention
  // record_stock_in/record_stock_out/void_movement use for their own
  // "stock_movement" audit rows — not the batch's id.
  const { data: log } = await admin
    .from("audit_log")
    .select("*")
    .eq("entity_id", movement!.id)
    .single();
  expect(log).not.toBeNull();
  expect(log?.action).toBe("movement.created");
  expect(log?.entity_type).toBe("stock_movement");
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

test("importOpeningStock rejects a row with qty <= 0 or a negative unit cost, without creating anything", async () => {
  const admin = createAdminClient();
  const categoryName = `Batteries-${runId}`;
  createdCategoryNames.add(categoryName);
  const zeroQtySku = `AB-${runId}-200`;
  const negativeCostSku = `AB-${runId}-201`;

  const result = await importOpeningStock(admin, OWNER_ID, [
    { sku: zeroQtySku, name: "Zero Qty", category: categoryName, qty: 0, lastKnownUnitCost: 100 },
    {
      sku: negativeCostSku,
      name: "Negative Cost",
      category: categoryName,
      qty: 5,
      lastKnownUnitCost: -1,
    },
  ]);

  expect(result.succeeded).toBe(0);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0].message).toMatch(/qty must be a positive number/i);
  expect(result.errors[1].message).toMatch(/must not be negative/i);

  const { data: items } = await admin
    .from("items")
    .select("id")
    .in("sku", [zeroQtySku, negativeCostSku]);
  expect(items).toHaveLength(0);
});

test("importOpeningStock cleans up the item, batch, and movement it already wrote when the audit insert then fails, leaving no orphaned rows", async () => {
  const admin = createAdminClient();
  const categoryName = `Batteries-${runId}`;
  createdCategoryNames.add(categoryName);
  const sku = `AB-${runId}-202`;
  // Distinctive values unused by any other test in this file, so a
  // leftover row can be detected unambiguously without needing the
  // (already-deleted) item's id.
  const distinctiveQty = 777;
  const distinctiveUnitCost = 123456;

  const wrapped = withFailingAuditInsert(
    admin,
    (payload) => payload.action === "movement.created"
  );

  const result = await importOpeningStock(wrapped, OWNER_ID, [
    {
      sku,
      name: "Will Roll Back",
      category: categoryName,
      qty: distinctiveQty,
      lastKnownUnitCost: distinctiveUnitCost,
    },
  ]);

  expect(result.succeeded).toBe(0);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toMatch(/simulated audit failure/i);
  // Cleanup itself succeeded, so the message shouldn't also claim cleanup
  // failed.
  expect(result.errors[0].message).not.toMatch(/cleanup failed/i);

  const { data: items } = await admin.from("items").select("id").eq("sku", sku);
  expect(items).toHaveLength(0);

  const { data: leftoverBatches } = await admin
    .from("batches")
    .select("id")
    .eq("unit_cost", distinctiveUnitCost);
  expect(leftoverBatches).toHaveLength(0);

  const { data: leftoverMovements } = await admin
    .from("stock_movements")
    .select("id")
    .eq("quantity", distinctiveQty);
  expect(leftoverMovements).toHaveLength(0);

  // Note: the item's own "item.created" audit row (written by createItem
  // before the simulated failure) is deliberately NOT cleaned up here —
  // audit_log is append-only by design (see supabase/migrations/
  // 0001_init.sql's header comment) and entity_id carries no FK, so it's
  // fine, even desirable, for it to remain as a historical record that
  // this create was attempted and then rolled back.
});

test("importOpeningStockAsOwner rejects a non-owner actor and creates nothing", async () => {
  const admin = createAdminClient();
  const categoryName = `Batteries-${runId}`;
  createdCategoryNames.add(categoryName);
  const sku = `AB-${runId}-300`;

  await expect(
    importOpeningStockAsOwner(admin, ASSISTANT_ID, [
      { sku, name: "Blocked", category: categoryName, qty: 5, lastKnownUnitCost: 100 },
    ])
  ).rejects.toThrow(ForbiddenError);

  const { data: items } = await admin.from("items").select("id").eq("sku", sku);
  expect(items).toHaveLength(0);
});

test("importOpeningStockAsOwner succeeds for an owner", async () => {
  const admin = createAdminClient();
  const categoryName = `Batteries-${runId}`;
  createdCategoryNames.add(categoryName);
  const sku = `AB-${runId}-301`;

  const result = await importOpeningStockAsOwner(admin, OWNER_ID, [
    { sku, name: "Allowed", category: categoryName, qty: 5, lastKnownUnitCost: 100 },
  ]);
  expect(result.succeeded).toBe(1);
  await trackItemBySku(sku);
});

// ---------------------------------------------------------------------
// Real-session tests. Everything above runs through createAdminClient()
// (service role), which bypasses RLS and column grants. The import Server
// Action does NOT — it runs with the signed-in user's own session. These
// tests exercise that path, which is the one real users actually hit.
// ---------------------------------------------------------------------

test("importOpeningStockAsOwner succeeds end-to-end through a REAL authenticated owner session, not just the service-role client", async () => {
  const admin = createAdminClient();
  const ownerSession = await signedInOwnerClient();
  const categoryName = `Batteries-RealSession-${runId}`;
  createdCategoryNames.add(categoryName);
  const sku = `AB-${runId}-400`;

  // Before the `.select("id")` fix in lib/import.ts, this came back
  // { succeeded: 0, errors: [{ message: "permission denied for table
  // batches" }] } — i.e. the import feature was broken for every real
  // user while every admin-client test above kept passing.
  const result = await importOpeningStockAsOwner(ownerSession, OWNER_ID, [
    {
      sku,
      name: "Real Session Battery",
      category: categoryName,
      qty: 9,
      lastKnownUnitCost: 1500,
      lowStockThreshold: 3,
    },
  ]);

  expect(result.errors).toEqual([]);
  expect(result.succeeded).toBe(1);

  // And the rows are really there, with the right values — verified with
  // the admin client, since the owner's own session can't read unit_cost
  // off `batches` directly (that's 0010 working as intended).
  const { data: item } = await admin
    .from("items")
    .select("id, name, low_stock_threshold")
    .eq("sku", sku)
    .single();
  expect(item).not.toBeNull();
  createdItemIds.push(item!.id);
  expect(item!.name).toBe("Real Session Battery");
  expect(item!.low_stock_threshold).toBe(3);

  const { data: batch } = await admin
    .from("batches")
    .select("*")
    .eq("item_id", item!.id)
    .single();
  expect(batch?.source).toBe("opening_stock");
  expect(batch?.qty_received).toBe(9);
  expect(batch?.qty_remaining).toBe(9);
  expect(Number(batch?.unit_cost)).toBe(1500);

  const { data: movement } = await admin
    .from("stock_movements")
    .select("*")
    .eq("item_id", item!.id)
    .single();
  expect(movement?.type).toBe("IN");
  expect(movement?.quantity).toBe(9);
  expect(movement?.batch_id).toBe(batch!.id);

  const { data: log } = await admin
    .from("audit_log")
    .select("*")
    .eq("entity_id", movement!.id)
    .single();
  expect(log?.action).toBe("movement.created");
  expect(log?.actor_id).toBe(OWNER_ID);
});

test("a cleanup that silently deletes nothing is reported as a cleanup failure, not as a plain row error", async () => {
  const admin = createAdminClient();
  const ownerSession = await signedInOwnerClient();
  const categoryName = `Batteries-RealSession-${runId}`;
  createdCategoryNames.add(categoryName);
  const sku = `AB-${runId}-401`;

  // Force the audit insert to fail *after* the item/batch/movement have
  // been written, so cleanup runs — over a real owner session, which (per
  // supabase/migrations/0005 and 0006) has no DELETE policy on items,
  // batches, or stock_movements. Under RLS those deletes match zero rows
  // and return NO error, so the old `.error`-only check reported a clean
  // cleanup while the item stayed behind — and the user was then stuck,
  // because retrying that SKU failed with "already exists" for an item
  // with no stock.
  const wrapped = withFailingAuditInsert(
    ownerSession,
    (payload) => payload.action === "movement.created"
  );

  const result = await importOpeningStock(wrapped, OWNER_ID, [
    {
      sku,
      name: "Cleanup Cannot Remove",
      category: categoryName,
      qty: 4,
      lastKnownUnitCost: 250,
    },
  ]);

  expect(result.succeeded).toBe(0);
  expect(result.errors).toHaveLength(1);
  // The original cause is still reported...
  expect(result.errors[0].message).toMatch(/simulated audit failure/i);
  // ...and so, distinctly and honestly, is the fact that the partial
  // record is still there.
  expect(result.errors[0].message).toMatch(
    /cleanup could not fully remove the partial record/i
  );
  expect(result.errors[0].message).toMatch(/manual cleanup may be needed/i);
  // A supabase PostgrestError is a plain object, not an Error instance —
  // the message must never degrade to the literal "[object Object]".
  expect(result.errors[0].message).not.toContain("[object Object]");

  // The row really did survive — the message is telling the truth, which
  // is the whole point of the fix.
  const { data: leftover } = await admin
    .from("items")
    .select("id")
    .eq("sku", sku)
    .single();
  expect(leftover).not.toBeNull();
  createdItemIds.push(leftover!.id);
});
