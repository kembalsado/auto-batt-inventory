import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listUsers } from "@/lib/users";
import { AddUserForm } from "./add-user-form";
import { UsersTable } from "./users-table";

/**
 * Owner-only Users screen (gated by `isOwnerOnlyRoute` in the dashboard
 * layout, not re-checked here — see app/(dashboard)/activity and
 * app/(dashboard)/settings for the same convention): a create form
 * (AddUserForm, posting to `POST /api/users`) plus the full user list
 * with a per-row deactivate/reactivate action (UsersTable, backed by
 * `GET`/`PATCH /api/users/[id]`).
 *
 * `listUsers` needs the admin client (only `auth.admin.listUsers()` has
 * email — see that function's own docstring) — called directly here
 * rather than through a fetch to GET /api/users, the same way every
 * other owner-only page in this app reads its own data straight from
 * Supabase in the Server Component rather than round-tripping through
 * its own API route. GET /api/users exists for the same list, used
 * nowhere yet — kept for symmetry with POST/PATCH and in case a future
 * client-side refresh ever needs it without a full page re-render.
 */
export default async function UsersPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const users = await listUsers(createAdminClient());

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Users</h1>

      <AddUserForm />

      <UsersTable users={users} currentUserId={user?.id ?? ""} />
    </div>
  );
}
