import type { SupabaseClient } from "@supabase/supabase-js";

/** Row shape read from the bulk `stock_movements` IN query below. */
interface PurchaseMovementRow {
  movement_date: string;
  quantity: number;
  batch_id: string;
}

/** Row shape read from the bulk `batches_for_viewer` lookup below. */
interface ViewerBatchLookupRow {
  id: string;
  unit_cost: number | null;
  source: "purchase" | "opening_stock";
}

/**
 * Sums real-purchase cost (`quantity * unit_cost`) per day, across every
 * item, for every non-voided IN movement whose batch dates fall within
 * `startDate`..`endDate` (inclusive). Opening-stock imports (`lib/
 * import.ts`) are excluded — they're historical catch-up data, not a real
 * purchase — by requiring the matching batch's `source` to be
 * `"purchase"`.
 *
 * Two-step, application-joined query, same shape as `lib/activity.ts`'s
 * `entityIdsForItem`: first the movements in range, then — by the
 * distinct `batch_id`s collected from them — the batches those movements
 * drew from, read via `batches_for_viewer` (not the raw `batches` table)
 * so `unit_cost` resolves against the caller's own session the same way
 * `getItemBatchesForViewer` (lib/items.ts) does. That view nulls
 * `unit_cost` out for a viewer not permitted to see cost — this
 * deliberately treats that the same as "no cost data" (the movement's
 * date simply gets no entry for that quantity) rather than throwing,
 * since a caller without cost visibility asking for a cost report isn't
 * this function's problem to solve.
 *
 * `supabase` must be a client with a real signed-in session (an owner,
 * in practice, since this is a cost report) — never the admin client:
 * `batches_for_viewer`'s cost gate resolves against `auth.uid()`, which
 * is `null` for the service-role client, so every batch would silently
 * come back with `unit_cost: null` regardless of role.
 *
 * Returns an empty `Map` (never throws) when no IN movement falls in
 * range — same sparse-map convention as `lib/calendar.ts`'s
 * `getMonthActivity`: a date only has an entry if it had at least one
 * qualifying movement.
 */
export async function getPurchasesByDate(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const { data: movements, error: movementsError } = await supabase
    .from("stock_movements")
    .select("movement_date, quantity, batch_id")
    .eq("type", "IN")
    .is("voided_at", null)
    .gte("movement_date", startDate)
    .lte("movement_date", endDate);

  if (movementsError) {
    throw movementsError;
  }

  const movementRows = (movements ?? []) as PurchaseMovementRow[];
  if (movementRows.length === 0) {
    return new Map();
  }

  const batchIds = Array.from(new Set(movementRows.map((m) => m.batch_id)));

  const { data: batches, error: batchesError } = await supabase
    .from("batches_for_viewer")
    .select("id, unit_cost, source")
    .in("id", batchIds);

  if (batchesError) {
    throw batchesError;
  }

  const batchById = new Map<string, ViewerBatchLookupRow>();
  for (const batch of (batches ?? []) as ViewerBatchLookupRow[]) {
    batchById.set(batch.id, batch);
  }

  const totalsByDate = new Map<string, number>();
  for (const movement of movementRows) {
    const batch = batchById.get(movement.batch_id);
    if (!batch || batch.source !== "purchase" || batch.unit_cost == null) {
      continue;
    }
    const cost = Number(movement.quantity) * Number(batch.unit_cost);
    totalsByDate.set(
      movement.movement_date,
      (totalsByDate.get(movement.movement_date) ?? 0) + cost
    );
  }

  return totalsByDate;
}

/** Row shape read from the bulk `stock_movements` OUT query below. */
interface StockOutMovementRow {
  id: string;
  movement_date: string;
}

/** Row shape read from the bulk `movement_allocations` lookup below. */
interface AllocationRow {
  movement_id: string;
  qty_allocated: number;
  unit_cost_at_allocation: number;
}

/**
 * Sums FIFO-allocated stock-out cost (`qty_allocated *
 * unit_cost_at_allocation`) per day, across every item, for every
 * non-voided OUT movement whose dates fall within `startDate`..`endDate`
 * (inclusive).
 *
 * Two-step, application-joined query, the same shape as
 * `getPurchasesByDate` above: first the OUT movements in range, then —
 * by their ids — the `movement_allocations` rows those movements
 * produced. Reads both tables via `adminSupabase`, the only client with
 * any readable path to `movement_allocations` at all (Task 1's grant).
 *
 * Voided-OUT exclusion happens entirely at the `stock_movements` step
 * (`voided_at is null`), not by looking at `movement_allocations`
 * directly: voiding a movement (`lib/movements.ts`'s `voidMovement`)
 * restores the allocated quantity back onto the batches it drew from,
 * but it does not delete the movement or its `movement_allocations`
 * rows — they stay for history. Reading those allocation rows as truth
 * without first filtering their parent movement by `voided_at` would
 * double-count a voided sale's cost; joining through the movement, as
 * this does, correctly excludes it.
 *
 * Returns an empty `Map` (never throws) when no OUT movement falls in
 * range — same sparse-map convention as `getPurchasesByDate` and
 * `lib/calendar.ts`'s `getMonthActivity`.
 */
export async function getStockOutValueByDate(
  adminSupabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const { data: movements, error: movementsError } = await adminSupabase
    .from("stock_movements")
    .select("id, movement_date")
    .eq("type", "OUT")
    .is("voided_at", null)
    .gte("movement_date", startDate)
    .lte("movement_date", endDate);

  if (movementsError) {
    throw movementsError;
  }

  const movementRows = (movements ?? []) as StockOutMovementRow[];
  if (movementRows.length === 0) {
    return new Map();
  }

  const movementIds = movementRows.map((m) => m.id);
  const dateByMovementId = new Map<string, string>();
  for (const movement of movementRows) {
    dateByMovementId.set(movement.id, movement.movement_date);
  }

  const { data: allocations, error: allocationsError } = await adminSupabase
    .from("movement_allocations")
    .select("movement_id, qty_allocated, unit_cost_at_allocation")
    .in("movement_id", movementIds);

  if (allocationsError) {
    throw allocationsError;
  }

  const totalsByDate = new Map<string, number>();
  for (const allocation of (allocations ?? []) as AllocationRow[]) {
    const date = dateByMovementId.get(allocation.movement_id);
    if (!date) {
      continue;
    }
    const cost = Number(allocation.qty_allocated) * Number(allocation.unit_cost_at_allocation);
    totalsByDate.set(date, (totalsByDate.get(date) ?? 0) + cost);
  }

  return totalsByDate;
}
