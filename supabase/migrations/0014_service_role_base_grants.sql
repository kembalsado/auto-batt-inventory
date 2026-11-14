-- Auto Batt Inventory — explicit base table grants for `service_role`
--
-- Live bug: creating a user via the "Add user" screen (owner-only)
-- succeeded at creating the Supabase Auth account, then failed on the
-- very next step with "permission denied for table audit_log" — leaving
-- a real auth user (and its trigger-created profiles row) behind with no
-- audit trail, so retrying the same email then failed with "already
-- registered". Reported live on production; reproduced directly against
-- it after app/api/users/route.ts was fixed to stop masking the real
-- Postgres error behind a hardcoded "Failed to create user".
--
-- Root cause: 0012's comment claimed the service-role client used by
-- lib/users.ts "has BYPASSRLS — no policy is evaluated at all", and
-- treated that as reason enough not to worry about it there. That's true
-- of RLS specifically, but BYPASSRLS only skips row-level security
-- policies — it says nothing about base SQL table privileges, which are
-- a separate, earlier-checked mechanism. 0013 already documented that
-- this project's Supabase instance was created with "Automatically
-- expose new tables" unchecked, so no role — `service_role` included, it
-- turns out — gets an implicit grant on a new table. 0013 then granted
-- `authenticated` explicit base privileges but never did the same for
-- `service_role`, so every service-role write (lib/users.ts's audit_log
-- insert) or read (app/api/cron/daily-email's item/movement/settings
-- queries, via lib/email/dailySummary.ts) was only ever one query away
-- from the same 42501 error — audit_log simply happened to be the first
-- one actually exercised against production.
--
-- Scope mirrors 0013's reasoning table for table:
--
--   * categories, items, stock_movements, app_settings, profiles,
--     audit_log — same six tables 0013 granted `authenticated`, for the
--     same reason: every RLS policy on them already assumes the base
--     privilege exists, and service_role's BYPASSRLS doesn't supply it.
--     Needed today for: audit_log (INSERT, lib/users.ts), items/
--     stock_movements/app_settings (SELECT, lib/email/dailySummary.ts
--     and lib/settings.ts, both called from the daily-email cron with
--     the admin client).
--
--   * batches — deliberately NOT given the same blanket SELECT here,
--     for the identical reason 0013 excluded it for `authenticated`:
--     0010 revoked table-level SELECT and replaced it with a column list
--     that excludes `unit_cost`, specifically so `unit_cost` is only
--     ever readable through `batches_for_viewer`'s gated CASE
--     expression. A blanket `grant select` would undo that. No current
--     service-role path writes to `batches` directly (lib/import.ts's
--     opening-stock import runs under the caller's own authenticated
--     session, not the admin client), so no base DML grant is added for
--     it here either — add one if and when a real service-role write
--     path to `batches` exists, matching 0013's own "grant what's
--     actually used" discipline.
--
--   * batches_for_viewer + can_see_cost(uuid) — lib/email/
--     dailySummary.ts (shared by the daily-email cron AND the Calendar
--     page's own day-detail lookup) reads qty_remaining through this
--     view, not the raw table — 0010's comment assumed "service_role
--     never queries that view, since it reads batches directly", which
--     was true when 0010 was written but no longer matches
--     dailySummary.ts's actual query. The view's CASE expression calls
--     can_see_cost(auth.uid()); service_role needs EXECUTE on that
--     function too, or the view read itself fails even with SELECT on
--     the view granted. (auth.uid() is NULL for the service-role client,
--     so can_see_cost falls through to app_settings.show_cost_to_
--     assistant — dailySummary.ts never reads unit_cost regardless, so
--     the resolved value doesn't matter here, only that evaluating the
--     expression doesn't error.)
--
--   * movement_allocations — excluded here for the same reason 0013
--     excluded it: 0011 revoked SELECT entirely and dropped its RLS
--     policy, since the only real callers are SECURITY DEFINER functions
--     that read/write it as the function owner, service_role included.
--
-- Safe to re-run: GRANT is idempotent, and on any environment where the
-- privilege already exists (if Supabase ever changes this default) this
-- is a no-op.
grant select, insert, update, delete on
  categories,
  items,
  stock_movements,
  app_settings,
  profiles,
  audit_log
to service_role;

grant select on batches_for_viewer to service_role;
grant execute on function can_see_cost(uuid) to service_role;
