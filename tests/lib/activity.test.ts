import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { listAuditLog } from "@/lib/activity";
import { randomUUID } from "node:crypto";

// Plain anon-key client (no SSR/cookie plumbing needed for a test) used to
// sign in as a real user and exercise RLS — same pattern as
// tests/lib/audit.test.ts.
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

// Unique per run so reruns never collide on items.sku/categories.name, and
// so this file's audit_log rows are distinguishable from every other test
// file's (several of which also call createItem, which writes its own
// "item.created" row — see the audit.test.ts fix in the same commit).
const runId = randomUUID().slice(0, 8);

let OWNER_ID: string;
let ASSISTANT_ID: string;
let itemId: string;
let ownerClient: SupabaseClient;
let assistantClient: SupabaseClient;

const createdUserIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdItemIds: string[] = [];

beforeAll(async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-activity-owner-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;
  createdUserIds.push(OWNER_ID);

  const { data: assistant } = await admin.auth.admin.createUser({
    email: `test-activity-assistant-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;
  createdUserIds.push(ASSISTANT_ID);

  const category = await createCategory(admin, OWNER_ID, `Activity-${runId}`);
  createdCategoryIds.push(category.id);

  // Writes an audit_log row: actor_id=OWNER_ID, action="item.created",
  // entity_type="item", entity_id=item.id.
  const item = await createItem(admin, OWNER_ID, {
    sku: `AB-ACT-${runId}`,
    name: "Activity Test Battery",
    categoryId: category.id,
    unit: "pcs",
  });
  createdItemIds.push(item.id);
  itemId = item.id;

  ownerClient = createAnonClient();
  const { error: ownerSignInError } = await ownerClient.auth.signInWithPassword({
    email: `test-activity-owner-${runId}@example.com`,
    password: "test-password-123",
  });
  if (ownerSignInError) throw ownerSignInError;

  assistantClient = createAnonClient();
  const { error: assistantSignInError } =
    await assistantClient.auth.signInWithPassword({
      email: `test-activity-assistant-${runId}@example.com`,
      password: "test-password-123",
    });
  if (assistantSignInError) throw assistantSignInError;
});

afterAll(async () => {
  const admin = createAdminClient();
  // Deletion order matters: audit_log.actor_id -> profiles.id ->
  // auth.users.id are both non-cascading FKs, so audit_log rows must go
  // first, then profiles, then the auth users. items must go before
  // categories deletes.
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().in("actor_id", createdUserIds);
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
  );
});

test("listAuditLog filters by entity_id", async () => {
  const entries = await listAuditLog(ownerClient, { itemId });
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((e) => e.entityId === itemId)).toBe(true);
});

test("listAuditLog filters by actorId", async () => {
  const entries = await listAuditLog(ownerClient, { actorId: OWNER_ID });
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((e) => e.actorId === OWNER_ID)).toBe(true);
});

test("listAuditLog filters by action", async () => {
  const entries = await listAuditLog(ownerClient, { action: "category.created" });
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((e) => e.action === "category.created")).toBe(true);
});

test("listAuditLog returns empty for an assistant caller (RLS-enforced)", async () => {
  const entries = await listAuditLog(assistantClient, {});
  expect(entries).toEqual([]);
});
