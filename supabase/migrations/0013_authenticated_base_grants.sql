-- Auto Batt Inventory — explicit base table grants for `authenticated`
--
-- Every table-level policy in this project's prior migrations (0003-0009)
-- assumes `authenticated` already holds the base SQL privilege the policy
-- is meant to narrow — e.g. `items_select_authenticated ... for select to
-- authenticated using (true)` only matters if `authenticated` can SELECT
-- from `items` at all. Locally, Supabase's dev stack grants SELECT/
-- INSERT/UPDATE/DELETE on every new public table to `anon`/`authenticated`
-- automatically, so this was never missing in local testing. On a real
-- Supabase project created with "Automatically expose new tables"
-- unchecked (the deliberately-chosen, more secure setting — see the
-- design doc's ruling on this), that automatic grant never happens, and
-- every one of this project's own RLS policies becomes unreachable: a
-- query fails with `permission denied for table X` (Postgres error
-- 42501) before RLS is ever evaluated, regardless of how correct the
-- policy is.
--
-- This migration is the missing piece: explicit base grants to
-- `authenticated` on every application table, with RLS continuing to be
-- the real fine-grained gate exactly as every prior migration already
-- assumed. Nothing is granted to `anon` — this app requires a session for
-- every dashboard route (middleware.ts) and was never designed to let an
-- anonymous caller reach any table directly; granting `anon` here would
-- reopen exactly the class of hole Tasks 8-11 spent real effort closing
-- on the RPC functions and the cost-bearing columns.
--
-- Two tables are deliberately NOT given the same blanket treatment,
-- because a blanket `grant select` would silently undo work done after
-- 0009 to narrow exactly this kind of default-open grant:
--
-- * `batches` — 0010 already revoked the table-level SELECT this
--   migration would otherwise (re-)grant and replaced it with a
--   column-level one that excludes `unit_cost`. Adding `select` here on
--   top of that would re-grant the whole row, `unit_cost` included —
--   the exact leak 0010 closed. `batches` still needs the base INSERT/
--   UPDATE/DELETE grants below: `lib/import.ts`'s opening-stock import
--   inserts batch rows directly (not through `record_stock_in`), and its
--   `deletePartialRow` cleanup path depends on a base DELETE grant
--   existing so a cleanup an RLS policy doesn't permit comes back as "0
--   rows affected" rather than a 42501 the caller never expected.
--
-- * `movement_allocations` — 0011 revoked SELECT entirely and dropped
--   the row-level policy backing it, on the finding that no application
--   code reads this table directly at all; every real caller
--   (`record_stock_out`, `void_movement`) is a SECURITY DEFINER function
--   that reads and writes it as the function owner, never as
--   `authenticated`. There is no real caller to grant anything to here,
--   so it is left out of this migration entirely rather than granting
--   privileges nothing uses.
--
-- Safe to re-run: GRANT is idempotent, and on environments where the
-- privilege already exists (local dev) this is a no-op.
grant select, insert, update, delete on
  categories,
  items,
  stock_movements,
  app_settings,
  profiles,
  audit_log
to authenticated;

grant insert, update, delete on batches to authenticated;
