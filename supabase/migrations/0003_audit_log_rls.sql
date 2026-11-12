-- Auto Batt Inventory — audit_log RLS
-- audit_log is append-only: any authenticated user may insert (every
-- mutating action records one via lib/audit.ts), but only an owner may
-- read it back (Task 15's Activity screen).

-- RLS: any authenticated user can insert an audit_log row.
create policy "audit_log_insert_authenticated"
  on audit_log for insert
  to authenticated
  with check (true);

-- RLS: only an owner can read audit_log rows. Reuses is_owner() (defined in
-- 0002_auth_profiles.sql) rather than querying `profiles` directly from
-- this policy's USING clause — that would be a self-referencing query on a
-- different table, not audit_log, but is_owner() already exists precisely
-- to avoid re-deriving this check and the recursion pitfall it was written
-- to dodge.
create policy "audit_log_select_owner"
  on audit_log for select
  to authenticated
  using (is_owner(auth.uid()));
