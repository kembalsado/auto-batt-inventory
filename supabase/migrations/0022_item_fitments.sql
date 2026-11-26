-- Auto Batt Inventory — item_fitments table, RLS and grants
-- One row per vehicle fitment tag on an item: an item (a battery, an oil
-- filter) commonly fits several different vehicles, which the single
-- make_id/model/variant/year columns on `items` (0017_items_vehicle_columns.sql)
-- could not express. Production data had already worked around that by
-- cramming five vehicle names into one item's free-text `model` column.
-- Those four columns are backfilled into this table by
-- 0023_backfill_item_fitments.sql and dropped by
-- 0024_drop_item_vehicle_columns.sql.
--
-- Shape: `make_id` references `car_makes` (the same shared lookup table
-- `items.make_id` referenced) and stays nullable, as do model/variant —
-- a tag only needs one of its fields filled to be useful, and the
-- editor/parser enforce "not entirely blank" rather than requiring any
-- particular field. `year_from`/`year_to` are a closed range, with both
-- set to the same value for a single-year fitment (lib/item-fitments.ts's
-- formatFitment relies on that convention to render "2018" rather than
-- "2018–2018"). Model and variant deliberately stay free text with
-- <datalist> autocomplete rather than becoming lookup tables — see the
-- design doc's non-goals.
--
-- `on delete cascade` on `item_id`: a fitment tag is wholly owned by its
-- item and has no meaning without it, so deleting an item takes its tags
-- with it. This is the only cascade on `items` — `batches.item_id` and
-- `stock_movements.item_id` deliberately have none, so that an item with
-- real stock history still cannot be deleted. `make_id` has NO cascade
-- (nor `set null`), which is what makes the database reject deleting a
-- car make that is still referenced by any item's tag — the protection
-- `lib/car-makes.ts`'s `deleteCarMake` relies on, previously provided by
-- the FK on `items.make_id`.
--
-- RLS mirrors `items` (0005_items_rls.sql): any authenticated user may
-- read, insert, update and delete. Unlike `car_makes`, update/delete
-- policies are needed here from the start — editing an item replaces its
-- whole tag set (`replaceFitmentsForItem`), which inserts and deletes rows.
--
-- Explicit base table grants are included in this same migration rather
-- than deferred: Postgres checks base privileges BEFORE RLS, so a correct
-- policy with no grant is unreachable (error 42501). Local dev auto-grants
-- every new table and so hides this — exactly the local/production
-- mismatch 0018_car_makes_grants.sql was written to fix after `car_makes`
-- shipped without grants. Nothing is granted to `anon`: every dashboard
-- route requires a session.

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
