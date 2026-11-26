create table item_fitments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  make_id uuid references car_makes (id),
  model text,
  variant text,
  year_from integer,
  year_to integer,
  created_at timestamptz not null default now()
);

alter table item_fitments enable row level security;

create policy "item_fitments_select_authenticated" on item_fitments for select to authenticated using (true);
create policy "item_fitments_insert_authenticated" on item_fitments for insert to authenticated with check (true);
create policy "item_fitments_update_authenticated" on item_fitments for update to authenticated using (true) with check (true);
create policy "item_fitments_delete_authenticated" on item_fitments for delete to authenticated using (true);

grant select, insert, update, delete on item_fitments to authenticated;
grant select, insert, update, delete on item_fitments to service_role;
