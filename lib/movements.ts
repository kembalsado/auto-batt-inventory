import type { SupabaseClient } from "@supabase/supabase-js";

/** Fields accepted by `recordStockIn`. */
export interface RecordStockInInput {
  itemId: string;
  qty: number;
  unitCost: number;
  /** ISO date string (YYYY-MM-DD). */
  batchDate: string;
  note?: string | null;
}

/** Result of a successful `recordStockIn` call. */
export interface RecordStockInResult {
  movementId: string;
  batchId: string;
}

/**
 * Records a stock IN: creates a new purchase batch
 * (`qty_remaining = qty_received = qty`), its matching IN movement, AND its
 * audit_log entry, all atomically via the `record_stock_in` Postgres
 * function (see supabase/migrations/0006_record_stock_in.sql). The audit
 * write happens inside that SQL function, not here — so it's part of the
 * same transaction as the stock change and can't be skipped by a caller
 * that invokes the RPC directly instead of going through this wrapper.
 *
 * This is the only producer of 'purchase' batches; FIFO allocation
 * (Task 9) and void (Task 10) consume what this creates.
 */
export async function recordStockIn(
  supabase: SupabaseClient,
  actorId: string,
  input: RecordStockInInput
): Promise<RecordStockInResult> {
  const { data, error } = await supabase
    .rpc("record_stock_in", {
      p_item_id: input.itemId,
      p_qty: input.qty,
      p_unit_cost: input.unitCost,
      p_batch_date: input.batchDate,
      p_note: input.note ?? null,
      p_actor_id: actorId,
    })
    .single();

  if (error) {
    throw error;
  }

  const result = data as { batch_id: string; movement_id: string };

  return { movementId: result.movement_id, batchId: result.batch_id };
}

/** Fields accepted by `recordStockOut`. */
export interface RecordStockOutInput {
  itemId: string;
  qty: number;
  /** ISO date string (YYYY-MM-DD). */
  movementDate: string;
  note?: string | null;
}

/** Result of a successful `recordStockOut` call. */
export interface RecordStockOutResult {
  movementId: string;
}

/** Thrown when a stock OUT request exceeds the item's available stock. */
export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

/**
 * Records a stock OUT: allocates `qty` units of `itemId` from its open
 * batches oldest-first (FIFO), decrementing each batch's `qty_remaining`
 * and recording one `movement_allocations` row per batch drawn from, plus
 * the OUT movement and its audit_log entry — all atomically via the
 * `record_stock_out` Postgres function (see
 * supabase/migrations/0007_record_stock_out.sql). As with
 * `recordStockIn`, the audit write happens inside that SQL function, not
 * here, so it's part of the same transaction as the stock change and
 * can't be skipped by a caller that invokes the RPC directly.
 *
 * Throws `InsufficientStockError` when the item doesn't have `qty` units
 * available across its open batches — the whole transaction rolls back,
 * so no partial allocation is left behind.
 */
export async function recordStockOut(
  supabase: SupabaseClient,
  actorId: string,
  input: RecordStockOutInput
): Promise<RecordStockOutResult> {
  const { data, error } = await supabase
    .rpc("record_stock_out", {
      p_item_id: input.itemId,
      p_qty: input.qty,
      p_movement_date: input.movementDate,
      p_note: input.note ?? null,
      p_actor_id: actorId,
    })
    .single();

  if (error) {
    if (/insufficient stock/i.test(error.message)) {
      throw new InsufficientStockError(error.message);
    }
    throw error;
  }

  const result = data as { movement_id: string };

  return { movementId: result.movement_id };
}

/** Thrown when attempting to void a movement that has already been voided. */
export class AlreadyVoidedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyVoidedError";
  }
}

/**
 * Thrown when attempting to void an IN movement whose batch has already
 * had stock sold from it — voiding would silently corrupt a sale that
 * already allocated against that batch, so it's rejected outright rather
 * than partially reversed.
 */
export class BatchAlreadySoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchAlreadySoldError";
  }
}

/**
 * Voids a mistaken IN or OUT movement via the `void_movement` Postgres
 * function (see supabase/migrations/0008_void_movement.sql). The movement
 * row is never deleted — it stays for history with `voided_at`/`voided_by`
 * set — and whichever batch quantity it affected is put back:
 *
 * - Voiding an IN zeroes out its batch's `qty_remaining`, but only if
 *   nothing has been sold from that batch yet (`qty_remaining ===
 *   qty_received`); otherwise it rejects with `BatchAlreadySoldError`
 *   rather than partially reversing.
 * - Voiding an OUT restores `qty_allocated` back onto every batch it drew
 *   from, via its `movement_allocations` rows. This is always safe.
 *
 * Voiding is not repeatable: voiding an already-voided movement rejects
 * with `AlreadyVoidedError`.
 *
 * As with `recordStockIn`/`recordStockOut`, the audit write (action
 * `movement.voided`) happens inside the SQL function itself, atomically
 * with the batch/movement changes — not bolted on here afterward.
 *
 * This intentionally does NOT create a replacement entry or link one via
 * `reverses_movement_id` — the correct replacement, if any, is just a
 * normal new IN/OUT recorded afterward by the user (YAGNI per the plan).
 */
export async function voidMovement(
  supabase: SupabaseClient,
  actorId: string,
  movementId: string
): Promise<void> {
  const { error } = await supabase.rpc("void_movement", {
    p_movement_id: movementId,
    p_actor_id: actorId,
  });

  if (error) {
    if (/already voided/i.test(error.message)) {
      throw new AlreadyVoidedError(error.message);
    }
    if (/already been sold/i.test(error.message)) {
      throw new BatchAlreadySoldError(error.message);
    }
    throw error;
  }
}
