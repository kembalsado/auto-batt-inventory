import type { SupabaseClient } from "@supabase/supabase-js";
import { getItemBatchesForViewer, type ViewerBatch } from "@/lib/items";
import { getSettings, type AppSettings } from "@/lib/settings";

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
 * The single implementation of "is this item low on stock," per the
 * project ledger's binding ruling: an item's own `low_stock_threshold`
 * if set, otherwise `app_settings.default_low_stock_threshold`, and
 * "low" means at or below that threshold (`<=`), not strictly below —
 * see the task brief's test ("isLowStock is true when qtyOnHand is at
 * or below the item's threshold").
 *
 * This is a plain function — no DB access, no async — so Task 13's
 * stock list and Task 16's daily email can call it directly against
 * values they've already fetched in bulk (e.g. one `items` query plus
 * one `app_settings` row), instead of going through the full, much
 * heavier `getItemStockSummary` (which also pulls batches and complete
 * movement history) once per item just to get this one boolean.
 * `getItemStockSummary` itself calls this helper internally, so there
 * remains exactly one place this comparison is written.
 */
export function isLowStockQty(
  qtyOnHand: number,
  itemThreshold: number | null,
  defaultThreshold: number
): boolean {
  const threshold = itemThreshold ?? defaultThreshold;
  return qtyOnHand <= threshold;
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
 * `isLowStock` is `isLowStockQty` (above) applied to this item's own
 * threshold and the given/fetched settings — not re-derived here.
 *
 * `settings` is optional and defaults to fetching the single
 * `app_settings` row via `getSettings` when omitted (the item detail
 * page's usage). A caller that already has the settings row in hand —
 * e.g. the items list page, computing a summary per item in a loop —
 * should pass it explicitly so this function doesn't re-fetch the same
 * global row once per item.
 *
 * Batches come from `getItemBatchesForViewer` (lib/items.ts), so
 * `unit_cost` is present or absent per-row exactly as that function's
 * cost-gating already decides — this function does not re-derive or
 * loosen that gating.
 */
export async function getItemStockSummary(
  supabase: SupabaseClient,
  itemId: string,
  settings?: AppSettings
): Promise<ItemStockSummary> {
  const [itemResult, batches, resolvedSettings, movementsResult] = await Promise.all([
    supabase
      .from("items")
      .select("low_stock_threshold")
      .eq("id", itemId)
      .single(),
    getItemBatchesForViewer(supabase, itemId),
    settings ? Promise.resolve(settings) : getSettings(supabase),
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

  const itemThreshold =
    itemResult.data?.low_stock_threshold != null
      ? Number(itemResult.data.low_stock_threshold)
      : null;
  const isLowStock = isLowStockQty(
    qtyOnHand,
    itemThreshold,
    resolvedSettings.defaultLowStockThreshold
  );

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
