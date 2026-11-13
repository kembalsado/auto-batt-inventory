-- Auto Batt Inventory — app_settings RLS
-- app_settings is the single global settings row (Task 2): any
-- authenticated user needs to read it — `canSeeCost` (lib/permissions.ts)
-- has to check `show_cost_to_assistant` for an assistant caller too, not
-- just the owner — but only the owner may change it. The update policy
-- reuses `is_owner()` (defined in 0002_auth_profiles.sql) rather than
-- re-deriving the owner check, following the pattern set by audit_log's
-- owner-only select policy (0003_audit_log_rls.sql).

-- RLS: any authenticated user can read app_settings.
create policy "app_settings_select_authenticated"
  on app_settings for select
  to authenticated
  using (true);

-- RLS: only an owner can update app_settings.
create policy "app_settings_update_owner"
  on app_settings for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));
