import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Plain anon-key client (no SSR/cookie plumbing needed for a test) used to
// sign in as a real user and exercise RLS, as opposed to createAdminClient()
// below, which uses the service-role key and bypasses RLS entirely. See
// tests/auth/signup-profile.test.ts for the pattern this follows.
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

// Every user created by a test in this file is tracked here and deleted in
// afterAll, so the suite is safely rerunnable without a manual
// `supabase db reset` in between (admin.createUser fails on a duplicate
// email otherwise).
const createdUserIds: string[] = [];

afterAll(async () => {
  const admin = createAdminClient();
  // Deletion order matters, and both FKs are non-cascading:
  // audit_log.actor_id -> profiles.id, and profiles.id -> auth.users.id.
  // audit_log rows created by this file's tests must go first, or the
  // profiles delete fails; then profiles, or the auth.users delete fails.
  await admin.from("audit_log").delete().in("actor_id", createdUserIds);
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
  );
});

test("recordAudit inserts a row with the given fields", async () => {
  const supabase = createAdminClient();

  // audit_log.actor_id has a FK to profiles(id), so the actor must be a
  // real profile row, not an arbitrary UUID.
  const { data: actor } = await supabase.auth.admin.createUser({
    email: "test-audit-writer@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(actor!.user!.id);

  await recordAudit(supabase, {
    actorId: actor!.user!.id,
    action: "item.created",
    entityType: "item",
    entityId: "00000000-0000-0000-0000-000000000002",
    summary: "Created item AB-001",
  });
  // Scoped by entity_id too, not just action: createItem (lib/items.ts) is
  // called by several other test files, each of which also writes an
  // "item.created" audit_log row. Without this extra scope, .single() can
  // intermittently match a stray row from another test instead of (or as
  // well as) this one and fail — see the task-14 report for the repro.
  const { data } = await supabase
    .from("audit_log")
    .select("*")
    .eq("action", "item.created")
    .eq("entity_id", "00000000-0000-0000-0000-000000000002")
    .single();
  expect(data?.summary).toBe("Created item AB-001");
});

test("assistant role cannot read audit_log (RLS)", async () => {
  const admin = createAdminClient();

  const { data: assistant } = await admin.auth.admin.createUser({
    email: "test-audit-assistant@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(assistant!.user!.id);

  // Seed a row so there's something to (fail to) see.
  await recordAudit(admin, {
    actorId: assistant!.user!.id,
    action: "item.created",
    entityType: "item",
    entityId: "00000000-0000-0000-0000-000000000003",
    summary: "Created item AB-002",
  });

  const anon = createAnonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: "test-audit-assistant@example.com",
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  const { data, error } = await anon.from("audit_log").select("*");
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test("owner role can read audit_log (RLS)", async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-audit-owner@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  await recordAudit(admin, {
    actorId: owner!.user!.id,
    action: "item.created",
    entityType: "item",
    entityId: "00000000-0000-0000-0000-000000000004",
    summary: "Created item AB-003",
  });

  const anon = createAnonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: "test-audit-owner@example.com",
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  const { data, error } = await anon
    .from("audit_log")
    .select("*")
    .eq("summary", "Created item AB-003");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
});

test("authenticated user can insert into audit_log", async () => {
  const admin = createAdminClient();

  const { data: assistant } = await admin.auth.admin.createUser({
    email: "test-audit-inserter@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(assistant!.user!.id);

  const anon = createAnonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: "test-audit-inserter@example.com",
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  await expect(
    recordAudit(anon, {
      actorId: assistant!.user!.id,
      action: "item.created",
      entityType: "item",
      entityId: "00000000-0000-0000-0000-000000000005",
      summary: "Created item AB-004",
    })
  ).resolves.toBeUndefined();
});
