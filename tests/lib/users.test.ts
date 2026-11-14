import { createAdminClient } from "@/lib/supabase/admin";
import { listUsers, setUserActive, SelfTargetError } from "@/lib/users";
import { randomUUID } from "node:crypto";

const runId = randomUUID().slice(0, 8);
const createdUserIds: string[] = [];

afterAll(async () => {
  const admin = createAdminClient();
  // Same FK-ordered cleanup as tests/api/users.test.ts: audit_log.actor_id
  // -> profiles(id), and profiles.id -> auth.users(id), neither cascading.
  await admin.from("audit_log").delete().in("actor_id", createdUserIds);
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
  );
});

test("listUsers merges auth.users and profiles for a newly created user", async () => {
  const admin = createAdminClient();
  const email = `test-list-users-${runId}@example.com`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { full_name: "List Users Fixture", role: "assistant" },
  });
  createdUserIds.push(data!.user!.id);

  const users = await listUsers(admin);
  const found = users.find((u) => u.id === data!.user!.id);

  expect(found).toEqual(
    expect.objectContaining({
      email,
      fullName: "List Users Fixture",
      role: "assistant",
      isActive: true,
    })
  );
});

test("setUserActive(false) bans the account and records a deactivated audit row; setUserActive(true) reverses both", async () => {
  const admin = createAdminClient();
  const { data: actor } = await admin.auth.admin.createUser({
    email: `test-set-active-actor-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(actor!.user!.id);

  const { data: target } = await admin.auth.admin.createUser({
    email: `test-set-active-target-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  createdUserIds.push(target!.user!.id);

  await setUserActive(admin, actor!.user!.id, target!.user!.id, false);

  const { data: banned } = await admin.auth.admin.getUserById(target!.user!.id);
  expect(banned.user?.banned_until).toBeTruthy();

  const { data: deactivatedAudit } = await admin
    .from("audit_log")
    .select("action, actor_id")
    .eq("entity_id", target!.user!.id)
    .eq("action", "user.deactivated")
    .maybeSingle();
  expect(deactivatedAudit).toEqual(
    expect.objectContaining({ action: "user.deactivated", actor_id: actor!.user!.id })
  );

  await setUserActive(admin, actor!.user!.id, target!.user!.id, true);

  const { data: unbanned } = await admin.auth.admin.getUserById(target!.user!.id);
  expect(unbanned.user?.banned_until).toBeFalsy();

  const { data: activatedAudit } = await admin
    .from("audit_log")
    .select("action")
    .eq("entity_id", target!.user!.id)
    .eq("action", "user.activated")
    .maybeSingle();
  expect(activatedAudit?.action).toBe("user.activated");
});

test("setUserActive throws SelfTargetError when the actor targets themselves, without banning them", async () => {
  const admin = createAdminClient();
  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-set-active-self-${runId}@example.com`,
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  await expect(
    setUserActive(admin, owner!.user!.id, owner!.user!.id, false)
  ).rejects.toThrow(SelfTargetError);

  const { data: refreshed } = await admin.auth.admin.getUserById(owner!.user!.id);
  expect(refreshed.user?.banned_until).toBeFalsy();
});
