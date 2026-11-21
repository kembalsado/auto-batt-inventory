import type { SupabaseClient } from "@supabase/supabase-js";

// The fixed set of `action` values any mutating task writes (see
// lib/categories.ts, lib/car-makes.ts, lib/items.ts, lib/settings.ts, and
// the SQL functions in supabase/migrations/0006-0008 for
// record_stock_in/record_stock_out/void_movement). Listed explicitly,
// rather than derived from a `select distinct` query, so the filter always
// offers every known action type even on a freshly-seeded, near-empty
// audit_log. See tests/lib/activity-actions.test.ts, which greps every
// lib/*.ts file's `recordAudit` calls and fails if one isn't listed here —
// added after this list was caught missing entries at final review three
// times running.
export const ACTIONS = [
  "item.created",
  // Written by updateItem (lib/items.ts) for the item edit form — missing
  // from this list until the branch-wide review, same gap "user.created"
  // below once had: the rows were being recorded but unfilterable.
  "item.updated",
  "category.created",
  // Written by updateCategory (lib/categories.ts) for the Categories
  // page's inline rename — missing from this list until the final review,
  // same gap as item.updated/user.created above.
  "category.updated",
  // Written by deleteCategory (lib/categories.ts) for the Categories
  // page's delete action — missing from this list until the final review,
  // same gap as item.updated/user.created above.
  "category.deleted",
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
  // Written by createCarMake (lib/car-makes.ts) for the Makes management
  // page's "Add make" action.
  "car_make.created",
  // Written by updateCarMake (lib/car-makes.ts) for the Makes page's
  // inline rename — missing from this list until the final review, same
  // gap as item.updated/user.created above.
  "car_make.updated",
  // Written by deleteCarMake (lib/car-makes.ts) for the Makes page's
  // delete action — missing from this list until the final review, same
  // gap as item.updated/user.created above.
  "car_make.deleted",
];

/**
 * One `audit_log` row as read back for the Activity screen (Task 14). See
 * supabase/migrations/0001_init.sql for the table, and `AuditEntry` in
 * lib/audit.ts for the write-side shape this mirrors (plus `id`/`createdAt`,
 * which only exist once a row has actually been written).
 */
export interface AuditLogEntry {
  id: string;
  /**
   * Nullable because `audit_log.actor_id` is (supabase/migrations/
   * 0001_init.sql). Going forward it can't be null —
   * 0012_audit_log_actor_check.sql's `actor_id = auth.uid()` insert
   * policy rejects a null actor — but historical rows written before
   * that, and service-role writes, are not constrained by it.
   */
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Optional filters for `listAuditLog`. `itemId` narrows activity down to
 * everything that happened to one item — see `listAuditLog` for why that
 * is not simply `entity_id = itemId`.
 */
export interface AuditLogFilters {
  itemId?: string;
  actorId?: string;
  action?: string;
  /** Case-insensitive substring match against `summary`, server-side (`ilike`) rather than
   * fetched-then-filtered, since this table is append-only and can grow unbounded. */
  q?: string;
}

/**
 * Collects every `audit_log.entity_id` value that represents activity on
 * `itemId`.
 *
 * `audit_log` has no `item_id` column — just a polymorphic
 * (`entity_type`, `entity_id`) pair — and the two entity types that
 * concern an item reference it differently:
 *
 *   * `entity_type = 'item'` rows (item.created, lib/items.ts) carry the
 *     ITEM's id.
 *   * `entity_type = 'stock_movement'` rows (movement.created /
 *     movement.voided, written by record_stock_in, record_stock_out and
 *     void_movement in supabase/migrations/0006-0008, plus the opening-
 *     stock import in lib/import.ts) carry the MOVEMENT's id.
 *
 * Filtering on `entity_id = itemId` therefore only ever matched that one
 * `item.created` row and never a single IN, OUT or void — which made the
 * Activity screen's item filter look like the item had no history at
 * all. Resolving the item's movement ids first and matching on the union
 * is what actually answers "what happened to this item".
 *
 * Deliberately not solved with a schema change: `entity_id` pointing at
 * the entity the action was performed ON is the right convention, the
 * audit rows written by the SQL functions are correct as they stand, and
 * one extra indexed lookup per filtered page view is cheaper than a
 * migration plus a backfill.
 */
async function entityIdsForItem(
  supabase: SupabaseClient,
  itemId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id")
    .eq("item_id", itemId);

  if (error) {
    throw error;
  }

  return [itemId, ...(data ?? []).map((movement) => movement.id as string)];
}

/**
 * Lists `audit_log` rows, newest first, optionally narrowed by item,
 * actor, or action.
 *
 * `itemId` matches both the item's own audit rows and those of every
 * movement recorded against it — see `entityIdsForItem` above.
 *
 * Does no owner check itself: RLS (`audit_log_select_owner`,
 * supabase/migrations/0003_audit_log_rls.sql) already restricts reads to
 * the owner role, so a non-owner caller naturally gets back `[]` here.
 */
export async function listAuditLog(
  supabase: SupabaseClient,
  filters: AuditLogFilters = {}
): Promise<AuditLogEntry[]> {
  let query = supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.itemId) {
    query = query.in("entity_id", await entityIdsForItem(supabase, filters.itemId));
  }
  if (filters.actorId) {
    query = query.eq("actor_id", filters.actorId);
  }
  if (filters.action) {
    query = query.eq("action", filters.action);
  }
  if (filters.q) {
    query = query.ilike("summary", `%${filters.q}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    details: row.details,
    createdAt: row.created_at,
  }));
}
