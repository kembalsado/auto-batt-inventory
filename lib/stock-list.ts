import type { SupabaseClient } from "@supabase/supabase-js";
import { canSeeCost, type Role } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

/**
 * One row of the stock list (Task 13) — the page, the PDF export route,
 * and the Excel export route all render this same shape, built once by
 * `buildStockListRows` below so none of the three can disagree about what
 * a row contains.
 *
 * `unitCost`/`inventoryValue` are present only when the viewer passed into
 * `buildStockListRows` can see cost (`canSeeCost`, lib/permissions.ts) —
 * genuinely absent keys for a hidden viewer, not `undefined`-valued ones,
 * so a renderer can't accidentally leak `0`/`undefined` where real data
 * belongs, and so JSON.stringify/Object.keys on a hidden row never
 * mentions cost at all.
 */
export interface StockListRow {
  sku: string;
  name: string;
  category: string;
  qtyOnHand: number;
  unit: string;
  unitCost?: number;
  inventoryValue?: number;
}

/**
 * Row shape read from the bulk `items` query below, joined to `categories`
 * for the display name. The embedded `categories` resource comes back as
 * an object (not an array) because `category_id` is a single-row FK, not
 * a to-many relationship.
 */
interface ItemWithCategoryRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  categories: { name: string } | null;
}

/** Row shape read from the bulk `batches_for_viewer` query below. */
interface ViewerBatchRow {
  id: string;
  item_id: string;
  batch_date: string;
  qty_remaining: number;
  unit_cost: number | null;
}

/**
 * Builds one `StockListRow` per active item: sku, name, category, qty on
 * hand, unit, and — only when `viewerRole` can see cost — the oldest
 * remaining batch's unit cost plus the item's total inventory value
 * (`sum(qty_remaining * unit_cost)` across all its remaining batches).
 *
 * Performance: this is a small, fixed number of bulk queries, not one
 * query per item — the exact N+1 pattern Task 12's review flagged for a
 * different page. One query lists every active item (joined to
 * categories); one query reads every remaining batch across all of those
 * items at once, through the cost-safe `batches_for_viewer` view (the
 * same view `getItemBatchesForViewer`, lib/items.ts, reads from — see
 * that function's docstring for why `batches` itself can't be queried for
 * `unit_cost` directly); one call to `getSettings`. Everything else is
 * plain application code combining those three results in memory.
 *
 * Batches are ordered `batch_date asc, id asc` per item — the same FIFO
 * ordering used everywhere else in this project (`getItemBatchesForViewer`,
 * `record_stock_out`) — so "the oldest remaining batch" means the same
 * thing here as it does on the item detail page and in stock-out
 * allocation.
 *
 * Cost gating happens once per row from `canSeeCost(viewerRole, settings)`
 * — not re-derived from whether a given batch row happens to carry a
 * non-null `unit_cost` — so a row's cost fields are either both present or
 * both absent, consistently with what the viewer is actually allowed to
 * see, even for an item with zero remaining batches.
 */
export async function buildStockListRows(
  supabase: SupabaseClient,
  viewerRole: Role
): Promise<StockListRow[]> {
  const [itemsResult, settings] = await Promise.all([
    supabase
      .from("items")
      .select("id, sku, name, unit, categories(name)")
      .eq("is_active", true)
      .order("name"),
    getSettings(supabase),
  ]);

  if (itemsResult.error) {
    throw itemsResult.error;
  }

  const items = (itemsResult.data ?? []) as unknown as ItemWithCategoryRow[];
  const itemIds = items.map((item) => item.id);
  const showCost = canSeeCost(viewerRole, settings);

  const batchesByItemId = new Map<string, ViewerBatchRow[]>();
  if (itemIds.length > 0) {
    const { data: batchRows, error: batchError } = await supabase
      .from("batches_for_viewer")
      .select("id, item_id, batch_date, qty_remaining, unit_cost")
      .in("item_id", itemIds)
      .gt("qty_remaining", 0)
      .order("batch_date", { ascending: true })
      .order("id", { ascending: true });

    if (batchError) {
      throw batchError;
    }

    for (const batch of (batchRows ?? []) as ViewerBatchRow[]) {
      const list = batchesByItemId.get(batch.item_id) ?? [];
      list.push(batch);
      batchesByItemId.set(batch.item_id, list);
    }
  }

  return items.map((item) => {
    const batches = batchesByItemId.get(item.id) ?? [];
    const qtyOnHand = batches.reduce(
      (sum, batch) => sum + Number(batch.qty_remaining),
      0
    );

    const base = {
      sku: item.sku,
      name: item.name,
      category: item.categories?.name ?? "Uncategorized",
      qtyOnHand,
      unit: item.unit,
    };

    if (!showCost) {
      return base;
    }

    const inventoryValue = batches.reduce(
      (sum, batch) =>
        sum + Number(batch.qty_remaining) * Number(batch.unit_cost ?? 0),
      0
    );
    // The oldest remaining batch (batches[0], given the asc/asc ordering
    // above) is the representative "unit cost" for the row. Omitted (not
    // zeroed) when there is no remaining batch to take it from, or when
    // the view itself nulled it out (shouldn't happen once showCost is
    // true, but defended against rather than coercing null to 0).
    const oldest = batches[0];
    const unitCost =
      oldest && oldest.unit_cost != null ? Number(oldest.unit_cost) : undefined;

    return unitCost !== undefined
      ? { ...base, unitCost, inventoryValue }
      : { ...base, inventoryValue };
  });
}
