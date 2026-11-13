import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDailySummary } from "@/lib/email/dailySummary";
import { manilaToday } from "@/lib/date";

/** Result of `getDashboardSummary` — the dashboard home's four stat tiles
 * plus the same low-stock list the daily email shows. */
export interface DashboardSummary {
  totalActiveItems: number;
  lowStockCount: number;
  qtyInToday: number;
  qtyOutToday: number;
  lowStockItems: { itemId: string; sku: string; name: string; qtyOnHand: number; unit: string }[];
}

/**
 * Gathers the dashboard home's stat tiles. IN/OUT-today and the low-stock
 * list are not recomputed here — they're the exact same questions the
 * daily email (Task 16) already answers for "today" in Asia/Manila, via
 * `buildDailySummary`, so this just sums that function's per-item
 * activity into two totals and reuses its low-stock list outright. Only
 * `totalActiveItems` is new: a single `count`-only query, since
 * `buildDailySummary` has no reason to return a count it never uses.
 */
export async function getDashboardSummary(
  supabase: SupabaseClient
): Promise<DashboardSummary> {
  const [summary, countResult] = await Promise.all([
    buildDailySummary(supabase, manilaToday()),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  if (countResult.error) {
    throw countResult.error;
  }

  let qtyInToday = 0;
  let qtyOutToday = 0;
  for (const item of summary.itemsWithActivity) {
    qtyInToday += item.qtyIn;
    qtyOutToday += item.qtyOut;
  }

  return {
    totalActiveItems: countResult.count ?? 0,
    lowStockCount: summary.lowStockItems.length,
    qtyInToday,
    qtyOutToday,
    lowStockItems: summary.lowStockItems,
  };
}
