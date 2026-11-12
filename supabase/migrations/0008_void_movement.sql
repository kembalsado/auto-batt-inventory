-- Auto Batt Inventory — void / correction
-- void_movement() reverses a mistaken IN or OUT entry without deleting it:
-- the movement row stays (voided_at/voided_by get set) and whatever batch
-- quantity it affected is put back the way it was. The correct replacement
-- entry, if any, is just a normal new IN/OUT recorded afterward by the
-- user — this function does not create one (no reverses_movement_id
-- linking; YAGNI per the plan).
--
-- Same audit-inside-the-transaction and SECURITY DEFINER/search_path/
-- explicit-anon-revoke precedent as 0006/0007 — see those files' header
-- comments for the full rationale, not repeated here.
--
-- Concurrency:
--
-- * Already-voided race: the movement row is locked (`for update`) before
--   anything else. Two concurrent void_movement calls for the same
--   movement_id can't both proceed past that lock — the second one blocks
--   until the first commits, then re-reads the now-voided row and hits the
--   "already voided" check. Voiding is therefore not repeatable, by design.
--
-- * Voiding an IN whose batch a concurrent OUT might be selling from: after
--   locking the movement, we also lock the batch row (`for update`) before
--   checking qty_remaining = qty_received. If record_stock_out (0007)
--   already holds that batch's lock as part of its own FIFO scan, this
--   function blocks until that OUT transaction commits, then re-reads the
--   batch's post-commit qty_remaining — if it dropped below qty_received,
--   we correctly reject with "already been sold" rather than zeroing out
--   stock that's now spoken for. Conversely, if void_movement locks and
--   zeroes the batch first, a concurrent record_stock_out's own `for
--   update` scan (which filters on qty_remaining > 0) re-evaluates that
--   filter against the post-commit row via Postgres's EvalPlanQual
--   mechanism and simply excludes the now-zeroed batch — no oversell.
--
-- * Voiding an OUT (always safe — restoring stock only ever increases
--   availability): each batch the original OUT drew from is locked `for
--   update`, in the same batch_date/id order record_stock_out itself uses,
--   before being incremented. Matching that lock order avoids introducing
--   a new deadlock opportunity against a concurrent sale on the same item.
create function void_movement(
  p_movement_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement record;
  v_batch record;
  r_alloc record;
  v_sku text;
begin
  select * into v_movement
  from stock_movements
  where id = p_movement_id
  for update;

  if not found then
    raise exception 'void_movement: movement not found';
  end if;

  if v_movement.voided_at is not null then
    raise exception 'already voided';
  end if;

  select sku into v_sku from items where id = v_movement.item_id;

  if v_movement.type = 'IN' then
    if v_movement.batch_id is null then
      raise exception 'void_movement: IN movement has no linked batch';
    end if;

    select * into v_batch
    from batches
    where id = v_movement.batch_id
    for update;

    if v_batch.qty_remaining <> v_batch.qty_received then
      raise exception 'this item has already been sold from this batch';
    end if;

    update batches
    set qty_remaining = 0
    where id = v_batch.id;
  else
    -- OUT: restore every batch this movement drew from. Locked oldest-first
    -- (batch_date asc, id asc), matching record_stock_out's own lock order.
    for r_alloc in
      select ma.batch_id, ma.qty_allocated
      from movement_allocations ma
      join batches b on b.id = ma.batch_id
      where ma.movement_id = p_movement_id
      order by b.batch_date asc, b.id asc
      for update of b
    loop
      update batches
      set qty_remaining = qty_remaining + r_alloc.qty_allocated
      where id = r_alloc.batch_id;
    end loop;
  end if;

  update stock_movements
  set voided_at = now(), voided_by = p_actor_id
  where id = p_movement_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    p_actor_id,
    'movement.voided',
    'stock_movement',
    p_movement_id,
    'VOID ' || v_movement.type || ' ' || v_movement.quantity || 'x ' || coalesce(v_sku, v_movement.item_id::text)
  );
end;
$$;

-- Lock down who can call it, same explicit-anon-revoke requirement as
-- 0006/0007: Supabase's local init scripts grant `anon` its own EXECUTE
-- privilege via ALTER DEFAULT PRIVILEGES, independent of PUBLIC, so a bare
-- `revoke ... from public` would NOT be enough to block anon.
revoke execute on function void_movement(uuid, uuid) from public, anon;
grant execute on function void_movement(uuid, uuid) to authenticated;
