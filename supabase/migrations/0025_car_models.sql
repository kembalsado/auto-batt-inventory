-- Auto Batt Inventory — car_models table, RLS and grants
-- Car models are a lookup list scoped per make (a sibling of car_makes,
-- the way `categories` are a sibling list), so "Vios" can exist under
-- Toyota and a differently-made "Vios" would be a different row — hence
-- the unique constraint is on (make_id, name), not on name alone.
--
-- `make_id` references `car_makes` with `on delete cascade`: a model has
-- no meaning without its make, so deleting a make takes its models with
-- it rather than leaving orphaned rows or blocking the delete. This is
-- the opposite cascade choice from `item_fitments.make_id` (0022), which
-- has none — the two tables answer different questions. `lib/car-makes.ts`'s
-- `deleteCarMake` surfaces this cascade's effect in its own audit summary
-- before deleting, since the cascade itself happens inside Postgres with
-- no audit trail of its own.
--
-- Nothing references `car_models.id` — `item_fitments.model` stays free
-- text with <datalist> autocomplete sourced from this table, the same
-- Approach A design choice 0022_item_fitments.sql made for model/variant.
-- That means deleting a car model can never be rejected by a foreign-key
-- violation, unlike deleting a car make (which `item_fitments.make_id`
-- can still block).
--
-- RLS mirrors `car_makes` (0016) for select/insert (any authenticated
-- user), but adds owner-only update/delete from the start — `car_makes`
-- didn't get those until 0019_categories_car_makes_update_delete_rls.sql,
-- added after the fact; this table ships with the same policies already
-- in place.

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
