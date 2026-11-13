import type { SupabaseClient } from "@supabase/supabase-js";
import { getItemBatchesForViewer, type ViewerBatch } from "@/lib/items";
import { getSettings } from "@/lib/settings";

/**
 * One `stock_movements` row, as shown in an item's movement history (Task
 * 10's MovementsList renders a subset of this). Voided movements are
 * included, not filtered out — voiding never deletes the ledger row, only
 * reverses its effect on batch quantities.
 */
export interface StockMovement {
  id: string;
  type: "IN" | "OUT";
  quantity: number;
  batchId: string | null;
  movementDate: string;
  note: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Result of `getItemStockSummary`. */
export interface ItemStockSummary {
  qtyOnHand: number;
  isLowStock: boolean;
  batches: ViewerBatch[];
  movements: StockMovement[];
}

/**
 * Computes an item's full stock summary: quantity on hand, whether that
 * counts as low stock, its batch list (cost-gated per viewer), and its
 * full movement history (voided entries included, newest first).
 *
 * `qtyOnHand` is the sum of `qty_remaining` across the item's batches.
 * This already excludes voided IN movements without any extra filtering:
 * voiding an untouched IN zeroes its batch's `qty_remaining` directly (see
 * `void_movement`, supabase/migrations/0008_void_movement.sql), and
 * voiding an OUT restores `qty_remaining` on whichever batches it drew
 * from — so by the time this function reads `qty_remaining`, every void's
 * effect is already baked into the batch rows. There is nothing left to
 * subtract.
 *
 * `isLowStock` compares `qtyOnHand` against a threshold using this
 * ruling (binding for every other "is this item low on stock" check in
 * the app — Task 13's stock list and Task 16's daily email reuse this
 * function rather than re-deriving the rule themselves):
 *
 *   item.low_stock_threshold if set, otherwise
 *   app_settings.default_low_stock_threshold
 *
 * "Low stock" means at or below the threshold (<=), not strictly below —
 * see the task brief's test ("isLowStock is true when qtyOnHand is at or
 * below the item's threshold").
 *
 * Batches come from `getItemBatchesForViewer` (lib/items.ts), so
 * `unit_cost` is present or absent per-row exactly as that function's
 * cost-gating already decides — this function does not re-derive or
 * loosen that gating.
 */
export async function getItemStockSummary(
  supabase: SupabaseClient,
  itemId: string
): Promise<ItemStockSummary> {
  const [itemResult, batches, settings, movementsResult] = await Promise.all([
    supabase
      .from("items")
      .select("low_stock_threshold")
      .eq("id", itemId)
      .single(),
    getItemBatchesForViewer(supabase, itemId),
    getSettings(supabase),
    supabase
      .from("stock_movements")
      .select("*")
      .eq("item_id", itemId)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (itemResult.error) {
    throw itemResult.error;
  }
  if (movementsResult.error) {
    throw movementsResult.error;
  }

  const qtyOnHand = batches.reduce(
    (sum, batch) => sum + Number(batch.qty_remaining),
    0
  );

  const threshold =
    itemResult.data?.low_stock_threshold ?? settings.defaultLowStockThreshold;
  const isLowStock = qtyOnHand <= Number(threshold);

  const movements: StockMovement[] = (movementsResult.data ?? []).map((m) => ({
    id: m.id,
    type: m.type as "IN" | "OUT",
    quantity: Number(m.quantity),
    batchId: m.batch_id,
    movementDate: m.movement_date,
    note: m.note,
    voidedAt: m.voided_at,
    voidedBy: m.voided_by,
    createdBy: m.created_by,
    createdAt: m.created_at,
  }));

  return { qtyOnHand, isLowStock, batches, movements };
}
