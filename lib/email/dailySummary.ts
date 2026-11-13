import type { SupabaseClient } from "@supabase/supabase-js";
import { isLowStockQty } from "@/lib/stock";
import { getSettings } from "@/lib/settings";

/** One row of the daily email's "activity today" table. */
export interface DailySummaryItemActivity {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  /** Sum of non-voided IN movement quantities for this item on the given date. */
  qtyIn: number;
  /** Sum of non-voided OUT movement quantities for this item on the given date. */
  qtyOut: number;
}

/** One row of the daily email's "low stock" warning section. */
export interface DailySummaryLowStockItem {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  qtyOnHand: number;
  /** The threshold that was actually compared against (item-level, or the global default). */
  threshold: number;
}

/** Result of `buildDailySummary`. */
export interface DailySummary {
  date: string;
  /** True when either list below is non-empty — the cron route's send/skip gate. */
  hasActivity: boolean;
  itemsWithActivity: DailySummaryItemActivity[];
  lowStockItems: DailySummaryLowStockItem[];
}

/** Row shape read from the bulk `items` query below. */
interface ItemRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  low_stock_threshold: number | null;
}

/** Row shape read from the bulk `stock_movements` query below. */
interface MovementRow {
  item_id: string;
  type: "IN" | "OUT";
  quantity: number;
}

/** Row shape read from the bulk `batches_for_viewer` query below. */
interface ViewerBatchRow {
  item_id: string;
  qty_remaining: number;
}

/**
 * Gathers everything Task 16's daily email needs for one calendar `date`
 * (an "YYYY-MM-DD" string, Asia/Manila being the caller's concern, not
 * this function's — see the cron route for how "today" is computed):
 *
 * - `itemsWithActivity`: every active item with at least one non-voided
 *   `stock_movements` row on `date`, with that day's IN and OUT quantities
 *   summed separately. A voided movement (`voided_at` not null) never
 *   contributes — it never happened, as far as the ledger's effect goes
 *   (same rule `getItemStockSummary`'s qtyOnHand already relies on, lib/
 *   stock.ts).
 * - `lowStockItems`: every active item currently at or below its
 *   low-stock threshold, using `isLowStockQty` (lib/stock.ts) — the single
 *   place this threshold/fallback comparison is written, per that
 *   function's own binding-ruling docstring. This is a snapshot of
 *   *current* qty on hand, independent of `date` — "today's activity" and
 *   "what's currently low" are two different questions the design doc
 *   asks the same email to answer.
 * - `hasActivity`: true when either list above is non-empty. This is the
 *   cron route's send/skip gate (design doc: "if there was no activity and
 *   nothing is low, the email can be skipped to avoid noise").
 *
 * Performance: three bulk queries (items, today's movements, and open
 * batches across all items) plus one settings fetch — not one query per
 * item. This mirrors `buildStockListRows` (lib/stock-list.ts), which reads
 * from the same `batches_for_viewer` view the same way for the same
 * "qty on hand per item, in bulk" reason — see that function's docstring
 * for why this project treats a per-item query here as the N+1 pattern
 * already caught twice.
 *
 * Never throws on an empty system (zero items): the batches query is
 * skipped entirely when there are no item ids to look up (mirroring
 * `buildStockListRows`'s same guard), and every grouping below starts from
 * an empty Map/array rather than assuming at least one row exists.
 */
export async function buildDailySummary(
  supabase: SupabaseClient,
  date: string
): Promise<DailySummary> {
  const [itemsResult, movementsResult, settings] = await Promise.all([
    supabase
      .from("items")
      .select("id, sku, name, unit, low_stock_threshold")
      .eq("is_active", true),
    supabase
      .from("stock_movements")
      .select("item_id, type, quantity")
      .eq("movement_date", date)
      .is("voided_at", null),
    getSettings(supabase),
  ]);

  if (itemsResult.error) {
    throw itemsResult.error;
  }
  if (movementsResult.error) {
    throw movementsResult.error;
  }

  const items = (itemsResult.data ?? []) as ItemRow[];
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const itemIds = items.map((item) => item.id);

  const qtyOnHandByItemId = new Map<string, number>();
  if (itemIds.length > 0) {
    const { data: batchRows, error: batchError } = await supabase
      .from("batches_for_viewer")
      .select("item_id, qty_remaining")
      .in("item_id", itemIds)
      .gt("qty_remaining", 0);

    if (batchError) {
      throw batchError;
    }

    for (const batch of (batchRows ?? []) as ViewerBatchRow[]) {
      const current = qtyOnHandByItemId.get(batch.item_id) ?? 0;
      qtyOnHandByItemId.set(batch.item_id, current + Number(batch.qty_remaining));
    }
  }

  const activityByItemId = new Map<string, { qtyIn: number; qtyOut: number }>();
  for (const movement of (movementsResult.data ?? []) as MovementRow[]) {
    // A movement whose item is no longer active (or was deleted) is
    // skipped rather than guessed at — there's no sku/name/unit to show
    // for it, and an inactive item has no place in a forward-looking
    // daily summary anyway.
    if (!itemsById.has(movement.item_id)) {
      continue;
    }
    const totals = activityByItemId.get(movement.item_id) ?? { qtyIn: 0, qtyOut: 0 };
    if (movement.type === "IN") {
      totals.qtyIn += Number(movement.quantity);
    } else {
      totals.qtyOut += Number(movement.quantity);
    }
    activityByItemId.set(movement.item_id, totals);
  }

  const itemsWithActivity: DailySummaryItemActivity[] = Array.from(
    activityByItemId.entries()
  ).map(([itemId, totals]) => {
    const item = itemsById.get(itemId)!;
    return {
      itemId,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      qtyIn: totals.qtyIn,
      qtyOut: totals.qtyOut,
    };
  });

  const lowStockItems: DailySummaryLowStockItem[] = [];
  for (const item of items) {
    const qtyOnHand = qtyOnHandByItemId.get(item.id) ?? 0;
    const threshold = item.low_stock_threshold ?? settings.defaultLowStockThreshold;
    if (isLowStockQty(qtyOnHand, item.low_stock_threshold, settings.defaultLowStockThreshold)) {
      lowStockItems.push({
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        qtyOnHand,
        threshold,
      });
    }
  }

  return {
    date,
    hasActivity: itemsWithActivity.length > 0 || lowStockItems.length > 0,
    itemsWithActivity,
    lowStockItems,
  };
}
