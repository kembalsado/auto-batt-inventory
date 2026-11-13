import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";
import type { Role } from "@/lib/permissions";

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
