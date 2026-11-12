-- Auto Batt Inventory — record stock OUT (FIFO allocation)
-- RLS for movement_allocations (shared ledger data, same pattern as
-- batches/stock_movements in 0006), plus the record_stock_out() function
-- that atomically allocates a sale across the oldest available batches
-- first (FIFO), decrementing qty_remaining, inserting one
-- movement_allocations row per batch touched, inserting the OUT
-- stock_movements row, and the audit_log row for it — all in one
-- transaction, following record_stock_in's precedent (see 0006's header
-- note) of keeping the audit write inside the SQL function body.

-- RLS: any authenticated user can read movement_allocations.
create policy "movement_allocations_select_authenticated"
  on movement_allocations for select
  to authenticated
  using (true);

-- RLS: any authenticated user can insert a movement_allocations row.
-- (record_stock_out's own insert runs as the function owner via
-- SECURITY DEFINER and doesn't need this policy to succeed — this exists
-- for any future direct insert path, same rationale as 0006.)
create policy "movement_allocations_insert_authenticated"
  on movement_allocations for insert
  to authenticated
  with check (true);

-- record_stock_out: allocates p_qty units of p_item_id from its batches,
-- strictly oldest-first (batch_date asc, id asc as tiebreak), across as
-- many batches as needed.
--
-- Concurrency: the first loop below locks every candidate batch row
-- (`FOR UPDATE`) and sums qty_remaining BEFORE deciding whether there's
-- enough stock. That lock is held for the rest of this transaction. If a
-- second call for the same item is already running concurrently, it either
-- already holds the lock on these rows (so THIS call blocks until that
-- transaction commits/rolls back, then re-reads post-commit values) or it
-- is about to try to acquire the same lock and will block behind this one.
-- Either way, the two transactions are forced to run their
-- read-sum-decide-decrement sequence one after the other, never
-- interleaved — so two concurrent callers can never both read "10
-- available" and each successfully allocate 7, jointly overselling by 4.
--
-- Raises 'insufficient stock' (and rolls back the whole transaction — no
-- partial allocation survives) when the sum of locked batches'
-- qty_remaining is less than p_qty.
--
-- SECURITY DEFINER with a pinned search_path, following record_stock_in's
-- pattern, so it runs with elevated privilege for the inserts while
-- remaining safely callable by any authenticated user via supabase.rpc(...).
create function record_stock_out(
  p_item_id uuid,
  p_qty numeric,
  p_movement_date date,
  p_note text,
  p_actor_id uuid
)
returns table (movement_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_id uuid;
  v_sku text;
  v_available numeric := 0;
  v_remaining_to_allocate numeric;
  v_take numeric;
  r_batch record;
  -- Captured once, during the single locking pass below, so the
  -- allocation walk afterward never re-queries `batches` — it can only
  -- ever see the exact row set (and exact qty_remaining/unit_cost values)
  -- that was locked, never a batch inserted concurrently in between.
  v_batch_ids uuid[] := '{}';
  v_batch_qtys numeric[] := '{}';
  v_batch_costs numeric[] := '{}';
begin
  if p_qty <= 0 then
    raise exception 'record_stock_out: qty must be positive';
  end if;

  select sku into v_sku from items where id = p_item_id;

  -- Lock every candidate batch row, oldest-first, and capture each one's
  -- id/qty_remaining/unit_cost while summing what's available. This lock
  -- is what makes concurrent callers safe (see function comment above).
  for r_batch in
    select id, qty_remaining, unit_cost
    from batches
    where item_id = p_item_id
      and qty_remaining > 0
    order by batch_date asc, id asc
    for update
  loop
    v_available := v_available + r_batch.qty_remaining;
    v_batch_ids := array_append(v_batch_ids, r_batch.id);
    v_batch_qtys := array_append(v_batch_qtys, r_batch.qty_remaining);
    v_batch_costs := array_append(v_batch_costs, r_batch.unit_cost);
  end loop;

  if v_available < p_qty then
    raise exception 'insufficient stock: % available, % requested', v_available, p_qty;
  end if;

  insert into stock_movements (
    item_id, type, quantity, batch_id, movement_date, note, created_by
  )
  values (
    p_item_id, 'OUT', p_qty, null, p_movement_date, p_note, p_actor_id
  )
  returning id into v_movement_id;

  v_remaining_to_allocate := p_qty;

  -- Walk the captured FIFO-ordered rows, actually allocating. No further
  -- SELECT against `batches` happens here, so this can't pick up a row
  -- that wasn't part of the locked set above.
  for i in 1 .. array_length(v_batch_ids, 1)
  loop
    exit when v_remaining_to_allocate <= 0;

    v_take := least(v_batch_qtys[i], v_remaining_to_allocate);

    update batches
    set qty_remaining = qty_remaining - v_take
    where id = v_batch_ids[i];

    insert into movement_allocations (
      movement_id, batch_id, qty_allocated, unit_cost_at_allocation
    )
    values (
      v_movement_id, v_batch_ids[i], v_take, v_batch_costs[i]
    );

    v_remaining_to_allocate := v_remaining_to_allocate - v_take;
  end loop;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    p_actor_id,
    'movement.created',
    'stock_movement',
    v_movement_id,
    'OUT ' || p_qty || 'x ' || coalesce(v_sku, p_item_id::text)
  );

  return query select v_movement_id;
end;
$$;

-- Lock down who can call it, same reasoning and same explicit-anon-revoke
-- requirement as 0006_record_stock_in.sql: Supabase's local init scripts
-- grant `anon` its own EXECUTE privilege via ALTER DEFAULT PRIVILEGES,
-- independent of PUBLIC, so a bare `revoke ... from public` would NOT be
-- enough to block anon.
revoke execute on function record_stock_out(uuid, numeric, date, text, uuid) from public, anon;
grant execute on function record_stock_out(uuid, numeric, date, text, uuid) to authenticated;
