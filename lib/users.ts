import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";
import { getRole, type Role } from "@/lib/permissions";

/** Fields accepted by `createUserAsOwner`. */
export interface CreateUserInput {
  email: string;
  password: string;
  fullName: string;
  role: Role;
}

/** The subset of the created auth user this module hands back to callers. */
export interface CreatedUser {
  id: string;
  email: string;
}

/**
 * Creates a new Supabase Auth user via the admin (service-role) client,
 * then records an `audit_log` entry for it.
 *
 * `user_metadata.full_name`/`role` are what `handle_new_user` (the trigger
 * in supabase/migrations/0001_init.sql) reads from `raw_user_meta_data` to
 * seed the matching `profiles` row — the trigger defaults role to
 * "assistant" unless it's explicitly "owner", so this always passes the
 * caller's requested role through explicitly rather than relying on that
 * default.
 *
 * This function does not check that the caller is an owner — that's
 * app/api/users/route.ts's job, before it calls this.
 */
export async function createUserAsOwner(
  adminClient: SupabaseClient,
  actorId: string,
  input: CreateUserInput
): Promise<CreatedUser> {
  const { data, error } = await adminClient.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName,
      role: input.role,
    },
  });

  if (error) {
    throw error;
  }

  const user = data.user!;

  await recordAudit(adminClient, {
    actorId,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    summary: `Created user ${input.fullName} (${input.role})`,
  });

  return { id: user.id, email: user.email ?? input.email };
}

/** One row of the owner-only user list/table. */
export interface UserListItem {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

/** The subset of a `profiles` row `listUsers` needs. */
interface ProfileRow {
  id: string;
  full_name: string | null;
  role: string | null;
}

/**
 * Every user the app knows about, for the owner-only Users screen.
 *
 * `profiles` has no email column (see lib/users.ts's `createUserAsOwner`
 * and app/(dashboard)/activity/page.tsx's `actorLabel` for the same
 * caveat elsewhere) — only `auth.users`, via the admin API, has it. So
 * this is two bulk reads merged by id: `auth.admin.listUsers()` for
 * email/created_at/ban status, `profiles` for full_name/role.
 *
 * `isActive` reads Supabase Auth's own `banned_until` rather than an
 * app-level column: `setUserActive` below bans/unbans through the same
 * Admin API, so GoTrue itself refuses a banned user's sign-in — there's
 * no separate flag to keep in sync or forget to check on a login path.
 *
 * One unpaginated page (`listUsers`'s default: up to 50 users) — this
 * app assumes one small shop's worth of accounts, the same scale
 * assumption the rest of the codebase already makes (see e.g. the
 * mobile sidebar drawer, sized for a handful of nav links, not a command
 * palette).
 */
export async function listUsers(adminClient: SupabaseClient): Promise<UserListItem[]> {
  const [{ data: authData, error: authError }, { data: profiles, error: profilesError }] =
    await Promise.all([
      adminClient.auth.admin.listUsers(),
      adminClient.from("profiles").select("id, full_name, role"),
    ]);

  if (authError) {
    throw authError;
  }
  if (profilesError) {
    throw profilesError;
  }

  const profileById = new Map(
    ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  return authData.users
    .map((user) => {
      const profile = profileById.get(user.id);
      return {
        id: user.id,
        email: user.email ?? "",
        fullName: profile?.full_name ?? null,
        role: getRole(profile),
        isActive: !user.banned_until,
        createdAt: user.created_at,
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Thrown by `setUserActive` when the caller targets their own account.
 * Deactivating yourself would lock you out with no one left who could
 * undo it from inside the app — the same "both roles must always be able
 * to end their own session, never someone else's only way in" concern
 * components/sign-out-button.tsx's docstring already raises for sign-out.
 */
export class SelfTargetError extends Error {
  constructor(message = "You can't deactivate your own account.") {
    super(message);
    this.name = "SelfTargetError";
  }
}

/**
 * Activates or deactivates a user via Supabase Auth's own ban mechanism
 * (`ban_duration`), then records an audit_log entry.
 *
 * A ban, not a delete: `profiles.id` references `auth.users (id)`, and
 * `audit_log.actor_id` references `profiles (id)` — both with no cascade
 * — so actually deleting a user who has ever acted in the app (recorded
 * a movement, anything with an audit_log row) would fail outright on the
 * foreign key, and even a user with zero history would silently sever
 * their name from `profiles` for any audit row an owner later attributes
 * to them in a summary string. Banning instead matches how the rest of
 * this app already treats removal — items are deactivated
 * (`is_active`), never deleted, for the identical reason: so historical
 * records (a movement against that item, here an audit_log row by that
 * user) keep meaning something. `ban_duration: "none"` un-bans; GoTrue
 * has no "ban forever" literal, so deactivate uses a 100-year duration
 * instead, matching Supabase's own documented pattern for a permanent
 * ban.
 *
 * Does not check that the caller is an owner — app/api/users/[id]/
 * route.ts's job, before it calls this — but DOES check the caller isn't
 * targeting themselves, since that guard belongs here regardless of
 * which route ends up calling this function.
 */
export async function setUserActive(
  adminClient: SupabaseClient,
  actorId: string,
  targetUserId: string,
  isActive: boolean
): Promise<void> {
  if (targetUserId === actorId) {
    throw new SelfTargetError();
  }

  const { error } = await adminClient.auth.admin.updateUserById(targetUserId, {
    ban_duration: isActive ? "none" : "876000h",
  });

  if (error) {
    throw error;
  }

  await recordAudit(adminClient, {
    actorId,
    action: isActive ? "user.activated" : "user.deactivated",
    entityType: "user",
    entityId: targetUserId,
    summary: isActive ? "Reactivated user" : "Deactivated user",
  });
}
