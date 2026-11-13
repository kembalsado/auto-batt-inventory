-- Auto Batt Inventory — audit_log actor integrity
--
-- 0003_audit_log_rls.sql's insert policy was `with check (true)`: any
-- authenticated user could insert an audit_log row claiming *any*
-- actor_id, or none at all. Verified live before this migration: an
-- assistant session could insert a row attributing an action to the
-- owner (or to null). The audit log exists specifically to hold the
-- assistant accountable, so being forgeable by the assistant defeats the
-- point of having it.
--
-- Tie the row to its writer: `actor_id = auth.uid()`. This also rejects
-- a null actor_id (null = auth.uid() is NULL, not true, and a WITH CHECK
-- that evaluates to NULL fails), so an anonymous-looking audit row can't
-- be inserted either.
--
-- Every existing write path is unaffected:
--
--   * lib/audit.ts's recordAudit is always called with actorId = the
--     signed-in user's own id (lib/items.ts, lib/categories.ts,
--     lib/settings.ts, lib/import.ts all resolve it from
--     supabase.auth.getUser()).
--   * lib/users.ts writes through the service-role client, which has
--     BYPASSRLS — no policy is evaluated at all.
--   * record_stock_in / record_stock_out / void_movement
--     (0006/0007/0008) insert their audit rows from inside SECURITY
--     DEFINER functions, so those inserts run as the table owner and
--     likewise skip RLS. (Their p_actor_id is supplied by the same
--     server-side callers above.)
drop policy "audit_log_insert_authenticated" on audit_log;

create policy "audit_log_insert_own_actor"
  on audit_log for insert
  to authenticated
  with check (actor_id = auth.uid());
