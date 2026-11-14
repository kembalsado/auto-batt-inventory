import { createAdminClient } from "@/lib/supabase/admin";
import { createBrowserClient } from "@/lib/supabase/client";

// This file exercises the real `POST /api/users` route over HTTP (not by
// importing the handler directly), because the thing under test — the
// route reading the caller's own session cookie and rejecting a non-owner
// — can only be proven end-to-end. It therefore needs a live `next dev`
// server on localhost:3000, the same documented, pre-existing dependency
// as tests/auth/route-protection.test.tsx (see that file/its task reports:
// it fails with ECONNREFUSED whenever no dev server is running, which is
// expected and unrelated to any particular task).
const BASE_URL = "http://localhost:3000";

// Signs in via the real browser client so @supabase/ssr writes an actual
// session cookie to `document.cookie` (vitest's jsdom environment defaults
// its origin to http://localhost:3000, matching the dev server above), then
// hands back the Cookie header to replay with plain `fetch` — the same
// technique used to verify Task 4's dashboard shell against a live server.
async function signInCookieHeader(
  email: string,
  password: string
): Promise<string> {
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return document.cookie;
}

// Every user this file creates — test fixtures (owner/assistant callers)
// and the ones created *through* the route itself — is tracked here and
// deleted in afterAll, so the suite is safely rerunnable without a manual
// `supabase db reset` in between.
const createdUserIds: string[] = [];

afterAll(async () => {
  const admin = createAdminClient();
  // Deletion order matters, and both FKs are non-cascading:
  // audit_log.actor_id -> profiles(id), and profiles.id -> auth.users(id).
  await admin.from("audit_log").delete().in("actor_id", createdUserIds);
  await admin.from("profiles").delete().in("id", createdUserIds);
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
  );
});

test("owner can create a new assistant user", async () => {
  const admin = createAdminClient();
  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-users-owner-1@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  const cookie = await signInCookieHeader(
    "test-users-owner-1@example.com",
    "test-password-123"
  );

  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({
      email: "test-users-new-assistant@example.com",
      password: "temp-pass-123",
      fullName: "Task15 New Assistant",
      role: "assistant",
    }),
  });

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toBeTruthy();
  createdUserIds.push(body.id);

  // Scoped by full_name, not just "the most recent profile" — this file's
  // other tests also create profiles, and a stray match from one of them
  // could otherwise make this pass/fail for the wrong reason.
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("full_name", "Task15 New Assistant")
    .single();
  expect(profile?.role).toBe("assistant");
});

test("owner can create a new owner user", async () => {
  const admin = createAdminClient();
  const { data: owner } = await admin.auth.admin.createUser({
    email: "test-users-owner-2@example.com",
    password: "test-password-123",
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  createdUserIds.push(owner!.user!.id);

  const cookie = await signInCookieHeader(
    "test-users-owner-2@example.com",
    "test-password-123"
  );

  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({
      email: "test-users-new-owner@example.com",
      password: "temp-pass-123",
      fullName: "Task15 New Owner",
      role: "owner",
    }),
  });

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toBeTruthy();
  createdUserIds.push(body.id);

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("full_name", "Task15 New Owner")
    .single();
  expect(profile?.role).toBe("owner");
});

test("an assistant cannot create a user", async () => {
  const admin = createAdminClient();
  const { data: assistant } = await admin.auth.admin.createUser({
    email: "test-users-assistant@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  createdUserIds.push(assistant!.user!.id);

  const cookie = await signInCookieHeader(
    "test-users-assistant@example.com",
    "test-password-123"
  );

  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({
      email: "test-users-rejected@example.com",
      password: "temp-pass-123",
      fullName: "Should Not Be Created",
      role: "assistant",
    }),
  });

  expect(res.status).toBe(403);

  // Not just the status code — confirm the write genuinely never happened.
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("full_name", "Should Not Be Created")
    .maybeSingle();
  expect(profile).toBeNull();
});

