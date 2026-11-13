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

// Route prefixes reachable WITHOUT a session. Everything else — every
// (dashboard) route and every other API route — is redirected to /login
// by middleware.ts.
//
// `/api/cron` is here because Vercel Cron calls /api/cron/daily-email
// with no session cookie at all, and middleware's matcher covers /api/*.
// Without this entry that request was answered with a 307 to /login and
// the route handler never ran, so the daily email never sent in
// production. Being public in middleware does NOT make the route
// unauthenticated: app/api/cron/daily-email/route.ts performs its own
// `Authorization: Bearer ${CRON_SECRET}` check (Vercel's documented
// pattern), which is the real guard. Listed as a prefix, not the one
// exact route, so a second cron route can't silently reintroduce the
// same bug.
const PUBLIC_PATHS = ["/login", "/api/cron"];

/**
 * True when `path` is a public route, or sits underneath one as a path
 * segment.
 *
 * Deliberately not a bare `startsWith`, which is what middleware.ts used
 * to do: that treated anything merely *prefixed* by a public path as
 * public too, so a future `/login-history` or `/api/cronjobs-admin`
 * route would have been reachable with no session by nothing more than
 * its name. Matching on the segment boundary — the same rule
 * `isOwnerOnlyRoute` above already uses — keeps the list meaning exactly
 * what it says.
 */
export function isPublicRoute(path: string): boolean {
  return PUBLIC_PATHS.some(
    (publicPath) => path === publicPath || path.startsWith(`${publicPath}/`)
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
