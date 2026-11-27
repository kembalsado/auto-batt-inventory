import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";

/** One `car_makes` row. See supabase/migrations/0016_car_makes.sql. */
export interface CarMake {
  id: string;
  name: string;
  created_at: string;
}

/**
 * Inserts a new car make and records an audit_log entry for it.
 * `name` must be unique — the database's unique constraint on
 * `car_makes.name` rejects a duplicate, surfaced here as a thrown error.
 */
export async function createCarMake(
  supabase: SupabaseClient,
  actorId: string,
  name: string
): Promise<CarMake> {
  const { data, error } = await supabase
    .from("car_makes")
    .insert({ name })
    .select()
    .single();

  if (error) {
    throw error;
  }

  await recordAudit(supabase, {
    actorId,
    action: "car_make.created",
    entityType: "car_make",
    entityId: data.id,
    summary: `Created car make ${data.name}`,
  });

  return data;
}

/** Lists all car makes, alphabetically by name. */
export async function listCarMakes(
  supabase: SupabaseClient
): Promise<CarMake[]> {
  const { data, error } = await supabase
    .from("car_makes")
    .select("*")
    .order("name");

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Updates a car make's name and records an audit_log entry for it.
 * `name` must be unique — the database's unique constraint on
 * `car_makes.name` rejects a duplicate, surfaced here as a thrown error.
 */
export async function updateCarMake(
  supabase: SupabaseClient,
  actorId: string,
  id: string,
  name: string
): Promise<CarMake> {
  const { data, error } = await supabase
    .from("car_makes")
    .update({ name })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await recordAudit(supabase, {
    actorId,
    action: "car_make.updated",
    entityType: "car_make",
    entityId: data.id,
    summary: `Updated car make ${data.name}`,
  });

  return data;
}

/**
 * Deletes a car make and records an audit_log entry for it.
 * The database's foreign-key constraint on `item_fitments.make_id`
 * (supabase/migrations/0022_item_fitments.sql) rejects deletion if the
 * car make is still referenced by any item's vehicle fitment tag,
 * surfaced here as a thrown error. That constraint replaced the one on
 * `items.make_id`, which no longer exists — that column was dropped in
 * 0024_drop_item_vehicle_columns.sql once fitments became multi-valued.
 */
export async function deleteCarMake(
  supabase: SupabaseClient,
  actorId: string,
  id: string
): Promise<void> {
  // Counted BEFORE the delete: `car_models.make_id` cascades on delete
  // (supabase/migrations/0025_car_models.sql), so Postgres silently wipes
  // out every model under this make with no audit trail of its own. This
  // count is the only record that it happened, so it's folded into this
  // function's own audit summary below.
  const { count: modelCount, error: countError } = await supabase
    .from("car_models")
    .select("id", { count: "exact", head: true })
    .eq("make_id", id);

  if (countError) {
    throw countError;
  }

  const { data, error } = await supabase
    .from("car_makes")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  const modelSuffix =
    modelCount && modelCount > 0
      ? ` (and its ${modelCount} model(s))`
      : "";

  await recordAudit(supabase, {
    actorId,
    action: "car_make.deleted",
    entityType: "car_make",
    entityId: id,
    summary: `Deleted car make ${data.name}${modelSuffix}`,
  });
}
