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

/**
 * Row shape read from the single-day `stock_movements` query below.
 * `movement_date` is only actually selected by `getItemActivityByDateRange`'s
 * own range query below (`getItemActivityByDate`'s query already filters
 * server-side on a single known date, so it has no need to select the
 * column back) — shared here rather than duplicated into a second
 * near-identical interface.
 */
interface DayMovementRow {
  id: string;
  item_id: string;
  type: "IN" | "OUT";
  quantity: number;
  batch_id: string | null;
  /** ISO timestamp — when this movement was recorded, not just its date. */
  created_at: string;
  /** "YYYY-MM-DD" — optional because Supabase's untyped client infers this
   * interface's shape from each query's own select string, and
   * `getItemActivityByDate`'s query (unlike `getItemActivityByDateRange`'s)
   * doesn't select it — it already knows the date from its own parameter. */
  movement_date?: string;
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

/**
 * Same `items` row PostgREST actually returns, except `car_makes` typed as
 * the array shape the untyped Supabase client infers for a joined relation
 * (it can't tell `items -> car_makes` is a to-one join without generated
 * Database types) — only used to keep `fetchAllForIds`'s generic honest
 * about the query's real shape; cast to `ItemActivityItemRow[]` afterward,
 * same as the rest of this file does for `batches_for_viewer`/
 * `movement_allocations` rows that don't need this distinction.
 */
interface ItemActivityItemQueryRow extends Omit<ItemActivityItemRow, "car_makes"> {
  car_makes: { name: string }[] | null;
}

/** One non-voided movement on an `ItemActivity` row, individually. */
export interface ItemActivityMovement {
  movementId: string;
  type: "IN" | "OUT";
  /** ISO timestamp (`stock_movements.created_at`) — when this specific
   * movement was recorded, for display via `lib/date.ts`'s `manilaTime`. */
  occurredAt: string;
  quantity: number;
  /** This movement's own cost — `quantity * unit_cost` for an IN drawn from
   * a purchase batch (0 for an opening-stock import or an unresolved
   * cost), or the sum of this OUT's `movement_allocations` rows. Never a
   * per-item total; see `ItemActivity.movements` for that roll-up. */
  cost: number;
}

/** One item's individual movements for a single calendar day. */
export interface ItemActivity {
  itemId: string;
  sku: string;
  name: string;
  /** "Make Model Variant Year", skipping unset parts — "—" when none are set. */
  vehicle: string;
  unit: string;
  /** Every non-voided IN/OUT movement for this item on the date, sorted
   * chronologically (earliest first) by `occurredAt` — not bucketed by
   * type, so an IN and a later OUT on the same day appear in the order
   * they actually happened. */
  movements: ItemActivityMovement[];
}

/**
 * Breaks `getPurchasesByDate`/`getStockOutValueByDate`'s all-items totals
 * down per item for one calendar `date`: which items had any non-voided
 * movement that day, and each individual movement's own time, quantity,
 * and cost — not rolled up into a day total, since the point of this
 * breakdown is seeing which transaction happened first (an item can be
 * both received and sold, more than once each, on the same day).
 *
 * All four bulk reads below are paged/chunked via `fetchAllPages`/
 * `fetchAllForIds`, the same way `getPurchasesByDate`/
 * `getStockOutValueByDate` already page their equivalent reads — this does
 * *not* follow `lib/email/dailySummary.ts`'s `buildDailySummary` precedent
 * of a single unpaged query per table, because that reasoning doesn't
 * cover this function's `movement_allocations` read: unlike
 * `buildDailySummary`'s plain movements-only read, a single day's OUT
 * movements can each fan out into many allocation rows under multi-batch
 * FIFO draws, so even one day's worth can exceed PostgREST's 1000-row cap
 * or (via the distinct id list behind the `.in(...)`) its URL-length
 * limit. The range functions above need this paging for the same reason;
 * this function needs it for the same reason on a smaller, but not
 * negligibly smaller, scale.
 *
 * Same two-step, application-joined shape as the two range functions
 * above. The IN and OUT lookups read different cost sources via different
 * clients and don't depend on each other, so they run in one `Promise.all`
 * rather than one after the other:
 * - IN: every non-voided IN movement on `date`, then — by the distinct
 *   `batch_id`s collected from them — those batches via
 *   `batches_for_viewer` (not raw `batches`), read with `supabase` so
 *   `unit_cost` resolves against the caller's own session the same way
 *   `getPurchasesByDate` does. Each IN movement's own `quantity` carries
 *   through unconditionally; its `cost` is `quantity * unit_cost` only
 *   when its batch's `source === "purchase"` and `unit_cost` is
 *   non-null — an opening-stock import (`lib/import.ts`) still shows its
 *   quantity, just with zero cost, mirroring `getPurchasesByDate`'s
 *   purchase-only cost rule without dropping the row entirely.
 * - OUT: every non-voided OUT movement on `date`, then — by their ids —
 *   the `movement_allocations` rows they produced, read with
 *   `adminSupabase` (the only client with any readable path to that
 *   table — see `getStockOutValueByDate`). Each OUT movement's own
 *   `quantity` carries through unconditionally; its `cost` sums
 *   `qty_allocated * unit_cost_at_allocation` across every allocation
 *   *that specific movement* produced (a single OUT can draw from more
 *   than one batch under FIFO, fanning out into several allocation rows
 *   that all roll up into that one movement's cost). Voided-OUT exclusion
 *   happens at the `stock_movements` step (`voided_at is null`), the same
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
 * Items are sorted by `name`, matching `lib/stock-list.ts`'s
 * `.order("name")` convention for item listings; each item's own
 * `movements` are sorted chronologically (earliest first) by
 * `occurredAt`, answering "which transaction happened first" directly
 * rather than leaving the caller to sort a day total's components.
 */
export async function getItemActivityByDate(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  date: string
): Promise<ItemActivity[]> {
  const movements = await fetchAllPages<DayMovementRow>((offset) =>
    supabase
      .from("stock_movements")
      .select("id, item_id, type, quantity, batch_id, created_at")
      .eq("movement_date", date)
      .is("voided_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
  );

  if (movements.length === 0) {
    return [];
  }

  const inMovements = movements.filter((m) => m.type === "IN");
  const outMovements = movements.filter((m) => m.type === "OUT");

  // The IN side's batch-cost lookup and the OUT side's allocation-cost
  // lookup read different tables via different clients and don't depend on
  // each other — only on `movements` above — so they run in the same
  // `Promise.all` instead of one being awaited after the other, cutting a
  // full network round-trip off this function's latency on a day with both
  // IN and OUT activity (the common case for a drill-down someone actually
  // clicks into).
  const batchIds = Array.from(
    new Set(inMovements.map((m) => m.batch_id).filter((id): id is string => id != null))
  );
  const movementIds = outMovements.map((m) => m.id);

  const [batchRows, allocationRows] = await Promise.all([
    batchIds.length > 0
      ? fetchAllForIds<DayViewerBatchRow>(batchIds, (idChunk, offset) =>
          supabase
            .from("batches_for_viewer")
            .select("id, unit_cost, source")
            .in("id", idChunk)
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)
        )
      : Promise.resolve([] as DayViewerBatchRow[]),
    movementIds.length > 0
      ? fetchAllForIds<DayAllocationRow>(movementIds, (idChunk, offset) =>
          adminSupabase
            .from("movement_allocations")
            .select("movement_id, qty_allocated, unit_cost_at_allocation")
            .in("movement_id", idChunk)
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)
        )
      : Promise.resolve([] as DayAllocationRow[]),
  ]);

