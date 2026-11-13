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
const OWNER_ONLY_PATHS = ["/users", "/activity", "/settings", "/import"];

/** True when `path` falls under a route only the owner role may access. */
export function isOwnerOnlyRoute(path: string): boolean {
  return OWNER_ONLY_PATHS.some(
    (ownerPath) => path === ownerPath || path.startsWith(`${ownerPath}/`)
  );
}

/** The subset of `AppSettings` (lib/settings.ts) that cost-gating needs. */
export interface CostSettingsLike {
  showCostToAssistant: boolean;
}

/**
 * True when `role` may see cost data — a batch's `unit_cost` and any
 * inventory value computed from it. An owner can always see it; an
 * assistant can only when the owner has opted in via
 * `app_settings.show_cost_to_assistant` (Task 2/11).
 *
 * This is the single rule every cost-gated data read calls through
 * (`getItemBatchesForViewer` in lib/items.ts, and Tasks 12/13's data
 * shaping) so cost is stripped server-side wherever it's read, not just
 * hidden by a UI component.
 */
export function canSeeCost(role: Role, settings: CostSettingsLike): boolean {
  return role === "owner" || settings.showCostToAssistant;
}
