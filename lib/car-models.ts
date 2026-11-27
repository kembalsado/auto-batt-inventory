import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";

/** One `car_models` row. See supabase/migrations/0017_car_models.sql. */
export interface CarModel {
  id: string;
  makeId: string;
  name: string;
  createdAt: string;
}

/**
 * Maps a row from the database (snake_case) to the TypeScript interface (camelCase).
 */
function mapCarModel(row: any): CarModel {
  return {
    id: row.id,
    makeId: row.make_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

/**
 * Inserts a new car model under a make and records an audit_log entry for it.
 * `name` must be unique within the make — the database's unique constraint on
 * `car_models(make_id, name)` rejects a duplicate, surfaced here as a thrown error.
 */
export async function createCarModel(
  supabase: SupabaseClient,
  actorId: string,
  makeId: string,
  name: string
): Promise<CarModel> {
  const { data, error } = await supabase
    .from("car_models")
    .insert({ make_id: makeId, name })
    .select()
    .single();

  if (error) {
    throw error;
  }

  const model = mapCarModel(data);

  await recordAudit(supabase, {
    actorId,
    action: "car_model.created",
    entityType: "car_model",
    entityId: model.id,
    summary: `Created car model ${model.name}`,
  });

  return model;
}

/** Lists all car models, alphabetically by name. */
export async function listCarModels(
  supabase: SupabaseClient
): Promise<CarModel[]> {
  const { data, error } = await supabase
    .from("car_models")
    .select("*")
    .order("name");

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapCarModel);
}

/**
 * Updates a car model's name and records an audit_log entry for it.
 * `name` must be unique within the model's make — the database's unique
 * constraint on `car_models(make_id, name)` rejects a duplicate, surfaced
 * here as a thrown error.
 */
export async function updateCarModel(
  supabase: SupabaseClient,
  actorId: string,
  id: string,
  name: string
): Promise<CarModel> {
  const { data, error } = await supabase
    .from("car_models")
    .update({ name })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  const model = mapCarModel(data);

  await recordAudit(supabase, {
    actorId,
    action: "car_model.updated",
    entityType: "car_model",
    entityId: model.id,
    summary: `Updated car model ${model.name}`,
  });

  return model;
}

/**
 * Deletes a car model and records an audit_log entry for it.
 * The database's foreign-key constraints may reject deletion if the
 * car model is still referenced by any item's vehicle fitment tag,
 * surfaced here as a thrown error.
 */
export async function deleteCarModel(
  supabase: SupabaseClient,
  actorId: string,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("car_models")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  const model = mapCarModel(data);

  await recordAudit(supabase, {
    actorId,
    action: "car_model.deleted",
    entityType: "car_model",
    entityId: id,
    summary: `Deleted car model ${model.name}`,
  });
}
