/** The app's two roles. See `profiles.role` (supabase/migrations/0001_init.sql). */
export type Role = "owner" | "assistant";

/** The subset of a `profiles` row that role resolution needs. */
export interface ProfileLike {
  role?: string | null;
}

/**
 * Resolves a profile row's role into the app's two-role model. Anything
 * that isn't exactly "owner" (missing profile, null role, unexpected
 * value) is treated as "assistant" — the same default the signup trigger
 * uses (`handle_new_user` in supabase/migrations/0002_auth_profiles.sql),
 * so an unresolved role fails closed rather than open.
 */
export function getRole(profile: ProfileLike | null | undefined): Role {
  return profile?.role === "owner" ? "owner" : "assistant";
}

// Route prefixes only the "owner" role may access. Matched against the
// request pathname, including nested paths (e.g. "/users/42").
const OWNER_ONLY_PATHS = ["/users", "/activity", "/settings"];

/** True when `path` falls under a route only the owner role may access. */
export function isOwnerOnlyRoute(path: string): boolean {
  return OWNER_ONLY_PATHS.some(
    (ownerPath) => path === ownerPath || path.startsWith(`${ownerPath}/`)
  );
}