  const batchById = new Map<string, DayViewerBatchRow>();
  for (const batch of batchRows) {
    batchById.set(batch.id, batch);
  }

  // Each movement's own cost, keyed by movement id rather than item id —
  // the per-item roll-up this file used to compute here is now just
  // `movements.reduce(...)` at render/test time when anyone needs a total.
  const costByMovementId = new Map<string, number>();
  for (const movement of inMovements) {
    const batch = movement.batch_id ? batchById.get(movement.batch_id) : undefined;
    if (!batch || batch.source !== "purchase" || batch.unit_cost == null) {
      continue;
    }
    costByMovementId.set(movement.id, Number(movement.quantity) * Number(batch.unit_cost));
  }
  for (const allocation of allocationRows) {
    const cost = Number(allocation.qty_allocated) * Number(allocation.unit_cost_at_allocation);
    costByMovementId.set(
      allocation.movement_id,
      (costByMovementId.get(allocation.movement_id) ?? 0) + cost
    );
  }

  const movementsByItemId = new Map<string, ItemActivityMovement[]>();
  for (const movement of movements) {
    const list = movementsByItemId.get(movement.item_id) ?? [];
    list.push({
      movementId: movement.id,
      type: movement.type,
      occurredAt: movement.created_at,
      quantity: Number(movement.quantity),
      cost: costByMovementId.get(movement.id) ?? 0,
    });
    movementsByItemId.set(movement.item_id, list);
  }
  for (const list of movementsByItemId.values()) {
    list.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  const itemIds = Array.from(movementsByItemId.keys());
  if (itemIds.length === 0) {
    return [];
  }

  const itemRows = await fetchAllForIds<ItemActivityItemQueryRow>(
    itemIds,
    (idChunk, offset) =>
      supabase
        .from("items")
        .select("id, sku, name, unit, model, variant, year, car_makes(name)")
        .in("id", idChunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
  );

  const items = itemRows as unknown as ItemActivityItemRow[];

  const activity: ItemActivity[] = items.map((item) => ({
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    vehicle:
      [item.car_makes?.name, item.model, item.variant, item.year]
        .filter(Boolean)
        .join(" ") || "—",
    unit: item.unit,
    movements: movementsByItemId.get(item.id) ?? [],
  }));

  activity.sort((a, b) => a.name.localeCompare(b.name));
  return activity;
}

/** One calendar date's `ItemActivity` breakdown, as returned by
 * `getItemActivityByDateRange` below. */
export interface DailyItemActivity {
  /** "YYYY-MM-DD" */
  date: string;
  items: ItemActivity[];
}

/**
 * Same per-item/per-movement breakdown as `getItemActivityByDate`, extended
 * one grouping level: every non-voided IN/OUT movement across
 * `startDate`..`endDate` (inclusive), bucketed first by `movement_date` and
 * then by item — one range query per table instead of one call to
 * `getItemActivityByDate` per day in the range, for the same reason
 * `getPurchasesByDate`/`getStockOutValueByDate` query their own ranges once
 * rather than looping a single-date function.
 *
 * Same inclusion/cost rules as `getItemActivityByDate` (no `is_active`
 * filter, opening-stock imports included at zero cost, voided movements
 * excluded via `voided_at is null`) and the same client requirements
 * (`supabase` needs a real session for `batches_for_viewer`; `adminSupabase`
 * is the only client that can read `movement_allocations`).
 *
 * Returns `[]` when no date in the range has any qualifying movement.
 * Otherwise sparse and chronologically ordered — a date only appears when
 * it had at least one qualifying movement, same convention
 * `getPurchasesByDate` uses for its own date-keyed map.
 */
export async function getItemActivityByDateRange(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<DailyItemActivity[]> {
  const movements = await fetchAllPages<DayMovementRow>((offset) =>
    supabase
      .from("stock_movements")
      .select("id, item_id, type, quantity, batch_id, created_at, movement_date")
      .gte("movement_date", startDate)
      .lte("movement_date", endDate)
      .is("voided_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
  );

  if (movements.length === 0) {
    return [];
  }

  const inMovements = movements.filter((m) => m.type === "IN");
  const outMovements = movements.filter((m) => m.type === "OUT");

  // Same reasoning as getItemActivityByDate: the IN side's batch-cost
  // lookup and the OUT side's allocation-cost lookup don't depend on each
  // other, so they run in the same Promise.all. Resolved once across the
  // whole range (not once per date) — the same reason
  // getPurchasesByDate/getStockOutValueByDate query their own ranges once.
  const batchIds = Array.from(
    new Set(inMovements.map((m) => m.batch_id).filter((id): id is string => id != null))
  );
  const movementIds = outMovements.map((m) => m.id);

  const [batchRows, allocationRows] = await Promise.all([
    batchIds.length > 0
      ? fetchAllForIds<DayViewerBatchRow>(batchIds, (idChunk, offset) =>
          supabase
            .from("batches_for_viewer")
            .select("id, unit_cost, source")
            .in("id", idChunk)
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)
        )
      : Promise.resolve([] as DayViewerBatchRow[]),
    movementIds.length > 0
      ? fetchAllForIds<DayAllocationRow>(movementIds, (idChunk, offset) =>
          adminSupabase
            .from("movement_allocations")
            .select("movement_id, qty_allocated, unit_cost_at_allocation")
            .in("movement_id", idChunk)
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)
        )
      : Promise.resolve([] as DayAllocationRow[]),
  ]);

  const batchById = new Map<string, DayViewerBatchRow>();
  for (const batch of batchRows) {
    batchById.set(batch.id, batch);
  }

  const costByMovementId = new Map<string, number>();
  for (const movement of inMovements) {
    const batch = movement.batch_id ? batchById.get(movement.batch_id) : undefined;
    if (!batch || batch.source !== "purchase" || batch.unit_cost == null) {
      continue;
    }
    costByMovementId.set(movement.id, Number(movement.quantity) * Number(batch.unit_cost));
  }
  for (const allocation of allocationRows) {
    const cost = Number(allocation.qty_allocated) * Number(allocation.unit_cost_at_allocation);
    costByMovementId.set(
      allocation.movement_id,
      (costByMovementId.get(allocation.movement_id) ?? 0) + cost
    );
  }

  // Bucket by date first — the grouping level getItemActivityByDate
  // doesn't need, since it only ever handles one date at a time.
  const movementsByDate = new Map<string, DayMovementRow[]>();
  for (const movement of movements) {
    // Always present here — this function's own query selects it (unlike
    // getItemActivityByDate's, see DayMovementRow's docstring).
    const movementDate = movement.movement_date!;
    const list = movementsByDate.get(movementDate) ?? [];
    list.push(movement);
    movementsByDate.set(movementDate, list);
  }

  // Items lookup runs once across every distinct item touched anywhere in
  // the range, not once per date, to avoid redundant lookups for an item
  // that moved on more than one day within the range.
  const allItemIds = Array.from(new Set(movements.map((m) => m.item_id)));
  const itemRows = await fetchAllForIds<ItemActivityItemQueryRow>(
    allItemIds,
    (idChunk, offset) =>
      supabase
        .from("items")
        .select("id, sku, name, unit, model, variant, year, car_makes(name)")
        .in("id", idChunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
  );
  const items = itemRows as unknown as ItemActivityItemRow[];
  const itemById = new Map<string, ItemActivityItemRow>();
  for (const item of items) {
    itemById.set(item.id, item);
  }

  const dates = Array.from(movementsByDate.keys()).sort();

  return dates.map((date) => {
    const dayMovements = movementsByDate.get(date)!;

    const movementsByItemId = new Map<string, ItemActivityMovement[]>();
    for (const movement of dayMovements) {
      const list = movementsByItemId.get(movement.item_id) ?? [];
      list.push({
        movementId: movement.id,
        type: movement.type,
        occurredAt: movement.created_at,
        quantity: Number(movement.quantity),
        cost: costByMovementId.get(movement.id) ?? 0,
      });
      movementsByItemId.set(movement.item_id, list);
    }
    for (const list of movementsByItemId.values()) {
      list.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    }

    const dayItems: ItemActivity[] = Array.from(movementsByItemId.keys()).map((itemId) => {
      const item = itemById.get(itemId)!;
      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        vehicle:
          [item.car_makes?.name, item.model, item.variant, item.year]
            .filter(Boolean)
            .join(" ") || "—",
        unit: item.unit,
        movements: movementsByItemId.get(itemId) ?? [],
      };
    });
    dayItems.sort((a, b) => a.name.localeCompare(b.name));

    return { date, items: dayItems };
  });
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

/** The Reports page's resolved view/date state, as `parseReportsViewParams`
 * below derives it from a request's raw query-string params. */
export interface ReportsViewParams {
  view: "day" | "month" | "year";
  /** Always a valid "YYYY-MM-DD" — defaulted to `today` when the raw
   * `date` param is missing or malformed. */
  date: string;
  year: number;
  /** 1-12 */
  month: number;
}

/**
 * Resolves the Reports page's `?view=&date=&year=&month=` query params into
 * `ReportsViewParams`, defaulting anything missing or invalid against
 * `today`. Moved verbatim from `app/(dashboard)/reports/page.tsx`'s own
 * inline logic (same defaulting rules) so the page and the PDF/Excel export
 * routes (app/api/reports/pdf, app/api/reports/excel) can never interpret
 * the same query string differently.
 */
export function parseReportsViewParams(
  searchParams: { view?: string; date?: string; year?: string; month?: string },
  today: string
): ReportsViewParams {
  const { view: viewParam, date: dateParam, year: yearParam, month: monthParam } = searchParams;
  const [todayYear, todayMonth] = today.split("-").map(Number);

  const view: ReportsViewParams["view"] =
    viewParam === "day" || viewParam === "year" ? viewParam : "month";

  const year = Number.isFinite(Number(yearParam)) && yearParam ? Number(yearParam) : todayYear;
  const month =
    Number.isFinite(Number(monthParam)) && monthParam && Number(monthParam) >= 1 && Number(monthParam) <= 12
      ? Number(monthParam)
      : todayMonth;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  return { view, date, year, month };
}
