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
