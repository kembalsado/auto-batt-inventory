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

// The audit log exists specifically to hold an assistant accountable, so
// it must not be forgeable BY that assistant. 0003's insert policy was
// `with check (true)`, which constrained nothing:
// 0012_audit_log_actor_check.sql narrows it to
// `actor_id = auth.uid()`.
test("an authenticated user cannot insert an audit_log row attributing it to someone else", async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-audit-forge-owner@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  const { data: assistant } = await admin.auth.admin.createUser({
    email: "test-audit-forger@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(assistant!.user!.id);

  const anon = createAnonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: "test-audit-forger@example.com",
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  const forged = await anon.from("audit_log").insert({
    actor_id: owner!.user!.id,
    action: "item.created",
    entity_type: "item",
    entity_id: "00000000-0000-0000-0000-000000000006",
    summary: "Forged: blamed on the owner",
  });
  expect(forged.error?.code).toBe("42501");
  expect(forged.error?.message).toMatch(/row-level security/i);

  // A null actor_id is equally forgery — an unattributable row — and the
  // `actor_id = auth.uid()` check rejects it too (null = uuid is NULL,
  // and a WITH CHECK that evaluates to NULL fails).
  const anonymous = await anon.from("audit_log").insert({
    actor_id: null,
    action: "item.created",
    entity_type: "item",
    entity_id: "00000000-0000-0000-0000-000000000007",
    summary: "Forged: no actor at all",
  });
  expect(anonymous.error?.code).toBe("42501");

  // Nothing actually landed.
  const { data: rows } = await admin
    .from("audit_log")
    .select("id")
    .in("entity_id", [
      "00000000-0000-0000-0000-000000000006",
      "00000000-0000-0000-0000-000000000007",
    ]);
  expect(rows).toEqual([]);

  // And the legitimate path — recording your own action — still works.
  await expect(
    recordAudit(anon, {
      actorId: assistant!.user!.id,
      action: "item.created",
      entityType: "item",
      entityId: "00000000-0000-0000-0000-000000000008",
      summary: "Created item AB-005",
    })
  ).resolves.toBeUndefined();
});

// Every other SECURITY DEFINER function in this project is revoked from
// anon (see 0006/0007/0008/0010). is_owner() predates that convention and
// was missed until the final review: anon could call it and learn whether
// any given user id is an owner. 0011 closes it.
test("anon cannot call is_owner() via RPC", async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-is-owner-probe@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  const anon = createAnonClient();
  const { data, error } = await anon.rpc("is_owner", {
    user_id: owner!.user!.id,
  });

  expect(error?.code).toBe("42501");
  expect(data).toBeNull();
});

// `authenticated` must keep EXECUTE on is_owner(): the RLS policies in
// 0002/0003/0012 call it from their USING clauses, and a policy
// expression is evaluated with the querying role's own privileges. If
// 0011's revoke had been too broad, an owner reading audit_log (the
// Activity screen) would start erroring instead of returning rows.
test("an owner can still read audit_log after the is_owner lockdown (the policy still evaluates)", async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-is-owner-policy@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  await recordAudit(admin, {
    actorId: owner!.user!.id,
    action: "item.created",
    entityType: "item",
    entityId: "00000000-0000-0000-0000-000000000009",
    summary: "Created item AB-006",
  });

  const anon = createAnonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: "test-is-owner-policy@example.com",
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  const { data, error } = await anon
    .from("audit_log")
    .select("*")
    .eq("entity_id", "00000000-0000-0000-0000-000000000009");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
});
