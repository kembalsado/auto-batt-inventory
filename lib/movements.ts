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
