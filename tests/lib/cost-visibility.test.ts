import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem, getItemBatchesForViewer } from "@/lib/items";
import { recordStockIn } from "@/lib/movements";
import { getSettings, updateSettings, type AppSettings } from "@/lib/settings";
import { canSeeCost } from "@/lib/permissions";
import { randomUUID } from "node:crypto";

// Plain anon-key client used to sign in as a real user and exercise RLS,
// as opposed to createAdminClient() below, which uses the service-role key
// and bypasses RLS entirely. See tests/lib/audit.test.ts for the pattern.
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

// A real profile row is required: audit_log.actor_id has a FK to
// profiles(id) (updateSettings/createItem/recordStockIn all write via
// recordAudit).
let OWNER_ID: string;
let ASSISTANT_ID: string;
let OWNER_EMAIL: string;
let ASSISTANT_EMAIL: string;
let itemId: string;
let batchId: string;
let movementId: string;
let categoryId: string;

// app_settings is a single GLOBAL row shared by the whole database (there
// is no per-test isolation for it, unlike items/categories/batches which
// each test creates its own rows for). This file mutates it, so it saves
// the pre-existing value here and restores it in afterAll so other test
// files (e.g. tests/db/schema.test.ts, which asserts
// show_cost_to_assistant === false) aren't left in a different state by a
// rerun of this suite. Note this is still not airtight against another
// test file's queries landing *during* this file's run, since Vitest runs
// test files in parallel by default and app_settings has no per-test
// scoping possible — a known, pre-existing limitation of the single-row
// design, not something this test file can fully fix.
let originalSettings: AppSettings;

const runId = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = createAdminClient();
  originalSettings = await getSettings(admin);

  OWNER_EMAIL = `test-cost-vis-owner-${runId}@example.com`;
  ASSISTANT_EMAIL = `test-cost-vis-assistant-${runId}@example.com`;

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

  const category = await createCategory(admin, OWNER_ID, `Batteries-${runId}`);
  categoryId = category.id;

  const item = await createItem(admin, OWNER_ID, {
    sku: `AB-${runId}-001`,
    name: "12V Battery",
    categoryId,
    unit: "pcs",
  });
  itemId = item.id;

  const { batchId: bId, movementId: mId } = await recordStockIn(admin, OWNER_ID, {
    itemId,
    qty: 10,
    unitCost: 999,
    batchDate: "2026-11-12",
  });
  batchId = bId;
  movementId = mId;
});

afterAll(async () => {
  const admin = createAdminClient();

  // Restore the global settings row to what it was before this file ran.
  await updateSettings(admin, OWNER_ID, originalSettings);

  // Deletion order matters: stock_movements/batches -> items -> categories,
  // then audit_log (by actor_id) -> profiles -> auth.users (both
  // non-cascading FKs), so the suite is safely rerunnable without a manual
  // `supabase db reset`.
  await admin.from("stock_movements").delete().eq("id", movementId);
  await admin.from("batches").delete().eq("id", batchId);
  await admin.from("items").delete().eq("id", itemId);
  await admin.from("categories").delete().eq("id", categoryId);
  await admin.from("audit_log").delete().in("actor_id", [OWNER_ID, ASSISTANT_ID]);
  await admin.from("profiles").delete().in("id", [OWNER_ID, ASSISTANT_ID]);
  await admin.auth.admin.deleteUser(OWNER_ID);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
});

test("canSeeCost is false for assistant when show_cost_to_assistant is false", () => {
  expect(canSeeCost("assistant", { showCostToAssistant: false })).toBe(false);
});

test("canSeeCost is true for assistant when show_cost_to_assistant is true", () => {
  expect(canSeeCost("assistant", { showCostToAssistant: true })).toBe(true);
});

test("canSeeCost is always true for owner", () => {
  expect(canSeeCost("owner", { showCostToAssistant: false })).toBe(true);
});

test("getSettings reads back the seeded app_settings row", async () => {
  const admin = createAdminClient();
  const settings = await getSettings(admin);
  expect(typeof settings.showCostToAssistant).toBe("boolean");
  expect(Array.isArray(settings.notificationEmails)).toBe(true);
});

test("updateSettings writes an audit log entry", async () => {
  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: true });

  // app_settings.id is an int (always 1), not a uuid, so audit_log has no
  // entity_id to scope by here — actor_id + action + most-recent is the
  // most unique scoping available (per the task's general rule against
  // scoping only by `action`, which tests/lib/audit.test.ts's known
  // flakiness risk illustrates).
  const { data: log } = await admin
    .from("audit_log")
    .select("*")
    .eq("actor_id", OWNER_ID)
    .eq("action", "settings.updated")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  expect(log?.action).toBe("settings.updated");
});

test("an assistant RPC call for batch data never receives unit_cost when cost is hidden", async () => {
  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: false });

  const assistantClient = createAnonClient();
  const { error: signInError } = await assistantClient.auth.signInWithPassword({
    email: ASSISTANT_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const batches = await getItemBatchesForViewer(assistantClient, itemId);
  expect(batches.length).toBeGreaterThan(0);
  expect(batches.every((b) => b.unit_cost === undefined)).toBe(true);
});

test("an assistant RPC call for batch data receives unit_cost once cost is shown", async () => {
  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: true });

  const assistantClient = createAnonClient();
  const { error: signInError } = await assistantClient.auth.signInWithPassword({
    email: ASSISTANT_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const batches = await getItemBatchesForViewer(assistantClient, itemId);
  expect(batches.some((b) => b.unit_cost === 999)).toBe(true);
});

