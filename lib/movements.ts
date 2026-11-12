import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";

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
 * (`qty_remaining = qty_received = qty`) and its matching IN movement,
 * atomically, via the `record_stock_in` Postgres function (see
 * supabase/migrations/0006_record_stock_in.sql) — then records an
 * audit_log entry for the movement.
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

  // Look up the SKU so the audit summary reads clearly (e.g. "IN 10x
  // AB-001 @ ₱1000") rather than a bare item id.
  const { data: item } = await supabase
    .from("items")
    .select("sku")
    .eq("id", input.itemId)
    .single();

  await recordAudit(supabase, {
    actorId,
    action: "movement.created",
    entityType: "stock_movement",
    entityId: result.movement_id,
    summary: `IN ${input.qty}x ${item?.sku ?? input.itemId} @ ₱${input.unitCost}`,
  });

  return { movementId: result.movement_id, batchId: result.batch_id };
}
