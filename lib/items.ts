import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";
import { replaceFitmentsForItem, type FitmentInput } from "@/lib/item-fitments";

/**
 * One `items` row. See supabase/migrations/0001_init.sql. Vehicle fitment
 * data (make/model/variant/year) no longer lives on this row — it's
 * multi-valued, in `item_fitments` (supabase/migrations/0022_item_fitments.sql,
 * 0023_backfill_item_fitments.sql, 0024_drop_item_vehicle_columns.sql),
 * accessed via `lib/item-fitments.ts`.
 */
export interface Item {
  id: string;
  sku: string;
  name: string;
  category_id: string | null;
  unit: string;
  low_stock_threshold: number | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

/**
 * Fields accepted by `createItem` (and, as a full replacement set,
 * `updateItem`). `fitments`, when provided, is passed through to
 * `replaceFitmentsForItem` — omitted (or `[]`) means "no vehicle tags".
 */
export interface CreateItemInput {
  sku: string;
  name: string;
  categoryId: string | null;
  unit: string;
  lowStockThreshold?: number | null;
  fitments?: FitmentInput[];
}

/**
 * Inserts a new item and records an audit_log entry for it. `sku` must be
 * unique — the database's unique constraint on `items.sku` rejects a
 * duplicate, surfaced here as a thrown error.
 *
 * The item row and its fitment rows are written by two separate
 * statements, with no surrounding transaction (PostgREST gives one per
 * statement, and wrapping both in a Postgres RPC was weighed and declined
 * as a larger architectural change than this is worth — especially now
 * that `parseFitmentsJson` rejects the malformed year data that was the
 * most plausible cause of a fitments-write failure). The `try`/`catch`
 * below is therefore a deliberate mitigation, not real atomicity: if the
 * fitments write throws, the item row that was already committed is
 * deleted again so the failed create leaves nothing behind — no ghost
 * item holding its SKU hostage (the user's retry would otherwise fail
 * with a confusing "duplicate SKU"), and no item visible in the catalogue
 * with neither its tags nor an `item.created` audit entry, since
 * `recordAudit` runs only after this point. The cleanup delete is
 * best-effort: if IT fails too, its error is swallowed and the original
 * fitments error is still what propagates, because that's the one that
 * explains what actually went wrong.
 */
export async function createItem(
  supabase: SupabaseClient,
  actorId: string,
  input: CreateItemInput
): Promise<Item> {
  const { data, error } = await supabase
    .from("items")
    .insert({
      sku: input.sku,
      name: input.name,
      category_id: input.categoryId,
      unit: input.unit,
      low_stock_threshold: input.lowStockThreshold ?? null,
      created_by: actorId,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Only called when there's something to write: a brand-new item has no
  // existing fitments, so `replaceFitmentsForItem` with an empty list
  // would spend a guaranteed-empty select plus a no-op on every single
  // create. (`updateItem`'s call below stays unconditional — there an
  // empty list genuinely means "clear this item's existing tags".)
  if (input.fitments?.length) {
    try {
      await replaceFitmentsForItem(supabase, data.id, input.fitments);
    } catch (fitmentsError) {
      try {
        // Best effort, deliberately: the returned `error` is not checked
        // and a thrown one is swallowed, so that the fitments error —
        // the one that explains the failure — is what the caller sees.
        await supabase.from("items").delete().eq("id", data.id);
      } catch {
        // Intentionally empty; see above.
      }
      throw fitmentsError;
    }
  }

  await recordAudit(supabase, {
    actorId,
    action: "item.created",
    entityType: "item",
    entityId: data.id,
    summary: `Created item ${data.sku}`,
  });

  return data;
}

/**
 * Updates an existing item in place and records an audit_log entry for it.
 * `input` is the same full field set `createItem` accepts — the edit form
 * always submits everything the add form does, so there's no separate
 * "partial update" shape. As with `createItem`, a duplicate `sku` is
 * rejected by the database's unique constraint and surfaced here as a
 * thrown error (callers check it with `isUniqueViolation`).
 */
export async function updateItem(
  supabase: SupabaseClient,
  actorId: string,
  itemId: string,
  input: CreateItemInput
): Promise<Item> {
  const { data, error } = await supabase
    .from("items")
    .update({
      sku: input.sku,
      name: input.name,
      category_id: input.categoryId,
      unit: input.unit,
      low_stock_threshold: input.lowStockThreshold ?? null,
    })
    .eq("id", itemId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await replaceFitmentsForItem(supabase, itemId, input.fitments ?? []);

  await recordAudit(supabase, {
    actorId,
    action: "item.updated",
    entityType: "item",
    entityId: data.id,
    summary: `Updated item ${data.sku}`,
  });

  return data;
}

/**
 * Deletes an item and records an audit_log entry for it. Mirrors
 * `deleteCategory` (lib/categories.ts). `batches.item_id` and
 * `stock_movements.item_id` both reference `items (id)` with no
 * cascade, so the database itself rejects deleting an item that's ever
 * had stock in or out (SQLSTATE 23503) — surfaced here as a thrown
 * error (callers check it with `isForeignKeyViolation`).
 */
export async function deleteItem(
  supabase: SupabaseClient,
  actorId: string,
  itemId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("items")
    .delete()
    .eq("id", itemId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await recordAudit(supabase, {
    actorId,
    action: "item.deleted",
    entityType: "item",
    entityId: itemId,
    summary: `Deleted item ${data.sku}`,
  });
}

/** Lists all items, alphabetically by name. */
export async function listItems(supabase: SupabaseClient): Promise<Item[]> {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("name");

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * One `batches` row (see supabase/migrations/0001_init.sql) as returned to
 * a specific viewer by `getItemBatchesForViewer`. `unit_cost` is present
 * only when that viewer is permitted to see cost data — absent (not just
 * zeroed) otherwise, so a caller can't mistake "hidden" for "free".
 */
export interface ViewerBatch {
  id: string;
  item_id: string;
  batch_date: string;
  qty_received: number;
  qty_remaining: number;
  unit_cost?: number;
  source: "purchase" | "opening_stock";
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * Fetches `itemId`'s batches (oldest first) for display to whichever
 * caller `supabase`'s session belongs to, with `unit_cost` present only
 * when that caller is permitted to see cost data (an owner always; an
 * assistant only when `app_settings.show_cost_to_assistant` is true).
 *
 * This reads from `batches_for_viewer` (supabase/migrations/
 * 0010_batches_cost_column_lockdown.sql), not the raw `batches` table.
 * That view — not this function — is what actually enforces the rule:
 * it nulls `unit_cost` out per row via `can_see_cost(auth.uid())`, the
 * SQL mirror of `canSeeCost` (lib/permissions.ts), and the raw table's
 * `unit_cost` column has had SELECT revoked from `authenticated`
 * entirely, so there is no other path — including a direct PostgREST
 * query bypassing this app — for a caller to read it except through that
 * view. This function only converts the view's `null` into an absent key
 * (not just `null`), so a caller here can't mistake "hidden" for "free",
 * matching `ViewerBatch`'s optional `unit_cost` type.
 *
 * This is the single shared place the item detail page, the stock list
 * (Task 13), and any future export read batches through, so none of them
 * has to re-derive the cost-visibility rule itself. There's no computed
 * inventory value (qty * cost) here yet — Task 12 is expected to add one
 * once an item-level stock summary exists, and it must be gated the same
 * way (ideally also from the database layer, not application code alone).
 */
export async function getItemBatchesForViewer(
  supabase: SupabaseClient,
  itemId: string
): Promise<ViewerBatch[]> {
  const { data, error } = await supabase
    .from("batches_for_viewer")
    .select("*")
    .eq("item_id", itemId)
    .order("batch_date");

  if (error) {
    throw error;
  }

  const batches = (data ?? []) as ViewerBatch[];

  return batches.map((batch) => {
    if (batch.unit_cost !== null) {
      return batch;
    }
    const stripped: ViewerBatch = { ...batch };
    delete stripped.unit_cost;
    return stripped;
  });
}
