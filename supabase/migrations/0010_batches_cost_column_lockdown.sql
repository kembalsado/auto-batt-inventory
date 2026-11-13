-- Auto Batt Inventory — batches cost column lockdown
-- Code review on Task 11 found that `batches_select_authenticated`
-- (0006_record_stock_in.sql) is a ROW-level RLS policy with
-- `using (true)` — it says nothing about which COLUMNS an authenticated
-- caller may read. That meant an assistant could bypass the app entirely
-- and hit PostgREST directly (e.g. `GET /rest/v1/batches?select=*` with
-- their own session token) and read raw `unit_cost` even when
-- `getItemBatchesForViewer` (lib/items.ts) would have stripped it for
-- them. RLS and column privileges are separate Postgres mechanisms;
-- closing the row-level door was never enough to close a column-level
-- leak — the same class of "close it at the database layer, not just in
-- app code" problem Task 8 already hit once (anon calling record_stock_in
-- directly via RPC).
--
-- Fix, in two parts:
--
-- 1. Revoke blanket table-level SELECT on `batches` from anon/
--    authenticated, then re-grant SELECT on every column EXCEPT
--    `unit_cost`. A column-level REVOKE alone isn't enough: Postgres
--    checks column access as the UNION of the table-level grant and any
--    column-level grant, so `revoke select (unit_cost) on batches from
--    authenticated` on top of an existing blanket `grant select on
--    batches to authenticated` is a no-op — confirmed live (see
--    task-11-report.md's "first attempt" note). The table-level grant has
--    to go first; only then does omitting `unit_cost` from the
--    column-level re-grant actually withhold it.
--
-- 2. Expose `unit_cost` only through `batches_for_viewer`, a view that
--    nulls it out per row via `can_see_cost(auth.uid())` — the same rule
--    as `canSeeCost(role, settings)` in lib/permissions.ts (owner always;
--    assistant only when app_settings.show_cost_to_assistant is true).
--    `lib/items.ts`'s `getItemBatchesForViewer` queries this view instead
--    of `batches` directly, so the app-layer code and the database-layer
--    enforcement read from the same place and can't disagree.
--
-- The view's own internal query against `batches` runs with the view
-- *owner's* privileges for table access (classic Postgres view ACL
-- semantics — this is unrelated to SECURITY DEFINER, which only applies
-- to functions), so it can still read the real `unit_cost` to decide
-- whether to expose it; only the CASE expression's *output*, gated by the
-- actual querying session's auth.uid(), is affected by the column revoke
-- below.
--
-- This closes the hole regardless of code path, including the SECURITY
-- DEFINER functions: `record_stock_in`/`record_stock_out` (0006/0007) run
-- as their function owner when inserting into `batches`, not as
-- `authenticated`, so revoking authenticated's SELECT on `unit_cost`
-- doesn't affect their INSERTs (verified against the full test suite —
-- see task-11-report.md).
--
-- Note this revoke applies to the `authenticated` Postgres role as a
-- whole — Postgres has no per-user column grants, and owner vs. assistant
-- is only an app-level distinction (profiles.role), not a different
-- Postgres role. So an OWNER'S direct query against the raw `batches`
-- table for `unit_cost` is blocked too now, same as an assistant's — the
-- owner (and anyone else) must go through `batches_for_viewer` to read
-- cost, never the raw table. That's intentional: it's what makes this a
-- real database-layer guarantee rather than a rule only `authenticated`
-- users without the owner's special-case needed to respect.

-- can_see_cost: whether `user_id` may see batch cost data. True for an
-- owner always; otherwise true only when the owner has opted in via
-- app_settings.show_cost_to_assistant. Mirrors canSeeCost(role, settings)
-- in lib/permissions.ts, evaluated here so the database itself enforces
-- it, not just application code. SECURITY DEFINER + pinned search_path,
-- following is_owner()'s pattern (0002_auth_profiles.sql), since it reads
-- app_settings and calls is_owner() internally.
create function can_see_cost(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    is_owner(user_id)
    or coalesce(
      (select show_cost_to_assistant from app_settings where id = 1),
      false
    );
$$;

-- Lock down who can call it directly — same reasoning as
-- record_stock_in's lockdown in 0006: a SECURITY DEFINER function is
-- PUBLIC-executable by default via Supabase's default-privilege grant to
-- anon/authenticated. Only `authenticated` needs EXECUTE (to evaluate
-- batches_for_viewer's CASE expression below) — service_role never
-- queries that view, since it reads `batches` directly and keeps full
-- column access, untouched by this migration.
revoke execute on function can_see_cost(uuid) from public, anon;
grant execute on function can_see_cost(uuid) to authenticated;

-- Revoke the blanket table-level SELECT grant, then re-grant SELECT on
-- every column except unit_cost. INSERT/UPDATE/REFERENCES privileges are
-- untouched — only SELECT is being narrowed here.
revoke select on batches from anon, authenticated;
grant select (
  id, item_id, batch_date, qty_received, qty_remaining, source, note,
  created_by, created_at
) on batches to anon, authenticated;

-- batches_for_viewer: the only way `authenticated` can read `unit_cost`
-- going forward — null when the querying session can't see cost, the
-- real value otherwise.
create view batches_for_viewer as
select
  id,
  item_id,
  batch_date,
  qty_received,
  qty_remaining,
  case
    when can_see_cost(auth.uid()) then unit_cost
    else null
  end as unit_cost,
  source,
  note,
  created_by,
  created_at
from batches;

grant select on batches_for_viewer to authenticated;
