import { createServerClient } from "@/lib/supabase/server";
import { listAuditLog } from "@/lib/activity";
import { listItems } from "@/lib/items";

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
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
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
            className="rounded-md border border-border px-3 py-2 text-sm"
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
            className="rounded-md border border-border px-3 py-2 text-sm"
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
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="">All actions</option>
            {ACTIONS.map((actionValue) => (
              <option key={actionValue} value={actionValue}>
                {actionValue}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
        >
          Filter
        </button>
        {hasFilters && (
          <a
            href="/activity"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-accent"
          >
            Clear
          </a>
        )}
      </form>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 font-medium">Date</th>
            <th className="py-2 font-medium">Action</th>
            <th className="py-2 font-medium">Summary</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry) => (
            <tr key={entry.id} className="text-brand-ink">
              <td className="py-2">{formatDate(entry.createdAt)}</td>
              <td className="py-2">{entry.action}</td>
              <td className="py-2">{entry.summary}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={3} className="py-2 text-sm text-muted-foreground">
                No activity yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
