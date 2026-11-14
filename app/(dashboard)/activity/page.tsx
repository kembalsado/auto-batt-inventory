import { createServerClient } from "@/lib/supabase/server";
import { listAuditLog } from "@/lib/activity";
import { listItems } from "@/lib/items";
import { Button } from "@/components/ui/button";

// The fixed set of `action` values any mutating task writes (see
// lib/categories.ts, lib/items.ts, lib/settings.ts, and the SQL functions
// in supabase/migrations/0006-0008 for record_stock_in/record_stock_out/
// void_movement). Listed explicitly, rather than derived from a `select
// distinct` query, so the filter always offers every known action type
// even on a freshly-seeded, near-empty audit_log.
const ACTIONS = [
  "item.created",
  "category.created",
  "settings.updated",
  "movement.created",
  "movement.voided",
  // Written by createUserAsOwner (lib/users.ts) — missing from this list
  // until the final review, so the Add User screen's activity was
  // unfilterable even though the rows were being recorded.
  "user.created",
  // Written by setUserActive (lib/users.ts) for the Users table's
  // deactivate/reactivate action — added alongside it this time, not
  // after the fact like "user.created" above.
  "user.deactivated",
  "user.activated",
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * Display name for an audit row's actor.
 *
 * `profiles` holds only `id`, `full_name` and `role` — there is no email
 * column, and `auth.users` is not readable from a user session, so a
 * profile with no `full_name` falls back to a short id rather than an
 * email address. Showing something is the point: the audit log exists to
 * answer "who changed what", and this screen rendered only Date / Action
 * / Summary, so the "who" half was never on screen at all.
 */
function actorLabel(
  actorId: string | null,
  namesById: Map<string, string | null>
): string {
  if (!actorId) return "System";
  const name = namesById.get(actorId);
  if (name) return name;
  return `Unknown (${actorId.slice(0, 8)})`;
}

/**
 * Owner-only activity/audit log screen (gated by `isOwnerOnlyRoute` in the
 * dashboard layout, not re-checked here). Lists `audit_log` rows via
 * `listAuditLog` (lib/activity.ts), newest first, with filter controls for
 * item, user, and action type backed by query params — a plain GET form,
 * so filtering works without any client-side JS.
 *
 * RLS (`audit_log_select_owner`, Task 5) is the actual access control: an
 * assistant can't reach this page (the layout redirects them away before
 * it renders), and even a direct `listAuditLog` call from a non-owner
 * client returns `[]` regardless of what this page does.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; actorId?: string; action?: string }>;
}) {
  const { itemId, actorId, action } = await searchParams;
  const supabase = await createServerClient();

  const [entries, items, profilesResult] = await Promise.all([
    listAuditLog(supabase, { itemId, actorId, action }),
    listItems(supabase),
    supabase.from("profiles").select("id, full_name").order("full_name"),
  ]);

  if (profilesResult.error) {
    throw profilesResult.error;
  }
  const profiles = profilesResult.data ?? [];

  // The same profile rows already fetched for the User filter dropdown
  // double as the actor-name lookup for the table below — no extra query.
  const actorNamesById = new Map<string, string | null>(
    profiles.map((profile) => [profile.id, profile.full_name])
  );

  const hasFilters = Boolean(itemId || actorId || action);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Activity</h1>

      <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Item
          <select
            name="itemId"
            defaultValue={itemId ?? ""}
            className="h-11 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">All items</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} — {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          User
          <select
            name="actorId"
            defaultValue={actorId ?? ""}
            className="h-11 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">All users</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name ?? profile.id}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Action
          <select
            name="action"
            defaultValue={action ?? ""}
            className="h-11 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">All actions</option>
            {ACTIONS.map((actionValue) => (
              <option key={actionValue} value={actionValue}>
                {actionValue}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" size="touch">
          Filter
        </Button>
        {hasFilters && (
          <Button asChild variant="outline" size="touch">
            <a href="/activity">Clear</a>
          </Button>
        )}
      </form>

      {/* Owner-only and not named as a quick-phone-check page, unlike the
          Dashboard/Stock List/item detail — so this gets the minimum
          mobile treatment (a horizontal scroll container) rather than a
          full card reflow: the table stays intact and usable, it just
          scrolls instead of overflowing the page itself. */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">User</th>
              <th className="py-2 font-medium">Action</th>
              <th className="py-2 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((entry) => (
              <tr key={entry.id} className="text-brand-ink transition-colors hover:bg-muted/40">
                <td className="py-2">{formatDate(entry.createdAt)}</td>
                <td className="py-2">{actorLabel(entry.actorId, actorNamesById)}</td>
                <td className="py-2">{entry.action}</td>
                <td className="py-2">{entry.summary}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-sm text-muted-foreground">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
