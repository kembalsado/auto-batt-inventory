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
 * Bulk-fetches fitments for multiple items in one query, keyed by item id.
 * Each item's list is ordered the same as `listFitmentsForItem`'s
 * (oldest first); an item with no fitments is simply absent from the map.
 */
export async function listFitmentsForItems(
  supabase: SupabaseClient,
  itemIds: string[]
): Promise<Map<string, ItemFitment[]>> {
  const byItem = new Map<string, ItemFitment[]>();
  if (itemIds.length === 0) {
    return byItem;
  }

  const { data, error } = await supabase
    .from("item_fitments")
    .select(FITMENT_SELECT)
    .in("item_id", itemIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as unknown as FitmentRow[]) {
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
 */
export async function replaceFitmentsForItem(
  supabase: SupabaseClient,
  itemId: string,
  fitments: FitmentInput[]
): Promise<ItemFitment[]> {
  const existing = await listFitmentsForItem(supabase, itemId);
  const keepIds = new Set(fitments.map((f) => f.id).filter((id): id is string => Boolean(id)));
  const idsToDelete = existing.map((f) => f.id).filter((id) => !keepIds.has(id));

  if (idsToDelete.length > 0) {
    const { error } = await supabase.from("item_fitments").delete().in("id", idsToDelete);
    if (error) {
      throw error;
    }
  }

  const toInsert = fitments.filter((f) => !f.id);
  if (toInsert.length > 0) {
    const { error } = await supabase.from("item_fitments").insert(
      toInsert.map((f) => ({
        item_id: itemId,
        make_id: f.makeId,
        model: f.model,
        variant: f.variant,
        year_from: f.yearFrom,
        year_to: f.yearTo,
      }))
    );
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

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * Parses a JSON-encoded array of fitment entries submitted from a form
 * field, coercing each entry into a `FitmentInput`. Returns `[]` for
 * empty/invalid input (not JSON, or JSON that doesn't parse to an array)
 * rather than throwing — callers treat "no fitments" the same as
 * "malformed fitments field".
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

  return parsed.map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    return {
      id: typeof e.id === "string" ? e.id : undefined,
      makeId: toNullableString(e.makeId),
      model: toNullableString(e.model),
      variant: toNullableString(e.variant),
      yearFrom: toNullableNumber(e.yearFrom),
      yearTo: toNullableNumber(e.yearTo),
    };
  });
}

/**
 * Distinct, non-empty `model` and `variant` values across all fitments,
 * sorted, for `<datalist>` suggestions on the fitment editor (Tasks 8/9).
 *
 * Moved here from `lib/items.ts` (which read `items.model`/`items.variant`
 * before per-item make/model/variant/year columns were replaced by
 * multi-row fitments) — see that function's original docstring for why
 * both columns are fetched in one unfiltered query and filtered/deduped
 * independently rather than server-side with `.not(...).not(...)`.
 */
export async function listDistinctModelsAndVariants(
  supabase: SupabaseClient
): Promise<{ models: string[]; variants: string[] }> {
  const { data, error } = await supabase.from("item_fitments").select("model, variant");

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as { model: string | null; variant: string | null }[];

  const models = new Set<string>();
  const variants = new Set<string>();
  for (const row of rows) {
    if (row.model) {
      models.add(row.model);
    }
    if (row.variant) {
      variants.add(row.variant);
    }
  }

  return {
    models: Array.from(models).sort(),
    variants: Array.from(variants).sort(),
  };
}
