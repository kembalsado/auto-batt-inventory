import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Plain anon-key client (no SSR/cookie plumbing needed for a test) used to
// sign in as a real user and exercise RLS, as opposed to createAdminClient()
// below, which uses the service-role key and bypasses RLS entirely.
// persistSession: false keeps each client's session in memory only, and a
// random storageKey gives each client its own identity — otherwise every
// instance created in this file shares the same default key and GoTrue
// logs "multiple instances" warnings for the whole run.
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
  // profiles.id has a (non-cascading) FK to auth.users.id, so the profiles
  // row must be deleted first — deleteUser fails with a DB error otherwise.
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
  );
});

test("creating an auth user creates a default assistant profile", async () => {
  const admin = createAdminClient();
  const { data: user } = await admin.auth.admin.createUser({
    email: "test-assistant@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(user!.user!.id);

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user!.user!.id)
    .single();
  expect(profile?.role).toBe("assistant");
});

test("a non-owner cannot read another user's profile row (RLS)", async () => {
  const admin = createAdminClient();

  const { data: userA } = await admin.auth.admin.createUser({
    email: "test-rls-user-a@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(userA!.user!.id);

  const { data: userB } = await admin.auth.admin.createUser({
    email: "test-rls-user-b@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(userB!.user!.id);

  // Sign in as userA (an assistant, not an owner) with a non-admin client —
  // this is the client that actually goes through RLS.
  const anon = createAnonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: "test-rls-user-a@example.com",
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  // userA can read their own profile row...
  const { data: ownProfile } = await anon
    .from("profiles")
    .select("*")
    .eq("id", userA!.user!.id);
  expect(ownProfile).toHaveLength(1);

  // ...but not userB's — RLS filters that row out entirely rather than
  // erroring, so this resolves with zero rows rather than throwing.
  const { data: otherProfile } = await anon
    .from("profiles")
    .select("*")
    .eq("id", userB!.user!.id);
  expect(otherProfile).toHaveLength(0);
});

test("an owner can read every profile row (RLS)", async () => {
  const admin = createAdminClient();

  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-rls-owner@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  const { data: otherAssistant } = await admin.auth.admin.createUser({
    email: "test-rls-other-assistant@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(otherAssistant!.user!.id);

  const anon = createAnonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: "test-rls-owner@example.com",
    password: "test-password-123",
  });
  expect(signInError).toBeNull();

  const { data: allProfiles } = await anon.from("profiles").select("*");
  const visibleIds = (allProfiles ?? []).map((row) => row.id);
  expect(visibleIds).toContain(owner!.user!.id);
  expect(visibleIds).toContain(otherAssistant!.user!.id);
});
