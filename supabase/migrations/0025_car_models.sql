create table car_models (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references car_makes (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (make_id, name)
);

alter table car_models enable row level security;

create policy "car_models_select_authenticated" on car_models
  for select to authenticated using (true);
create policy "car_models_insert_authenticated" on car_models
  for insert to authenticated with check (true);
create policy "car_models_update_owner" on car_models
  for update to authenticated
  using (is_owner(auth.uid())) with check (is_owner(auth.uid()));
create policy "car_models_delete_owner" on car_models
  for delete to authenticated using (is_owner(auth.uid()));

grant select, insert, update, delete on car_models to authenticated;
grant select, insert, update, delete on car_models to service_role;
