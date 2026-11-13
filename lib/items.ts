import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

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
 * caller `supabase`'s session belongs to, stripping `unit_cost` from
 * every row when `canSeeCost` (lib/permissions.ts) says that caller's
 * role shouldn't see cost data (an assistant, unless the owner has set
 * `app_settings.show_cost_to_assistant`).
 *
 * This is the single shared place batch cost gets hidden server-side —
 * the item detail page, the stock list (Task 13), and any future export
 * all read batches through here instead of each re-deriving the rule
 * themselves, per the plan's "cost must be gated where the data is read,
 * not just hidden in the UI" constraint. There's no computed inventory
 * value (qty * cost) here yet — Task 12 is expected to add one once an
 * item-level stock summary exists, and it must strip the same way.
 */
export async function getItemBatchesForViewer(
  supabase: SupabaseClient,
  itemId: string
): Promise<ViewerBatch[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single()
      ).data
    : null;
  const role = getRole(profile);
  const settings = await getSettings(supabase);

  const { data, error } = await supabase
    .from("batches")
    .select("*")
    .eq("item_id", itemId)
    .order("batch_date");

  if (error) {
    throw error;
  }

  const batches = (data ?? []) as ViewerBatch[];

  if (canSeeCost(role, settings)) {
    return batches;
  }

  return batches.map((batch) => {
    const stripped: ViewerBatch = { ...batch };
    delete stripped.unit_cost;
    return stripped;
  });
}
