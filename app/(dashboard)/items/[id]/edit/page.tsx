import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { updateItem } from "@/lib/items";
import {
  parseFitmentsJson,
  listDistinctVariants,
  listFitmentsForItem,
} from "@/lib/item-fitments";
import { listCategories } from "@/lib/categories";
import { listCarMakes } from "@/lib/car-makes";
import { listCarModels } from "@/lib/car-models";
import { isUniqueViolation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteItemButton } from "./delete-item-button";
import { FitmentTagEditor, type FitmentChip } from "@/app/(dashboard)/items/fitment-tag-editor";

// Every field this form submits, as its raw (trimmed, still-a-string) form
// value — used both to call updateItem (after the usual null-coalescing
// below) and, unparsed, to round-trip the user's actual input back onto an
// error redirect via buildErrorRedirectParams. Keeping the raw strings separate
// from the parsed/nulled values (categoryId, etc.) means the error
// redirect always reflects exactly what was typed/selected, not a value
// that's already been defaulted or parsed. `fitments` is the tag editor's
// hidden-field JSON string, round-tripped the same way as every other
// field — see app/(dashboard)/items/new/page.tsx for the identical
// mechanism on the Add form.
interface RawItemFormFields {
  sku: string;
  name: string;
  categoryId: string;
  unit: string;
  lowStockThreshold: string;
  fitments: string;
}

/**
 * Builds the query string for an error redirect back to an item form,
 * round-tripping every field the user submitted (not just `sku`) so a
 * failed submission doesn't silently discard edits to every other field.
 * See Finding 4 of the branch-wide review: on the Edit form specifically,
 * losing unsaved edits here meant the form re-rendered fully populated
 * from the item's last-saved (pre-edit) values, and a user who only
 * noticed the SKU error would re-save those stale values over their own
 * changes with no warning.
 */
function buildErrorRedirectParams(
  error: string,
  fields: RawItemFormFields
): string {
  return new URLSearchParams({ error, ...fields }).toString();
}

