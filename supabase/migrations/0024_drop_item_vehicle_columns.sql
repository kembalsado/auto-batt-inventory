-- Auto Batt Inventory — drop the now-dead single-vehicle columns on items
-- Removes the four columns 0017_items_vehicle_columns.sql added
-- (`make_id`, `model`, `variant`, `year`). Every one of them has been
-- superseded by `item_fitments` (0022_item_fitments.sql), which holds any
-- number of vehicle fitment tags per item instead of exactly one.
--
-- APPLY THIS ONLY AFTER THE NEW APPLICATION CODE IS ALREADY LIVE.
-- This project applies migrations as a MANUAL step, separate from
-- deploying application code (see README), so the ordering is on whoever
-- runs it:
--
--   1. 0023_backfill_item_fitments.sql must have been applied already,
--      and its result confirmed — every item that had vehicle data has a
--      matching `item_fitments` row. This migration drops the ONLY copy
--      of that data; once it runs, anything 0023 failed to carry over is
--      gone for good, with no way to recover it from this database.
--   2. The application code that reads fitments from `item_fitments`
--      instead of these columns must be deployed and serving traffic.
--      Running this migration BEFORE that deploy breaks the old code
--      immediately: its queries still select `items.make_id`/`model`/
--      `variant`/`year`, and PostgREST answers a request for a column
--      that no longer exists with an error, taking out the Items list,
--      the Stock List and both of its exports, the item detail page, and
--      the Add/Edit Item forms.
--
-- Deploying the new code BEFORE this migration is applied is safe and is
-- the intended order — the new code never reads these columns, and
-- leaving them in place for a while costs nothing but the dead space.
--
-- Dropping `make_id` also drops its foreign key to `car_makes`. The
-- protection that FK provided — the database refusing to delete a car
-- make still in use, which `lib/car-makes.ts`'s `deleteCarMake` relies on
-- — is preserved by `item_fitments.make_id`'s own (non-cascading) FK to
-- `car_makes`, created in 0022. No separate migration is needed for that.

alter table items
  drop column make_id,
  drop column model,
  drop column variant,
  drop column year;
