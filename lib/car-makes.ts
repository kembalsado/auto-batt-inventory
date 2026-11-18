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