test("an owner always receives unit_cost regardless of show_cost_to_assistant", async () => {
  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: false });

  const ownerClient = createAnonClient();
  const { error: signInError } = await ownerClient.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const batches = await getItemBatchesForViewer(ownerClient, itemId);
  expect(batches.some((b) => b.unit_cost === 999)).toBe(true);
});

// The following tests prove the column-level lockdown directly — not
// through getItemBatchesForViewer, but via a raw query against the
// `batches` table itself, the way an assistant bypassing the app and
// hitting PostgREST directly would. Before
// supabase/migrations/0010_batches_cost_column_lockdown.sql, this was
// exactly the hole code review found: getItemBatchesForViewer stripped
// unit_cost, but `batches_select_authenticated`'s RLS policy
// (`using (true)`) said nothing about columns, so a direct
// `GET /rest/v1/batches?select=*` with a real assistant session still
// returned the raw cost. These tests query `.from("batches")` directly to
// prove that path is now closed at the database layer, regardless of
// show_cost_to_assistant and regardless of role.

test("RLS/columns: an assistant cannot read unit_cost directly from the batches table, even with the setting on", async () => {
  const admin = createAdminClient();
  // Deliberately the *opposite* of the usual test setup: prove the column
  // lockdown holds even when show_cost_to_assistant is true, since it's a
  // Postgres column grant (role-level), not conditioned on the setting at
  // all — only `batches_for_viewer` conditions on the setting.
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: true });

  const assistantClient = createAnonClient();
  const { error: signInError } = await assistantClient.auth.signInWithPassword({
    email: ASSISTANT_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const wildcard = await assistantClient
    .from("batches")
    .select("*")
    .eq("id", batchId);
  // Postgres denies the whole query, not a partial row, because `select
  // *` references every column (unit_cost included) up front — see
  // tests/lib/cost-visibility.test.ts's live-verification notes in
  // task-11-report.md.
  expect(wildcard.error?.code).toBe("42501");
  expect(wildcard.data).toBeNull();

  const explicitColumn = await assistantClient
    .from("batches")
    .select("unit_cost")
    .eq("id", batchId);
  expect(explicitColumn.error?.code).toBe("42501");
  expect(explicitColumn.data).toBeNull();
});

test("RLS/columns: an owner cannot read unit_cost directly from the batches table either — it's a role-level grant, not an owner exception", async () => {
  const ownerClient = createAnonClient();
  const { error: signInError } = await ownerClient.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const { data, error } = await ownerClient
    .from("batches")
    .select("*")
    .eq("id", batchId);

  expect(error?.code).toBe("42501");
  expect(data).toBeNull();
});

test("RLS/columns: non-cost columns (e.g. qty_remaining) remain directly readable on batches — the lockdown is column-specific, not a full table lockout", async () => {
  const assistantClient = createAnonClient();
  const { error: signInError } = await assistantClient.auth.signInWithPassword({
    email: ASSISTANT_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const { data, error } = await assistantClient
    .from("batches")
    .select("qty_remaining")
    .eq("id", batchId)
    .single();

  expect(error).toBeNull();
  expect(data?.qty_remaining).toBe(10);
});

test("batches_for_viewer (not getItemBatchesForViewer) nulls unit_cost for an assistant directly, proving the database view itself enforces this, not just the JS wrapper", async () => {
  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { showCostToAssistant: false });

  const assistantClient = createAnonClient();
  const { error: signInError } = await assistantClient.auth.signInWithPassword({
    email: ASSISTANT_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const { data, error } = await assistantClient
    .from("batches_for_viewer")
    .select("*")
    .eq("id", batchId)
    .single();

  expect(error).toBeNull();
  expect(data?.unit_cost).toBeNull();
  expect(data?.qty_remaining).toBe(10);
});

// 0010 granted batches_for_viewer to `authenticated` but never revoked
// Supabase's default grant to `anon`. In practice anon's query failed
// anyway, because the view's CASE calls can_see_cost(), whose EXECUTE
// 0010 did revoke — but that left one single point of defense in front of
// cost data. 0011 revokes the view grant too, so the denial now comes
// from the view itself.
test("anon has no grant on batches_for_viewer at all — not merely blocked by can_see_cost", async () => {
  const anonClient = createAnonClient();

  const { data, error } = await anonClient
    .from("batches_for_viewer")
    .select("*")
    .eq("id", batchId);

  expect(error?.code).toBe("42501");
  expect(error?.message).toMatch(/permission denied for view batches_for_viewer/i);
  expect(data).toBeNull();
});

test("RLS: an assistant can read app_settings but cannot update it", async () => {
  const assistantClient = createAnonClient();
  const { error: signInError } = await assistantClient.auth.signInWithPassword({
    email: ASSISTANT_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const { data, error: selectError } = await assistantClient
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .single();
  expect(selectError).toBeNull();
  expect(data?.id).toBe(1);

  const { data: updated, error: updateError } = await assistantClient
    .from("app_settings")
    .update({ show_cost_to_assistant: true })
    .eq("id", 1)
    .select();
  // RLS silently filters out rows the policy rejects rather than erroring —
  // no row comes back updated.
  expect(updateError).toBeNull();
  expect(updated).toEqual([]);
});

test("RLS: an owner can update app_settings", async () => {
  const ownerClient = createAnonClient();
  const { error: signInError } = await ownerClient.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();

  const { data, error } = await ownerClient
    .from("app_settings")
    .update({ show_cost_to_assistant: true })
    .eq("id", 1)
    .select()
    .single();

  expect(error).toBeNull();
  expect(data?.show_cost_to_assistant).toBe(true);
});
