-- Auto Batt Inventory — add vehicle fields to items table
-- Add four nullable columns (make_id, model, variant, year) to track item-vehicle associations.
--
-- Note: No new grant migration needed here. The items table already carries a table-level
-- (not column-restricted) grant to both `authenticated` and `service_role` from migrations
-- 0013_authenticated_base_grants.sql (line 55) and 0014_service_role_base_grants.sql (line 77).
-- Postgres's table-level GRANT automatically covers columns added later via ALTER TABLE,
-- so these new columns are readable/writable by both roles immediately.
--
-- Note: No new UPDATE policy needed here. The items_update_authenticated policy in
-- 0005_items_rls.sql already permits any authenticated user to UPDATE an item, covering
-- these new columns as well. Task 3's updateItem function will rely on this existing policy.

alter table items
  add column make_id uuid references car_makes (id),
  add column model text,
  add column variant text,
  add column year integer;
