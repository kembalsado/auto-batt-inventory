import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One `audit_log` row as read back for the Activity screen (Task 14). See
 * supabase/migrations/0001_init.sql for the table, and `AuditEntry` in
 * lib/audit.ts for the write-side shape this mirrors (plus `id`/`createdAt`,
 * which only exist once a row has actually been written).
 */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Optional filters for `listAuditLog`. `itemId` filters on `entity_id` —
 * named for the common case (narrowing activity down to one item) rather
 * than generically, since that's the only entity type the Activity screen
 * offers a picker for today.
 */
export interface AuditLogFilters {
  itemId?: string;
  actorId?: string;
  action?: string;
}

/**
 * Lists `audit_log` rows, newest first, optionally narrowed by entity
 * (`itemId` -> `entity_id`), actor, or action.
 *
 * Does no owner check itself: RLS (`audit_log_select_owner`,
 * supabase/migrations/0001_init.sql, Task 5) already restricts reads to
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
    query = query.eq("entity_id", filters.itemId);
  }
  if (filters.actorId) {
    query = query.eq("actor_id", filters.actorId);
  }
  if (filters.action) {
    query = query.eq("action", filters.action);
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
