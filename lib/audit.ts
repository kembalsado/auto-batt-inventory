import type { SupabaseClient } from "@supabase/supabase-js";

/** Fields for one `audit_log` row. See supabase/migrations/0001_init.sql. */
export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * Records one audit_log row for a mutating action. Every later mutating
 * task (item/batch/movement create, settings change, etc.) calls this
 * after its write succeeds.
 *
 * `supabase` can be any authenticated client (RLS allows any authenticated
 * user to insert) — callers pass the server/admin client they already
 * have for the surrounding request.
 */
export async function recordAudit(
  supabase: SupabaseClient,
  entry: AuditEntry
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    summary: entry.summary,
    details: entry.details,
  });

  if (error) {
    throw error;
  }
}