test("an unauthenticated request is rejected", async () => {
  // middleware.ts redirects any unauthenticated request outside
  // PUBLIC_PATHS to /login before it ever reaches the route handler — the
  // same behavior tests/auth/route-protection.test.tsx proves for
  // dashboard pages. With `redirect: "manual"` (not followed), a passing
  // fetch here never reaches app/api/users/route.ts's own 401 branch,
  // which is why it's not exercised directly by an HTTP test: it only
  // matters if middleware's path coverage ever changes.
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "test-users-unauth@example.com",
      password: "temp-pass-123",
      fullName: "Unauth",
      role: "assistant",
    }),
  });
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toContain("/login");
});

describe("PATCH /api/users/[id]", () => {
  test("owner can deactivate another user, locking them out, then reactivate them", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-users-patch-owner-1@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);

    const { data: target } = await admin.auth.admin.createUser({
      email: "test-users-patch-target-1@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "assistant" },
    });
    createdUserIds.push(target!.user!.id);

    const cookie = await signInCookieHeader(
      "test-users-patch-owner-1@example.com",
      "test-password-123"
    );

    const deactivateRes = await fetch(`${BASE_URL}/api/users/${target!.user!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(deactivateRes.status).toBe(200);

    // The real proof a deactivation matters: GoTrue itself now refuses
    // this account's own sign-in, not just that some flag flipped.
    const lockedOut = createBrowserClient();
    const { error: signInError } = await lockedOut.auth.signInWithPassword({
      email: "test-users-patch-target-1@example.com",
      password: "test-password-123",
    });
    expect(signInError).toBeTruthy();

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, summary")
      .eq("entity_id", target!.user!.id)
      .eq("action", "user.deactivated")
      .maybeSingle();
    expect(audit?.action).toBe("user.deactivated");

    const reactivateRes = await fetch(`${BASE_URL}/api/users/${target!.user!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    expect(reactivateRes.status).toBe(200);

    const reactivated = createBrowserClient();
    const { error: secondSignInError } = await reactivated.auth.signInWithPassword({
      email: "test-users-patch-target-1@example.com",
      password: "test-password-123",
    });
    expect(secondSignInError).toBeNull();
  });

  test("an owner cannot deactivate their own account", async () => {
    const admin = createAdminClient();
    const { data: owner } = await admin.auth.admin.createUser({
      email: "test-users-patch-self@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    createdUserIds.push(owner!.user!.id);

    const cookie = await signInCookieHeader(
      "test-users-patch-self@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/users/${owner!.user!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(400);

    // Confirm it's genuinely still active, not just that the request
    // happened to fail for an unrelated reason.
    const { data: refreshed } = await admin.auth.admin.getUserById(owner!.user!.id);
    expect(refreshed.user?.banned_until).toBeFalsy();
  });

  test("an assistant cannot deactivate another user", async () => {
    const admin = createAdminClient();
    const { data: assistant } = await admin.auth.admin.createUser({
      email: "test-users-patch-assistant@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "assistant" },
    });
    createdUserIds.push(assistant!.user!.id);

    const { data: target } = await admin.auth.admin.createUser({
      email: "test-users-patch-target-2@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "assistant" },
    });
    createdUserIds.push(target!.user!.id);

    const cookie = await signInCookieHeader(
      "test-users-patch-assistant@example.com",
      "test-password-123"
    );

    const res = await fetch(`${BASE_URL}/api/users/${target!.user!.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(403);

    const { data: refreshed } = await admin.auth.admin.getUserById(target!.user!.id);
    expect(refreshed.user?.banned_until).toBeFalsy();
  });

  test("an unauthenticated PATCH request is rejected", async () => {
    const admin = createAdminClient();
    const { data: target } = await admin.auth.admin.createUser({
      email: "test-users-patch-target-3@example.com",
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { role: "assistant" },
    });
    createdUserIds.push(target!.user!.id);

    const res = await fetch(`${BASE_URL}/api/users/${target!.user!.id}`, {
      method: "PATCH",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
