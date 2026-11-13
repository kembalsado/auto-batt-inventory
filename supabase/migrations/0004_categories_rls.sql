-- Auto Batt Inventory — categories RLS
-- Categories are a shared lookup list, not owner-restricted data: any
-- authenticated user (owner or assistant) can read the list and add a
-- new category. Renaming/deleting isn't supported yet (YAGNI — not in
-- this task's scope), so no update/delete policy exists.

-- RLS: any authenticated user can read categories.
create policy "categories_select_authenticated"
  on categories for select
  to authenticated
  using (true);

-- RLS: any authenticated user can insert a category.
create policy "categories_insert_authenticated"
  on categories for insert
  to authenticated
  with check (true);
