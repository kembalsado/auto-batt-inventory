-- Auto Batt Inventory — record stock IN
-- RLS for batches/stock_movements (shared ledger data, not owner-restricted,
-- same pattern as categories/items in 0004/0005), plus the record_stock_in()
-- function that atomically creates a purchase batch and its matching IN
-- movement — the start of FIFO batch tracking.

-- RLS: any authenticated user can read batches.
create policy "batches_select_authenticated"
  on batches for select
  to authenticated
  using (true);

-- RLS: any authenticated user can insert a batch. (record_stock_in's own
-- insert runs as the function owner via SECURITY DEFINER and doesn't need
-- this policy to succeed — this exists for any future direct insert path.)
create policy "batches_insert_authenticated"
  on batches for insert
  to authenticated
  with check (true);

-- RLS: any authenticated user can read stock_movements.
create policy "stock_movements_select_authenticated"
  on stock_movements for select
  to authenticated
  using (true);

-- RLS: any authenticated user can insert a stock_movements row.
create policy "stock_movements_insert_authenticated"
  on stock_movements for insert
  to authenticated
  with check (true);

-- record_stock_in: inserts a 'purchase' batch (qty_received = qty_remaining
-- = p_qty), its matching IN stock_movements row pointing at the new batch,
-- AND the audit_log row for it, all in one transaction (one SQL function
-- body is atomic — either all three rows exist afterward or none do). The
-- audit write lives here rather than in application code so that (a) it can
-- never be committed without the stock change also being committed, and
-- (b) any caller of this RPC — not just lib/movements.ts's wrapper — gets a
-- complete audit trail for free. This is the precedent Tasks 9-10
-- (record_stock_out, void_movement) should follow too.
--
-- SECURITY DEFINER with a pinned search_path, following is_owner()'s
-- pattern in 0002_auth_profiles.sql, so it runs with elevated privilege for
-- the inserts while remaining safely callable by any authenticated user via
-- supabase.rpc(...). Every later FIFO calculation (Tasks 9-10) depends on
-- qty_remaining starting out exactly equal to qty_received.
create function record_stock_in(
  p_item_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_batch_date date,
  p_note text,
  p_actor_id uuid
)
returns table (batch_id uuid, movement_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_movement_id uuid;
  v_sku text;
begin
  if p_qty <= 0 then
    raise exception 'record_stock_in: qty must be positive';
  end if;

  if p_unit_cost < 0 then
    raise exception 'record_stock_in: unit_cost must not be negative';
  end if;

  select sku into v_sku from items where id = p_item_id;

  insert into batches (
    item_id, batch_date, qty_received, qty_remaining, unit_cost, source, note, created_by
  )
  values (
    p_item_id, p_batch_date, p_qty, p_qty, p_unit_cost, 'purchase', p_note, p_actor_id
  )
  returning id into v_batch_id;

  insert into stock_movements (
    item_id, type, quantity, batch_id, movement_date, note, created_by
  )
  values (
    p_item_id, 'IN', p_qty, v_batch_id, p_batch_date, p_note, p_actor_id
  )
  returning id into v_movement_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    p_actor_id,
    'movement.created',
    'stock_movement',
    v_movement_id,
    'IN ' || p_qty || 'x ' || coalesce(v_sku, p_item_id::text) || ' @ ₱' || p_unit_cost
  );

  return query select v_batch_id, v_movement_id;
end;
$$;

-- Lock down who can call it: SECURITY DEFINER functions bypass RLS, so
-- without this, an unauthenticated (anon) caller could insert batches/
-- movements/audit rows via RPC. A bare `revoke ... from public` is NOT
-- sufficient here — Supabase's local init scripts run
-- `alter default privileges in schema public grant execute on functions to
-- anon, authenticated, service_role`, which grants `anon` its own explicit
-- EXECUTE privilege at function-creation time, independent of PUBLIC. That
-- grant must be revoked from `anon` by name.
revoke execute on function record_stock_in(uuid, numeric, numeric, date, text, uuid) from public, anon;
grant execute on function record_stock_in(uuid, numeric, numeric, date, text, uuid) to authenticated;
