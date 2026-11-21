-- Auto Batt Inventory — owner-only update/delete for categories and car_makes
--
-- 0004_categories_rls.sql and 0016_car_makes.sql deliberately shipped with
-- only select+insert policies ("Renaming/deleting isn't supported yet").
-- This adds update+delete, gated to the owner role only (unlike
-- select/insert, which stay open to any authenticated user) — reusing
-- is_owner() (0002_auth_profiles.sql), the same helper
-- app_settings_update_owner (0009_app_settings_rls.sql) already uses for
-- an identical "read is open, write is owner-only" shape. Base table
-- grants for update/delete already exist on both tables
-- (0013_authenticated_base_grants.sql, 0018_car_makes_grants.sql) — only
-- the RLS policy was missing.

create policy "categories_update_owner"
  on categories for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));

create policy "categories_delete_owner"
  on categories for delete
  to authenticated
  using (is_owner(auth.uid()));

create policy "car_makes_update_owner"
  on car_makes for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));

create policy "car_makes_delete_owner"
  on car_makes for delete
  to authenticated
  using (is_owner(auth.uid()));
