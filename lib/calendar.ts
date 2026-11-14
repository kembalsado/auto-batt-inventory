import type { SupabaseClient } from "@supabase/supabase-js";

/** One calendar day's total IN/OUT across every item, for the month grid. */
export interface MonthDayActivity {
  /** "YYYY-MM-DD" */
  date: string;
  qtyIn: number;
  qtyOut: number;
}

/** Row shape read from the bulk `stock_movements` query below. */
interface MovementRow {
  movement_date: string;
  type: "IN" | "OUT";
  quantity: number;
}

/** "YYYY-MM-DD" for the first day of `year`-`month` (`month` is 1-12). */
function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Number of days in `year`-`month` (`month` is 1-12). Day 0 of the
 * following month is the last day of this one — a standard trick, done
 * in UTC so it's pure calendar arithmetic with no local-clock skew. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM-DD" for the last day of `year`-`month` (`month` is 1-12). */
function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
}

/**
 * Day-of-week (0=Sunday..6=Saturday) the 1st of `year`-`month` falls on —
 * how many empty cells the calendar grid needs before day 1.
 */
export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export { daysInMonth };

/**
 * Shop-wide IN/OUT totals for every day in `year`-`month` that had at
 * least one non-voided movement — one bulk query for the whole month
 * (not one per day), grouped in application code. A day with no activity
 * simply has no entry in the returned array; the calendar page renders
 * every calendar day regardless and looks up this array by date.
 */
export async function getMonthActivity(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<MonthDayActivity[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("movement_date, type, quantity")
    .gte("movement_date", firstDayOfMonth(year, month))
    .lte("movement_date", lastDayOfMonth(year, month))
    .is("voided_at", null);

  if (error) {
    throw error;
  }

  const byDate = new Map<string, { qtyIn: number; qtyOut: number }>();
  for (const movement of (data ?? []) as MovementRow[]) {
    const totals = byDate.get(movement.movement_date) ?? { qtyIn: 0, qtyOut: 0 };
    if (movement.type === "IN") {
      totals.qtyIn += Number(movement.quantity);
    } else {
      totals.qtyOut += Number(movement.quantity);
    }
    byDate.set(movement.movement_date, totals);
  }

  return Array.from(byDate.entries()).map(([date, totals]) => ({
    date,
    ...totals,
  }));
}
