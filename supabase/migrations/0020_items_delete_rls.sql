-- Auto Batt Inventory — items delete RLS
--
-- 0005_items_rls.sql deliberately shipped with no delete policy
-- ("Delete isn't supported (YAGNI...)"). This adds it now that a Delete
-- Item feature exists, open to any authenticated user — matching
-- items_select_authenticated/items_insert_authenticated/
-- items_update_authenticated (0005), not the owner-only shape
-- 0019_categories_car_makes_update_delete_rls.sql used for
-- categories/car_makes, since item edit (and now delete) was never
-- owner-restricted. The base DELETE grant to `authenticated` already
-- exists (0013_authenticated_base_grants.sql) — only the RLS policy was
-- missing. batches.item_id / stock_movements.item_id still reference
-- items with no cascade, so this policy alone doesn't make delete
-- unsafe: the database's foreign-key constraint still blocks deleting
-- an item that has stock history, independent of RLS.

create policy "items_delete_authenticated"
  on items for delete
  to authenticated
  using (true);
