-- Auto Batt Inventory — backfill existing items' vehicle data into item_fitments
-- Copies every item that carries any vehicle data in the four columns
-- 0017_items_vehicle_columns.sql added (`make_id`, `model`, `variant`,
-- `year`) into one `item_fitments` row — that item's single, first (and
-- for now only) vehicle fitment tag. Nothing an existing user entered is
-- lost or has to be re-entered; an item with all four columns null simply
-- gets no tag, which is the correct representation of "untagged".
--
-- `year` maps to BOTH `year_from` and `year_to`: a single year is stored
-- as a closed range whose ends are equal, the convention
-- `lib/item-fitments.ts`'s `formatFitment` reads to render "2018" rather
-- than "2018–2018". An item with a null `year` keeps nulls on both sides.
--
-- Deliberately split from dropping those four columns (now
-- 0024_drop_item_vehicle_columns.sql): this project's migrations are
-- applied as a MANUAL step, separate from deploying application code (see
-- README). Combining a backfill with the column drops left no safe
-- ordering — either the old code queries columns that are already gone,
-- or the new code queries a table that is not populated yet. Split, there
-- is one: apply THIS migration first (it only adds rows; both the old and
-- the new code keep working, since the old columns are still there and
-- still authoritative for the old code), then deploy the application code
-- that reads `item_fitments`, then apply 0024 to drop the dead columns.
--
-- Not re-runnable: running it twice would duplicate every backfilled tag,
-- since nothing here is keyed on an existing row. It is a one-shot
-- migration applied exactly once per environment, which is how
-- supabase_migrations tracks it; it is called out only so nobody
-- hand-reruns the statement during the window before 0024 lands.

insert into item_fitments (item_id, make_id, model, variant, year_from, year_to)
select id, make_id, model, variant, year, year
from items
where make_id is not null or model is not null or variant is not null or year is not null;
