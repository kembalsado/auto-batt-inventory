import type { SupabaseClient } from "@supabase/supabase-js";
import { daysInMonth, firstDayOfMonth, lastDayOfMonth } from "@/lib/calendar";

// PostgREST's hard per-request row cap (`max_rows`, supabase/config.toml).
// Every bulk query in this file pages by this size — looping until a page
// comes back shorter than it — so a date range or id-list chunk that
// happens to exceed 1000 rows (easy for `movement_allocations` under
// multi-batch FIFO draws) is never silently truncated.
const PAGE_SIZE = 1000;

// Splits a long `.in("id", [...])` id list into requests comfortably under
// the URL length that produces an HTTP 414 on this project's own local
// PostgREST (measured at ~216 UUIDs) — see Finding 1 of the branch-wide
// review that introduced this constant.
const CHUNK_SIZE = 150;

/** Splits `items` into consecutive chunks of at most `size` elements each. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs `queryPage(offset)` repeatedly — paging by `PAGE_SIZE`, relying on
 * the caller's query to `.order("id")` for a stable, non-overlapping
 * cursor — until a page comes back with fewer than `PAGE_SIZE` rows,
 * merging every page's rows into one array. Throws whatever error a page
 * returns, same as every other query in this file.
 */
async function fetchAllPages<T>(
  queryPage: (
    offset: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await queryPage(offset);
    if (error) {
      throw error;
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }
  return rows;
}

/**
 * Runs one `.in("id", chunk)`-style query per `CHUNK_SIZE`-sized slice of
 * `ids` (keeping request URLs short enough to avoid PostgREST's 414), each
 * slice itself paged via `fetchAllPages` (keeping any single slice's
 * result set from being silently capped at 1000 rows), and merges every
 * chunk's rows into one array. The shared shape both id-list bulk queries
 * below (`batches_for_viewer`, `movement_allocations`) page through.
 */
async function fetchAllForIds<T>(
  ids: string[],
  queryPage: (
    idChunk: string[],
    offset: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (const idChunk of chunk(ids, CHUNK_SIZE)) {
    const chunkRows = await fetchAllPages<T>((offset) =>
      queryPage(idChunk, offset)
    );
    rows.push(...chunkRows);
  }
  return rows;
}

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
 *
 * Both bulk reads below — the date-range `stock_movements` query and the
 * `batches_for_viewer` lookup keyed by the distinct `batch_id`s collected
 * from it — are paged via `fetchAllPages`/`fetchAllForIds` rather than
 * read in one shot: at realistic volume a single date range (e.g. a full
 * year) can exceed PostgREST's 1000-row cap, and a single `.in(...)` id
 * list long enough can exceed the URL length PostgREST accepts (HTTP 414).
 * See Finding 1 of the branch-wide review.
 */
export async function getPurchasesByDate(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const movementRows = await fetchAllPages<PurchaseMovementRow>((offset) =>
    supabase
      .from("stock_movements")
      .select("movement_date, quantity, batch_id")
      .eq("type", "IN")
      .is("voided_at", null)
      .gte("movement_date", startDate)
      .lte("movement_date", endDate)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
  );

  if (movementRows.length === 0) {
    return new Map();
  }

  const batchIds = Array.from(new Set(movementRows.map((m) => m.batch_id)));

  const batchRows = await fetchAllForIds<ViewerBatchLookupRow>(
    batchIds,
    (idChunk, offset) =>
      supabase
        .from("batches_for_viewer")
        .select("id, unit_cost, source")
        .in("id", idChunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
  );

  const batchById = new Map<string, ViewerBatchLookupRow>();
  for (const batch of batchRows) {
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
 *
 * Both bulk reads below are paged the same way as `getPurchasesByDate`'s
 * (`fetchAllPages`/`fetchAllForIds`) — the `movement_allocations` lookup
 * especially so, since multi-batch FIFO draws can put far more than 1000
 * allocation rows behind even a modest-looking id chunk, and PostgREST
 * would otherwise silently return only the first 1000 of them. See
 * Finding 1 of the branch-wide review.
 */
export async function getStockOutValueByDate(
  adminSupabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const movementRows = await fetchAllPages<StockOutMovementRow>((offset) =>
    adminSupabase
      .from("stock_movements")
      .select("id, movement_date")
      .eq("type", "OUT")
      .is("voided_at", null)
      .gte("movement_date", startDate)
      .lte("movement_date", endDate)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
  );

  if (movementRows.length === 0) {
    return new Map();
  }

  const movementIds = movementRows.map((m) => m.id);
  const dateByMovementId = new Map<string, string>();
  for (const movement of movementRows) {
    dateByMovementId.set(movement.id, movement.movement_date);
  }

  const allocationRows = await fetchAllForIds<AllocationRow>(
    movementIds,
    (idChunk, offset) =>
      adminSupabase
        .from("movement_allocations")
        .select("movement_id, qty_allocated, unit_cost_at_allocation")
        .in("movement_id", idChunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
  );

  const totalsByDate = new Map<string, number>();
  for (const allocation of allocationRows) {
    const date = dateByMovementId.get(allocation.movement_id);
    if (!date) {
      continue;
    }
    const cost = Number(allocation.qty_allocated) * Number(allocation.unit_cost_at_allocation);
    totalsByDate.set(date, (totalsByDate.get(date) ?? 0) + cost);
  }

  return totalsByDate;
}

/** Row shape read from the single-day `stock_movements` query below. */
interface DayMovementRow {
  id: string;
  item_id: string;
  type: "IN" | "OUT";
  quantity: number;
  batch_id: string | null;
}

/** Row shape read from the `batches_for_viewer` lookup below (IN side). */
interface DayViewerBatchRow {
  id: string;
  unit_cost: number | null;
  source: "purchase" | "opening_stock";
}

/** Row shape read from the `movement_allocations` lookup below (OUT side). */
interface DayAllocationRow {
  movement_id: string;
  qty_allocated: number;
  unit_cost_at_allocation: number;
}

/** Row shape read from the bulk `items` lookup below. */
interface ItemActivityItemRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  model: string | null;
  variant: string | null;
  year: number | null;
  car_makes: { name: string } | null;
}

/** One item's movement/cost totals for a single calendar day. */
export interface ItemActivity {
  itemId: string;
  sku: string;
  name: string;
  /** "Make Model Variant Year", skipping unset parts — "—" when none are set. */
  vehicle: string;
  unit: string;
  qtyIn: number;
  qtyOut: number;
  costIn: number;
  costOut: number;
}

/**
 * Breaks `getPurchasesByDate`/`getStockOutValueByDate`'s all-items totals
 * down per item for one calendar `date`: which items had any non-voided
 * movement that day, and each one's IN/OUT quantity and cost, kept
 * separate (an item can be both received and sold on the same day).
 *
 * Single-day, unpaged queries throughout — this follows `lib/email/
 * dailySummary.ts`'s `buildDailySummary` precedent, not `getPurchasesByDate`/
 * `getStockOutValueByDate`'s `fetchAllPages`/`fetchAllForIds` paging, since
 * a single day's row count doesn't approach PostgREST's 1000-row cap at
 * this app's scale (that paging exists for date-*range* queries spanning a
 * month or a year).
 *
 * Same two-step, application-joined shape as the two range functions
 * above, run for IN and OUT separately since they read different cost
 * sources:
 * - IN: every non-voided IN movement on `date`, then — by the distinct
 *   `batch_id`s collected from them — those batches via
 *   `batches_for_viewer` (not raw `batches`), read with `supabase` so
 *   `unit_cost` resolves against the caller's own session the same way
 *   `getPurchasesByDate` does. `qtyIn` accumulates every IN movement's
 *   quantity unconditionally; `costIn` only adds a batch's
 *   `quantity * unit_cost` when `source === "purchase"` and `unit_cost`
 *   is non-null — an opening-stock import (`lib/import.ts`) still shows
 *   its quantity, just with zero cost, mirroring `getPurchasesByDate`'s
 *   purchase-only cost rule without dropping the row entirely.
 * - OUT: every non-voided OUT movement on `date`, then — by their ids —
 *   the `movement_allocations` rows they produced, read with
 *   `adminSupabase` (the only client with any readable path to that
 *   table — see `getStockOutValueByDate`). `qtyOut` accumulates every OUT
 *   movement's quantity unconditionally; `costOut` sums
 *   `qty_allocated * unit_cost_at_allocation` per the allocation's parent
 *   movement's `item_id`. Voided-OUT exclusion happens at the
 *   `stock_movements` step (`voided_at is null`), the same
 *   join-through-the-movement reasoning `getStockOutValueByDate`'s
 *   docstring explains in full.
 *
 * `supabase` must be a client with a real signed-in session (the
 * `batches_for_viewer` cost gate resolves against `auth.uid()`, which is
 * always null for the service-role client — see `getPurchasesByDate`).
 * `adminSupabase` must be the service-role client (the only readable path
 * to `movement_allocations`).
 *
 * Deliberately does not filter the final `items` lookup by
 * `is_active = true`: a deactivated item that moved stock on `date` still
 * has a real transaction worth showing in the breakdown — unlike the
 * Stock List (lib/stock-list.ts), which is a "what's on the shelves right
 * now" view, this is a historical record of what happened on a given day.
 *
 * Returns `[]` (never throws) when no item has any qualifying movement on
 * `date` — the same "no entry means nothing happened" convention every
 * other function in this file uses, just as an array instead of a map
 * since the caller always wants every item's row, not a lookup by date.
 * Sorted by `name`, matching `lib/stock-list.ts`'s `.order("name")`
 * convention for item listings.
 */
export async function getItemActivityByDate(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  date: string
): Promise<ItemActivity[]> {
  const { data: movementData, error: movementError } = await supabase
    .from("stock_movements")
    .select("id, item_id, type, quantity, batch_id")
    .eq("movement_date", date)
    .is("voided_at", null);

  if (movementError) {
    throw movementError;
  }

  const movements = (movementData ?? []) as DayMovementRow[];
  if (movements.length === 0) {
    return [];
  }

  const inMovements = movements.filter((m) => m.type === "IN");
  const outMovements = movements.filter((m) => m.type === "OUT");

  const qtyInByItemId = new Map<string, number>();
  const costInByItemId = new Map<string, number>();
  if (inMovements.length > 0) {
    const batchIds = Array.from(
      new Set(inMovements.map((m) => m.batch_id).filter((id): id is string => id != null))
    );

    const batchById = new Map<string, DayViewerBatchRow>();
    if (batchIds.length > 0) {
      const { data: batchData, error: batchError } = await supabase
        .from("batches_for_viewer")
        .select("id, unit_cost, source")
        .in("id", batchIds);

      if (batchError) {
        throw batchError;
      }

      for (const batch of (batchData ?? []) as DayViewerBatchRow[]) {
        batchById.set(batch.id, batch);
      }
    }

    for (const movement of inMovements) {
      qtyInByItemId.set(
        movement.item_id,
        (qtyInByItemId.get(movement.item_id) ?? 0) + Number(movement.quantity)
      );

      const batch = movement.batch_id ? batchById.get(movement.batch_id) : undefined;
      if (!batch || batch.source !== "purchase" || batch.unit_cost == null) {
        continue;
      }
      const cost = Number(movement.quantity) * Number(batch.unit_cost);
      costInByItemId.set(movement.item_id, (costInByItemId.get(movement.item_id) ?? 0) + cost);
    }
  }

  const qtyOutByItemId = new Map<string, number>();
  const costOutByItemId = new Map<string, number>();
  if (outMovements.length > 0) {
    const itemIdByMovementId = new Map<string, string>();
    for (const movement of outMovements) {
      itemIdByMovementId.set(movement.id, movement.item_id);
      qtyOutByItemId.set(
        movement.item_id,
        (qtyOutByItemId.get(movement.item_id) ?? 0) + Number(movement.quantity)
      );
    }

    const movementIds = outMovements.map((m) => m.id);
    const { data: allocationData, error: allocationError } = await adminSupabase
      .from("movement_allocations")
      .select("movement_id, qty_allocated, unit_cost_at_allocation")
      .in("movement_id", movementIds);

    if (allocationError) {
      throw allocationError;
    }

    for (const allocation of (allocationData ?? []) as DayAllocationRow[]) {
      const itemId = itemIdByMovementId.get(allocation.movement_id);
      if (!itemId) {
        continue;
      }
      const cost = Number(allocation.qty_allocated) * Number(allocation.unit_cost_at_allocation);
      costOutByItemId.set(itemId, (costOutByItemId.get(itemId) ?? 0) + cost);
    }
  }

  const itemIds = Array.from(
    new Set([...qtyInByItemId.keys(), ...qtyOutByItemId.keys()])
  );
  if (itemIds.length === 0) {
    return [];
  }

  const { data: itemData, error: itemsError } = await supabase
    .from("items")
    .select("id, sku, name, unit, model, variant, year, car_makes(name)")
    .in("id", itemIds);

  if (itemsError) {
    throw itemsError;
  }

  const items = (itemData ?? []) as unknown as ItemActivityItemRow[];

  const activity: ItemActivity[] = items.map((item) => ({
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    vehicle:
      [item.car_makes?.name, item.model, item.variant, item.year]
        .filter(Boolean)
        .join(" ") || "—",
    unit: item.unit,
    qtyIn: qtyInByItemId.get(item.id) ?? 0,
    qtyOut: qtyOutByItemId.get(item.id) ?? 0,
    costIn: costInByItemId.get(item.id) ?? 0,
    costOut: costOutByItemId.get(item.id) ?? 0,
  }));

  activity.sort((a, b) => a.name.localeCompare(b.name));
  return activity;
}

/** Shared Purchases/Stock-out-value pair every report shape rolls up from. */
export interface AmountTotals {
  purchases: number;
  stockOutValue: number;
}

/** One calendar day's totals. */
export interface DailyReport extends AmountTotals {
  /** "YYYY-MM-DD" */
  date: string;
}

/**
 * A whole month's totals, plus a zero-filled, in-order, one-entry-per-day
 * breakdown (`days.length === daysInMonth(year, month)` always — never
 * sparse, so a page rendering a day-by-day table can index straight into
 * it without a "day N has no entry" fallback).
 */
export interface MonthlyReport extends AmountTotals {
  year: number;
  /** 1-12 */
  month: number;
  days: (AmountTotals & { date: string })[];
}

/**
 * A whole year's totals, plus a zero-filled, in-order, one-entry-per-month
 * breakdown (`months.length === 12` always, `months[i].month === i + 1`).
 */
export interface AnnualReport extends AmountTotals {
  year: number;
  months: (AmountTotals & { month: number })[];
}

/** "MM" / "DD" zero-padded to two digits, matching lib/calendar.ts's own
 * inline `padStart(2, "0")` convention for building "YYYY-MM-DD" strings. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * One date's Purchases + Stock-out-value totals. Thin composition over
 * `getPurchasesByDate`/`getStockOutValueByDate` with both ends of the
 * range pinned to the same single day, run in parallel since neither
 * depends on the other's result.
 *
 * `supabase` must be a client with a real signed-in session (see
 * `getPurchasesByDate`'s docstring) — `adminSupabase` must be the
 * service-role client (see `getStockOutValueByDate`'s docstring). Passing
 * the wrong one to the wrong parameter silently zeroes out the
 * corresponding total rather than throwing, same as the functions it
 * composes.
 */
export async function getDailyReport(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  date: string
): Promise<DailyReport> {
  const [purchasesByDate, stockOutValueByDate] = await Promise.all([
    getPurchasesByDate(supabase, date, date),
    getStockOutValueByDate(adminSupabase, date, date),
  ]);

  return {
    date,
    purchases: purchasesByDate.get(date) ?? 0,
    stockOutValue: stockOutValueByDate.get(date) ?? 0,
  };
}

/**
 * A whole month's Purchases + Stock-out-value totals, plus a day-by-day
 * breakdown covering every calendar day in `year`-`month` (via
 * `lib/calendar.ts`'s `firstDayOfMonth`/`lastDayOfMonth`/`daysInMonth` —
 * reused rather than re-derived so this stays correct for leap-year
 * Februaries the same way the existing calendar grid does).
 *
 * Both range queries run once each, over the whole month, in parallel —
 * not one query per day — then get read back per day with `?? 0`, the
 * same sparse-map convention `getPurchasesByDate`/`getStockOutValueByDate`
 * already use. The month's totals are the sum of the zero-filled `days`
 * array, so they always agree with it by construction.
 */
export async function getMonthlyReport(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  year: number,
  month: number
): Promise<MonthlyReport> {
  const startDate = firstDayOfMonth(year, month);
  const endDate = lastDayOfMonth(year, month);

  const [purchasesByDate, stockOutValueByDate] = await Promise.all([
    getPurchasesByDate(supabase, startDate, endDate),
    getStockOutValueByDate(adminSupabase, startDate, endDate),
  ]);

  const days: (AmountTotals & { date: string })[] = [];
  let purchases = 0;
  let stockOutValue = 0;
  const totalDays = daysInMonth(year, month);
  for (let day = 1; day <= totalDays; day++) {
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const dayPurchases = purchasesByDate.get(date) ?? 0;
    const dayStockOutValue = stockOutValueByDate.get(date) ?? 0;
    days.push({ date, purchases: dayPurchases, stockOutValue: dayStockOutValue });
    purchases += dayPurchases;
    stockOutValue += dayStockOutValue;
  }

  return { year, month, days, purchases, stockOutValue };
}

/**
 * A whole year's Purchases + Stock-out-value totals, plus a
 * month-by-month breakdown (`months[0]` is January, `months[11]` is
 * December — `months[i].month === i + 1`).
 *
 * Both range queries run once each, over the whole year
 * (`${year}-01-01`..`${year}-12-31`), in parallel. Every date key the two
 * maps return is bucketed into its month by comparing characters 5-6 of
 * the "YYYY-MM-DD" key (the zero-padded "MM") against the loop's own
 * zero-padded month — plain string slicing, not a `Date` object, per the
 * project's existing calendar-date convention (see `lib/date.ts`,
 * `lib/calendar.ts`).
 */
export async function getAnnualReport(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  year: number
): Promise<AnnualReport> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const [purchasesByDate, stockOutValueByDate] = await Promise.all([
    getPurchasesByDate(supabase, startDate, endDate),
    getStockOutValueByDate(adminSupabase, startDate, endDate),
  ]);

  const months: (AmountTotals & { month: number })[] = [];
  let purchases = 0;
  let stockOutValue = 0;
  for (let month = 1; month <= 12; month++) {
    const monthKey = pad2(month);
    let monthPurchases = 0;
    for (const [date, amount] of purchasesByDate) {
      if (date.slice(5, 7) === monthKey) {
        monthPurchases += amount;
      }
    }
    let monthStockOutValue = 0;
    for (const [date, amount] of stockOutValueByDate) {
      if (date.slice(5, 7) === monthKey) {
        monthStockOutValue += amount;
      }
    }
    months.push({ month, purchases: monthPurchases, stockOutValue: monthStockOutValue });
    purchases += monthPurchases;
    stockOutValue += monthStockOutValue;
  }

  return { year, months, purchases, stockOutValue };
}
