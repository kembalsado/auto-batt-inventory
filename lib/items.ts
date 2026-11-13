import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";

/** One `items` row. See supabase/migrations/0001_init.sql. */
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

/** Fields accepted by `createItem`. */
export interface CreateItemInput {
  sku: string;
  name: string;
  categoryId: string | null;
  unit: string;
  lowStockThreshold?: number | null;
}

/**
 * Inserts a new item and records an audit_log entry for it. `sku` must be
 * unique — the database's unique constraint on `items.sku` rejects a
 * duplicate, surfaced here as a thrown error.
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

  await recordAudit(supabase, {
    actorId,
    action: "item.created",
    entityType: "item",
    entityId: data.id,
    summary: `Created item ${data.sku}`,
  });

  return data;
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
