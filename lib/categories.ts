import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";

/** One `categories` row. See supabase/migrations/0001_init.sql. */
export interface Category {
  id: string;
  name: string;
  created_at: string;
}

/**
 * Inserts a new category and records an audit_log entry for it.
 * `name` must be unique — the database's unique constraint on
 * `categories.name` rejects a duplicate, surfaced here as a thrown error.
 */
export async function createCategory(
  supabase: SupabaseClient,
  actorId: string,
  name: string
): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .insert({ name })
    .select()
    .single();

  if (error) {
    throw error;
  }

  await recordAudit(supabase, {
    actorId,
    action: "category.created",
    entityType: "category",
    entityId: data.id,
    summary: `Created category ${data.name}`,
  });

  return data;
}

/** Lists all categories, alphabetically by name. */
export async function listCategories(
  supabase: SupabaseClient
): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("name");

  if (error) {
    throw error;
  }

  return data ?? [];
}
