import type { SupabaseClient } from "@supabase/supabase-js";
import { createCategory, listCategories } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordAudit } from "@/lib/audit";

/** One row of historical opening-stock data accepted by `importOpeningStock`. */
export interface OpeningStockRow {
  sku: string;
  name: string;
  category: string;
  qty: number;
  lastKnownUnitCost: number;
  lowStockThreshold?: number | null;
}

/** One row's import failure, keyed by its index in the input array. */
export interface ImportRowError {
  row: number;
  message: string;
}

/** Result of `importOpeningStock`. */
export interface ImportOpeningStockResult {
  succeeded: number;
  errors: ImportRowError[];
}

/**
 * Imports historical opening-stock rows (Task 17 — the one-time catch-up
 * import for stock that already existed before this app was adopted).
 *
 * For each row: looks up or creates its category by name, then — unless an
 * item with that SKU already exists, in which case the row is rejected
 * with a clear "SKU already exists" error up front rather than relying on
 * `createItem`'s unique-constraint throw — creates the item, then inserts
 * an `opening_stock` batch (qty_received = qty_remaining = qty) and its
 * matching IN movement, and records an audit_log entry for it.
 *
 * This deliberately does NOT call `recordStockIn` (lib/movements.ts):
 * `record_stock_in` (supabase/migrations/0006_record_stock_in.sql)
 * hardcodes `source: 'purchase'` on the batch it creates, which doesn't
 * fit opening stock. Instead this inserts the batch/movement rows
 * directly via `supabase`, the path `0006`'s own RLS comment anticipated
 * ("this exists for any future direct insert path") — Task 8's reviewed,
 * security-critical `record_stock_in` function is left untouched.
 *
 * Rows are processed one at a time and don't abort each other: a failure
 * on one row (duplicate SKU, any DB error) is collected into `errors` and
 * every other row still runs, so `{ succeeded, errors }` reports the
 * outcome of the whole batch rather than throwing on the first problem.
 * A later step in a row failing after an earlier step already wrote
 * something (e.g. the batch insert failing after the item was created) is
 * cleaned up best-effort within that row — the just-created item/batch is
 * deleted — so a partial row failure doesn't leave an orphaned item with
 * no batch, or a batch with no movement, behind.
 *
 * Category lookups are cached across rows within one call (seeded from a
 * single `listCategories` call up front) so N rows sharing a new category
 * name only insert that category once, and don't each pay a round trip
 * for a category created earlier in the same batch.
 */
export async function importOpeningStock(
  supabase: SupabaseClient,
  actorId: string,
  rows: OpeningStockRow[]
): Promise<ImportOpeningStockResult> {
  const errors: ImportRowError[] = [];
  let succeeded = 0;

  const categoryIdByName = new Map<string, string>();
  for (const category of await listCategories(supabase)) {
    categoryIdByName.set(category.name, category.id);
  }

  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let itemId: string | null = null;
    let batchId: string | null = null;

    try {
      const { data: existing, error: existingError } = await supabase
        .from("items")
        .select("id")
        .eq("sku", row.sku)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }
      if (existing) {
        throw new Error(`SKU "${row.sku}" already exists`);
      }

      let categoryId = categoryIdByName.get(row.category);
      if (!categoryId) {
        const category = await createCategory(supabase, actorId, row.category);
        categoryId = category.id;
        categoryIdByName.set(category.name, category.id);
      }

      const item = await createItem(supabase, actorId, {
        sku: row.sku,
        name: row.name,
        categoryId,
        unit: "pcs",
        lowStockThreshold: row.lowStockThreshold ?? null,
      });
      itemId = item.id;

      const { data: batch, error: batchError } = await supabase
        .from("batches")
        .insert({
          item_id: item.id,
          batch_date: today,
          qty_received: row.qty,
          qty_remaining: row.qty,
          unit_cost: row.lastKnownUnitCost,
          source: "opening_stock",
          created_by: actorId,
        })
        .select()
        .single();

      if (batchError) {
        throw batchError;
      }
      batchId = batch.id;

      const { error: movementError } = await supabase
        .from("stock_movements")
        .insert({
          item_id: item.id,
          type: "IN",
          quantity: row.qty,
          batch_id: batch.id,
          movement_date: today,
          created_by: actorId,
        });

      if (movementError) {
        throw movementError;
      }

      await recordAudit(supabase, {
        actorId,
        action: "movement.created",
        entityType: "stock_movement",
        entityId: batch.id,
        summary: `Opening stock IN ${row.qty}x ${row.sku}`,
      });

      succeeded++;
    } catch (err) {
      // Best-effort cleanup: undo whatever this row already wrote so a
      // later step's failure doesn't leave an orphaned item (no batch) or
      // batch (no movement) behind. There's no DB transaction wrapping
      // these direct inserts, so this is "reasonable", not guaranteed —
      // these cleanup deletes could themselves fail — but it keeps the
      // common case consistent.
      if (batchId) {
        await supabase.from("batches").delete().eq("id", batchId);
      }
      if (itemId) {
        await supabase.from("items").delete().eq("id", itemId);
      }
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ row: i, message });
    }
  }

  return { succeeded, errors };
}
