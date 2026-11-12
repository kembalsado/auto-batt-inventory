-- Auto Batt Inventory — items RLS
-- Items are the shared catalog of trackable SKUs, not owner-restricted
-- data: any authenticated user (owner or assistant) can read the list,
-- add a new item, and update one (e.g. deactivating it in a later task).
-- Delete isn't supported (YAGNI — not in this task's scope, and items are
-- referenced by batches/stock_movements), so no delete policy exists.

-- RLS: any authenticated user can read items.
create policy "items_select_authenticated"
  on items for select
  to authenticated
  using (true);

-- RLS: any authenticated user can insert an item.
create policy "items_insert_authenticated"
  on items for insert
  to authenticated
  with check (true);

-- RLS: any authenticated user can update an item.
create policy "items_update_authenticated"
  on items for update
  to authenticated
  using (true)
  with check (true);