async function updateItemAction(itemId: string, formData: FormData) {
  "use server";

  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const categoryIdRaw = String(formData.get("categoryId") ?? "").trim();
  const categoryId = categoryIdRaw || null;
  const unitRaw = String(formData.get("unit") ?? "").trim();
  const unit = unitRaw || "pcs";
  const lowStockThresholdRaw = String(
    formData.get("lowStockThreshold") ?? ""
  ).trim();
  const lowStockThreshold = lowStockThresholdRaw
    ? Number(lowStockThresholdRaw)
    : null;
  const fitmentsRaw = String(formData.get("fitments") ?? "[]");
  const fitments = parseFitmentsJson(fitmentsRaw);

  const rawFields: RawItemFormFields = {
    sku,
    name,
    categoryId: categoryIdRaw,
    unit: unitRaw,
    lowStockThreshold: lowStockThresholdRaw,
    fitments: fitmentsRaw,
  };

  if (!sku || !name) {
    redirect(
      `/items/${itemId}/edit?${buildErrorRedirectParams("missing-fields", rawFields)}`
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Same reasoning as the add form (app/(dashboard)/items/new/page.tsx): a
  // duplicate SKU is an everyday typo, not an exceptional condition, so
  // it's caught here and fed back inline instead of crashing to Next.js's
  // generic error page. The flag-then-redirect shape is deliberate —
  // `redirect()` throws a NEXT_REDIRECT control-flow error, so calling it
  // from inside the `try`/`catch` would have it swallowed by this handler.
  let duplicateSku = false;
  try {
    await updateItem(supabase, user.id, itemId, {
      sku,
      name,
      categoryId,
      unit,
      lowStockThreshold,
      fitments,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    duplicateSku = true;
  }

  if (duplicateSku) {
    redirect(
      `/items/${itemId}/edit?${buildErrorRedirectParams("duplicate-sku", rawFields)}`
    );
  }

  redirect(`/items/${itemId}`);
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-fields": "SKU and name are both required.",
  "duplicate-sku": "That SKU already exists — pick a different one.",
};

export default async function EditItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    sku?: string;
    name?: string;
    categoryId?: string;
    unit?: string;
    lowStockThreshold?: string;
    fitments?: string;
  }>;
}) {
  const { id } = await params;
  const {
    error,
    sku,
    name,
    categoryId,
    unit,
    lowStockThreshold,
    fitments: fitmentsRaw,
  } = await searchParams;
  const supabase = await createServerClient();

  const { data: item } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (!item) {
    notFound();
  }

  const [categories, makes, models, variants] = await Promise.all([
    listCategories(supabase),
    listCarMakes(supabase),
    listCarModels(supabase),
    listDistinctVariants(supabase),
  ]);

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;
  const action = updateItemAction.bind(null, item.id);

  // On a failed submit (`error` is set), the query params above carry
  // exactly what the user typed/selected — redisplay those, not the
  // item's last-saved values, so other field edits survive a duplicate-SKU
  // (or missing-fields) round trip. On first page load (`error` unset)
  // there are no query params at all, so every field falls back to the
  // item's stored value, same as before this fix.
  const fromError = Boolean(error);
  const skuValue = fromError ? sku ?? "" : item.sku;
  const nameValue = fromError ? name ?? "" : item.name;
  const categoryIdValue = fromError ? categoryId ?? "" : item.category_id ?? "";
  const unitValue = fromError ? unit ?? "" : item.unit;
  const lowStockThresholdValue = fromError
    ? lowStockThreshold ?? ""
    : item.low_stock_threshold ?? "";

  // On an error redirect, re-hydrate the chip list from the round-tripped
  // JSON — each parsed entry gets a fresh client `key` here (mirroring the
  // Add form), but keeps whatever `id` it already carried from the
  // round-trip, so existing tags are still recognized as existing.
  //
  // On a fresh load (no error) there's no round-tripped `fitments` param,
  // so instead fetch the item's actual fitments from the database and map
  // each one to a chip using the fitment's own `id` as BOTH `key` and
  // `id`. This is what lets `updateItem`'s diff-by-id logic in
  // `replaceFitmentsForItem` tell "this tag already existed, leave it
  // alone" apart from "this is a brand new tag the user just added" when
  // the form is saved — using a fresh random `key` here instead would
  // still render correctly, but would make every save delete and recreate
  // every tag, churning `created_at` and breaking the "first tag = oldest
  // created_at" ordering guarantee this feature depends on.
  let initialFitments: FitmentChip[];
  if (fromError) {
    initialFitments = fitmentsRaw
      ? parseFitmentsJson(fitmentsRaw).map((fitment) => ({
          ...fitment,
          key: crypto.randomUUID(),
        }))
      : [];
  } else {
    const existingFitments = await listFitmentsForItem(supabase, item.id);
    initialFitments = existingFitments.map((fitment) => ({
      key: fitment.id,
      id: fitment.id,
      makeId: fitment.makeId,
      model: fitment.model,
      variant: fitment.variant,
      yearFrom: fitment.yearFrom,
      yearTo: fitment.yearTo,
    }));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Edit item</h1>

      <form action={action} className="mt-6 flex max-w-md flex-col gap-4">
        {errorMessage && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Input
            id="sku"
            name="sku"
            required
            defaultValue={skuValue}
            placeholder="AB-001"
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={nameValue}
            placeholder="12V Battery"
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={categoryIdValue}
            className="h-11 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          {/*
            Not a <Label>: the fitment editor below is a group of several
            controls, not one labelable form control, so a <label> with no
            htmlFor and nothing wrapped would point at nothing. Same text,
            same type styling as the real labels around it.
          */}
          <p className="text-sm leading-none font-medium">Vehicle fitment</p>
          <FitmentTagEditor
            makes={makes}
            models={models}
            variantSuggestions={variants}
            initialFitments={initialFitments}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="unit">Unit</Label>
          <Input
            id="unit"
            name="unit"
            defaultValue={unitValue}
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lowStockThreshold">Low stock threshold</Label>
          <Input
            id="lowStockThreshold"
            name="lowStockThreshold"
            type="number"
            min="0"
            step="any"
            defaultValue={lowStockThresholdValue}
            placeholder="Optional"
            className="h-11"
          />
        </div>

        <Button type="submit" size="touch" className="mt-2">
          Save changes
        </Button>
      </form>

      <DeleteItemButton itemId={item.id} sku={item.sku} name={item.name} />
    </div>
  );
}
