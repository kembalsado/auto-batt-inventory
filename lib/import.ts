import type { SupabaseClient } from "@supabase/supabase-js";
import { createCategory, listCategories } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordAudit } from "@/lib/audit";
import { getRole } from "@/lib/permissions";

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

/** Thrown by `importOpeningStockAsOwner` when the caller isn't an owner. */
export class ForbiddenError extends Error {
  constructor(message = "Only an owner may import opening stock.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Deletes whatever partial rows a failed import row already wrote, in FK
 * order (`stock_movements` -> `batches` -> `items`: `stock_movements.
 * batch_id` is a non-cascading FK to `batches.id`, so the movement must
 * go first or its batch's delete fails outright). Any id left `null`
 * (because that step was never reached) is simply skipped.
 *
 * Returns an error message describing what *couldn't* be cleaned up, so
 * that failure can be surfaced distinctly rather than silently swallowed
 * — a cleanup failure means a fully-formed item/batch/movement with no
 * audit trail may be left behind, which is worth telling the caller about
 * even though the row itself still gets reported as failed.
 */
async function cleanupPartialRow(
  supabase: SupabaseClient,
  ids: { itemId: string | null; batchId: string | null; movementId: string | null }
): Promise<string | null> {
  if (ids.movementId) {
    const { error } = await supabase
      .from("stock_movements")
      .delete()
      .eq("id", ids.movementId);
    if (error) {
      return `cleanup failed removing stock_movements row ${ids.movementId} (manual cleanup may be required): ${error.message}`;
    }
  }

  if (ids.batchId) {
    const { error } = await supabase.from("batches").delete().eq("id", ids.batchId);
    if (error) {
      return `cleanup failed removing batch ${ids.batchId} (manual cleanup may be required): ${error.message}`;
    }
  }

  if (ids.itemId) {
    const { error } = await supabase.from("items").delete().eq("id", ids.itemId);
    if (error) {
      return `cleanup failed removing item ${ids.itemId} (manual cleanup may be required): ${error.message}`;
    }
  }

  return null;
}

/**
 * Imports historical opening-stock rows (Task 17 — the one-time catch-up
 * import for stock that already existed before this app was adopted).
 *
 * For each row: validates `qty > 0` and `lastKnownUnitCost >= 0` (the
 * same guards `record_stock_in` enforces in SQL — see
 * supabase/migrations/0006_record_stock_in.sql — replicated here in
 * application code since this path deliberately bypasses that function
 * and `batches` has no CHECK constraint of its own); looks up or creates
 * its category by name; then — unless an item with that SKU already
 * exists, in which case the row is rejected with a clear "SKU already
 * exists" error up front rather than relying on `createItem`'s
 * unique-constraint throw — creates the item, then inserts an
 * `opening_stock` batch (qty_received = qty_remaining = qty) and its
 * matching IN movement, and records an audit_log entry for it (entity_id
 * = the movement's id, matching the convention `record_stock_in`/
 * `record_stock_out`/`void_movement` use for their own `stock_movement`
 * audit rows).
 *
 * This deliberately does NOT call `recordStockIn` (lib/movements.ts):
 * `record_stock_in` hardcodes `source: 'purchase'` on the batch it
 * creates, which doesn't fit opening stock. Instead this inserts the
 * batch/movement rows directly via `supabase`, the path `0006`'s own RLS
 * comment anticipated ("this exists for any future direct insert path")
 * — Task 8's reviewed, security-critical `record_stock_in` function is
 * left untouched.
 *
 * Rows are processed one at a time and don't abort each other: a failure
 * on one row (bad qty/cost, duplicate SKU, any DB error) is collected
 * into `errors` and every other row still runs, so `{ succeeded, errors }`
 * reports the outcome of the whole batch rather than throwing on the
 * first problem. A later step in a row failing after an earlier step
 * already wrote something (e.g. the audit insert failing after the batch
 * and movement both succeeded) is cleaned up via `cleanupPartialRow`,
 * deleting in FK order, so a partial row failure doesn't leave an
 * orphaned item/batch/movement with no audit trail behind; if that
 * cleanup itself fails, the row's error message says so explicitly
 * rather than silently leaving the phantom data unexplained.
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
    let movementId: string | null = null;

    try {
      if (!Number.isFinite(row.qty) || row.qty <= 0) {
        throw new Error(`qty must be a positive number (got ${row.qty})`);
      }
      if (!Number.isFinite(row.lastKnownUnitCost) || row.lastKnownUnitCost < 0) {
        throw new Error(
          `lastKnownUnitCost must not be negative (got ${row.lastKnownUnitCost})`
        );
      }

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

      const { data: movement, error: movementError } = await supabase
        .from("stock_movements")
        .insert({
          item_id: item.id,
          type: "IN",
          quantity: row.qty,
          batch_id: batch.id,
          movement_date: today,
          created_by: actorId,
        })
        .select()
        .single();

      if (movementError) {
        throw movementError;
      }
      movementId = movement.id;

      await recordAudit(supabase, {
        actorId,
        action: "movement.created",
        entityType: "stock_movement",
        entityId: movement.id,
        summary: `Opening stock IN ${row.qty}x ${row.sku}`,
      });

      succeeded++;
    } catch (err) {
      const originalMessage = err instanceof Error ? err.message : String(err);
      const cleanupError = await cleanupPartialRow(supabase, {
        itemId,
        batchId,
        movementId,
      });
      const message = cleanupError
        ? `${originalMessage} — ${cleanupError}`
        : originalMessage;
      errors.push({ row: i, message });
    }
  }

  return { succeeded, errors };
}

/**
 * Owner-gated wrapper around `importOpeningStock`, used by the Server
 * Action backing the owner-only import page
 * (app/(dashboard)/import/actions.ts). Looks up `actorId`'s role from
 * `profiles` and throws `ForbiddenError` if it isn't "owner" before
 * calling through.
 *
 * This exists because the dashboard layout's `isOwnerOnlyRoute` redirect
 * only gates *rendering* the page on navigation — it does nothing to stop
 * an authenticated assistant from invoking the Server Action directly,
 * bypassing the UI. Putting the role check here (a plain, DB-backed
 * function) rather than only inline in the "use server" action file also
 * keeps it unit-testable without needing a request-scoped Next.js
 * session, the same reasoning `createUserAsOwner`-style checks get
 * pulled into lib/ elsewhere in this codebase.
 */
export async function importOpeningStockAsOwner(
  supabase: SupabaseClient,
  actorId: string,
  rows: OpeningStockRow[]
): Promise<ImportOpeningStockResult> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", actorId)
    .single();

  if (error) {
    throw error;
  }
  if (getRole(profile) !== "owner") {
    throw new ForbiddenError();
  }

  return importOpeningStock(supabase, actorId, rows);
}
