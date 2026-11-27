import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One `item_fitments` row (see supabase/migrations/0022_item_fitments.sql),
 * joined with the car make's name for display. `makeName` is `null` both
 * when `makeId` is `null` and when the joined make row can't be found.
 */
export interface ItemFitment {
  id: string;
  itemId: string;
  makeId: string | null;
  makeName: string | null;
  model: string | null;
  variant: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  createdAt: string;
}

/**
 * Fields accepted when replacing an item's fitments via
 * `replaceFitmentsForItem`, and the shape `parseFitmentsJson` produces from
 * client form input. `id` is present when the entry is an existing fitment
 * being resubmitted unchanged (or edited in place), and absent for a brand
 * new fitment.
 */
export interface FitmentInput {
  id?: string;
  makeId: string | null;
  model: string | null;
  variant: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

type FitmentRow = {
  id: string;
  item_id: string;
  make_id: string | null;
  model: string | null;
  variant: string | null;
  year_from: number | null;
  year_to: number | null;
  created_at: string;
  car_makes: { name: string } | { name: string }[] | null;
};

const FITMENT_SELECT =
  "id, item_id, make_id, model, variant, year_from, year_to, created_at, car_makes(name)";

// PostgREST's hard per-request row cap (`max_rows`, supabase/config.toml).
// The bulk `.in("item_id", [...])` query below pages by this size — looping
// until a page comes back shorter than it — so a set of items whose TOTAL
// fitment rows exceeds 1000 is never silently truncated (which would make
// the newest fitments vanish from an item's display and search text with
// no error at all).
const PAGE_SIZE = 1000;

// Splits a long `.in("item_id", [...])` id list into requests comfortably
// under the URL length that produces an HTTP 414 on this project's own
// local PostgREST (measured at ~216 UUIDs).
const CHUNK_SIZE = 150;

// The three helpers below are a deliberate per-file copy of the same
// shape in lib/reports.ts (which added them for exactly these two
// PostgREST limits — see Finding 1 of the branch-wide review that
// introduced them there). This codebase's convention is a local copy per
// file rather than a shared util module, so that's what this follows.

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
 * the caller's query to order by a unique-per-row key for a stable,
 * non-overlapping cursor — until a page comes back with fewer than
 * `PAGE_SIZE` rows, merging every page's rows into one array. Throws
 * whatever error a page returns, same as every other query here.
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
 * Runs one `.in("item_id", chunk)` query per `CHUNK_SIZE`-sized slice of
 * `ids` (keeping request URLs short enough to avoid PostgREST's 414), each
 * slice itself paged via `fetchAllPages` (keeping any single slice's
 * result set from being silently capped at 1000 rows), and merges every
 * chunk's rows into one array.
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

function toItemFitment(row: FitmentRow): ItemFitment {
  const carMake = Array.isArray(row.car_makes) ? row.car_makes[0] : row.car_makes;
  return {
    id: row.id,
    itemId: row.item_id,
    makeId: row.make_id,
    makeName: carMake?.name ?? null,
    model: row.model,
    variant: row.variant,
    yearFrom: row.year_from,
    yearTo: row.year_to,
    createdAt: row.created_at,
  };
}

/** Lists `itemId`'s fitments, oldest first. */
export async function listFitmentsForItem(
  supabase: SupabaseClient,
  itemId: string
): Promise<ItemFitment[]> {
  const { data, error } = await supabase
    .from("item_fitments")
    .select(FITMENT_SELECT)
    .eq("item_id", itemId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown as FitmentRow[]).map(toItemFitment);
}

/**
 * Bulk-fetches fitments for multiple items, keyed by item id. Each item's
 * list is ordered the same as `listFitmentsForItem`'s (oldest first); an
 * item with no fitments is simply absent from the map.
 *
 * Not one query: chunked by item id and paged within each chunk via
 * `fetchAllForIds` above, because the callers of this function (the Items
 * list, the Stock List and its PDF/Excel exports, and both Reports
 * item-activity views) routinely pass every item in the catalogue. A
 * single unchunked `.in("item_id", [...])` 414s past ~216 ids, and a
 * single unpaged query silently drops everything past PostgREST's 1000-row
 * cap — and since the order is global `created_at asc`, what would be
 * dropped is precisely the newest fitments, i.e. items quietly losing
 * their vehicle display and search text with no error raised. Per-item
 * ordering is unaffected by chunking: each item id appears in exactly one
 * chunk, and chunks are merged in order.
 */
export async function listFitmentsForItems(
  supabase: SupabaseClient,
  itemIds: string[]
): Promise<Map<string, ItemFitment[]>> {
  const byItem = new Map<string, ItemFitment[]>();
  if (itemIds.length === 0) {
    return byItem;
  }

  // Typed as `unknown` then cast once below, exactly as the single-item
  // query does: the embedded `car_makes(name)` resource makes PostgREST's
  // inferred row type disagree with `FitmentRow`'s object-or-array shape.
  const rows = await fetchAllForIds<unknown>(itemIds, (idChunk, offset) =>
    supabase
      .from("item_fitments")
      .select(FITMENT_SELECT)
      .in("item_id", idChunk)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
  );

  for (const row of rows as FitmentRow[]) {
    const fitment = toItemFitment(row);
    const existing = byItem.get(fitment.itemId);
    if (existing) {
      existing.push(fitment);
    } else {
      byItem.set(fitment.itemId, [fitment]);
    }
  }

  return byItem;
}

/**
 * Replaces `itemId`'s full set of fitments with `fitments`, diffing by id
 * rather than deleting-and-reinserting everything: an input entry that
 * carries an existing fitment's `id` keeps that row's `id`/`created_at`
 * untouched; an existing fitment whose `id` is absent from the input is
 * deleted; every input entry that has no `id` (a brand new fitment) is
 * inserted as a fresh row. An input entry that carries an `id` is never
 * re-inserted or updated in place — it already exists in the database
 * unchanged, so the `id` field on `FitmentInput` is only ever used to
 * decide what survives, never written back as an insert value.
 *
 * The delete step uses `.in("id", idsToDelete)` (array form) rather than a
 * string-interpolated query, and is skipped entirely when there's nothing
 * to delete (an empty `.in()` array is a no-op query, but these ids
 * ultimately originate from client form input, so we don't rely on that
 * being safe — the call is just not made).
 *
 * Write order — insert first, then delete — is deliberate, and is a
 * smaller mitigation rather than real atomicity. These are two separate
 * statements over PostgREST with no surrounding transaction (introducing a
 * Postgres RPC to get one was weighed and declined: a bigger
 * architectural change than it's worth here, especially now that
 * `parseFitmentsJson` rejects the bad year data that was the most likely
 * real cause of an insert failure). So a failure between the two steps is
 * still possible; ordering only decides what it costs. Inserting first
 * means a throwing insert leaves the item with every one of its OLD tags
 * intact — nothing lost, the user simply sees the error and retries. The
 * previous delete-first order meant the same failure wiped the removed
 * tags and added none of the new ones. The transient state during a
 * successful call is an item briefly carrying both old and new tags
 * (a superset), which no reader can be harmed by: the worst case is a
 * list view showing a stale extra tag for a few milliseconds.
 */
export async function replaceFitmentsForItem(
  supabase: SupabaseClient,
  itemId: string,
  fitments: FitmentInput[]
): Promise<ItemFitment[]> {
  const existing = await listFitmentsForItem(supabase, itemId);
  const keepIds = new Set(fitments.map((f) => f.id).filter((id): id is string => Boolean(id)));
  const idsToDelete = existing.map((f) => f.id).filter((id) => !keepIds.has(id));

  const toInsert = fitments.filter((f) => !f.id);
  if (toInsert.length > 0) {
    // Postgres evaluates now() once per statement, so a bulk insert of 2+
    // rows would otherwise give every row the exact same created_at,
    // leaving listFitmentsForItem's "created_at asc, id asc" order to fall
    // back on id — a random UUID unrelated to insertion order — to break
    // the tie. That silently breaks "oldest created_at = first displayed
    // tag" for the common case of adding multiple fitments in one save.
    // Assigning strictly increasing timestamps ourselves, in input order,
    // keeps the first entry of toInsert the oldest and therefore first.
    const now = Date.now();
    const { error } = await supabase.from("item_fitments").insert(
      toInsert.map((f, i) => ({
        item_id: itemId,
        make_id: f.makeId,
        model: f.model,
        variant: f.variant,
        year_from: f.yearFrom,
        year_to: f.yearTo,
        created_at: new Date(now + i).toISOString(),
      }))
    );
    if (error) {
      throw error;
    }
  }

  if (idsToDelete.length > 0) {
    const { error } = await supabase.from("item_fitments").delete().in("id", idsToDelete);
    if (error) {
      throw error;
    }
  }

  return listFitmentsForItem(supabase, itemId);
}

/**
 * Renders one fitment as a single display string, e.g.
 * "Toyota Vios E 2018–2022". Joins only the parts that are set, with no
 * stray spaces; falls back to "—" when every part is empty (shouldn't
 * occur via the UI — the fitment editor requires at least one field — but
 * stay defensive).
 */
export function formatFitment(fitment: {
  makeName: string | null;
  model: string | null;
  variant: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}): string {
  const yearPart =
    fitment.yearFrom == null
      ? null
      : fitment.yearFrom === fitment.yearTo
        ? String(fitment.yearFrom)
        : `${fitment.yearFrom}–${fitment.yearTo}`;

  const parts = [fitment.makeName, fitment.model, fitment.variant, yearPart].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : "—";
}

/**
 * Summarizes a list of fitments (already ordered oldest-first, as
 * `listFitmentsForItem`/`listFitmentsForItems` return them) into a short
 * `display` string for table/card UIs and a longer `searchText` string
 * that includes every fitment, for client-side filtering.
 */
export function summarizeFitments(fitments: ItemFitment[]): {
  display: string;
  searchText: string;
} {
  if (fitments.length === 0) {
    return { display: "—", searchText: "" };
  }

  const formatted = fitments.map(formatFitment);
  const [first] = formatted;
  const display = formatted.length === 1 ? first : `${first} +${formatted.length - 1}`;

  return { display, searchText: formatted.join(" ") };
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Earliest vehicle year accepted — matches the editor's `min` attribute. */
const MIN_FITMENT_YEAR = 1900;

/**
 * Latest vehicle year accepted: next year, matching the editor's
 * `max={new Date().getFullYear() + 1}` (next model year is legitimately
 * on sale). Computed per call rather than at module load so a
 * long-running server process doesn't keep rejecting the new year after
 * midnight on December 31st.
 */
function maxFitmentYear(): number {
  return new Date().getFullYear() + 1;
}

/**
 * Coerces a parsed year to `null` unless it's a whole number inside
 * `[1900, currentYear + 1]`. `year_from`/`year_to` are `integer` columns,
 * so a fractional value would silently be rounded by Postgres rather than
 * rejected — treat it as not-a-year instead.
 */
function toNullableYear(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  if (value < MIN_FITMENT_YEAR || value > maxFitmentYear()) {
    return null;
  }
  return value;
}

/**
 * Parses a JSON-encoded array of fitment entries submitted from a form
 * field, coercing each entry into a `FitmentInput`. Returns `[]` for
 * empty/invalid input (not JSON, or JSON that doesn't parse to an array)
 * rather than throwing — callers treat "no fitments" the same as
 * "malformed fitments field".
 *
 * This is the ONLY gate between client-controlled JSON and the
 * `item_fitments` rows that get written: the fitment editor's own `min`/
 * `max` year bounds and its "don't add a blank or inverted-range tag"
 * rules live in the browser, and a hand-crafted POST to the Server Action
 * bypasses the UI entirely. So the same three rules are re-applied here,
 * defensively, on every entry:
 *
 * - A year outside `[1900, currentYear + 1]` (or fractional, or not a
 *   number at all) becomes `null` — see `toNullableYear`.
 * - An inverted range (`yearFrom > yearTo`, e.g. 2022–2018, which
 *   `formatFitment` would render as the nonsense "2022–2018") drops BOTH
 *   years. Which of the two is the typo isn't knowable from here, so
 *   neither is guessed at.
 * - An entry left with no content at all — no make, model, variant, or
 *   year — is dropped from the result, mirroring the editor's "no blank
 *   tags" rule. This includes an entry that became blank only because its
 *   years were just nulled out by the two rules above.
 */
export function parseFitmentsJson(raw: string): FitmentInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      let yearFrom = toNullableYear(e.yearFrom);
      let yearTo = toNullableYear(e.yearTo);
      if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
        yearFrom = null;
        yearTo = null;
      }
      return {
        id: typeof e.id === "string" ? e.id : undefined,
        makeId: toNullableString(e.makeId),
        model: toNullableString(e.model),
        variant: toNullableString(e.variant),
        yearFrom,
        yearTo,
      };
    })
    .filter(
      (f) =>
        f.makeId != null ||
        f.model != null ||
        f.variant != null ||
        f.yearFrom != null ||
        f.yearTo != null
    );
}

/**
 * Distinct, non-empty `variant` values across all fitments, sorted, for
 * `<datalist>` suggestions on the fitment editor (Task 9). Model suggestions
 * now come from the `car_models` table instead (see `lib/car-models.ts`).
 *
 * Moved here from `lib/items.ts` (which read `items.model`/`items.variant`
 * before per-item make/model/variant/year columns were replaced by
 * multi-row fitments) — see that function's original docstring for why
 * the column is fetched in an unfiltered query and filtered/deduped
 * independently rather than server-side with `.not(...)`.
 */
export async function listDistinctVariants(
  supabase: SupabaseClient
): Promise<string[]> {
  const { data, error } = await supabase.from("item_fitments").select("variant");

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as { variant: string | null }[];

  const variants = new Set<string>();
  for (const row of rows) {
    if (row.variant) {
      variants.add(row.variant);
    }
  }

  return Array.from(variants).sort();
}
