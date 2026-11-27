import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createItem } from "@/lib/items";
import { parseFitmentsJson, listDistinctVariants } from "@/lib/item-fitments";
import { listCategories } from "@/lib/categories";
import { listCarMakes } from "@/lib/car-makes";
import { listCarModels } from "@/lib/car-models";
import { isUniqueViolation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FitmentTagEditor, type FitmentChip } from "@/app/(dashboard)/items/fitment-tag-editor";

// Every field this form submits, as its raw (trimmed, still-a-string) form
// value — round-tripped onto an error redirect via buildErrorRedirectParams
// so a failed submission (missing fields, duplicate SKU) re-displays
// exactly what the user typed/selected instead of discarding it. Mirrors
// app/(dashboard)/items/[id]/edit/page.tsx's identical fix (Finding 4 of
// the branch-wide review) — applied here too for consistency, even though
// the Add form has no "stale saved data" to silently overwrite the way
// Edit did; losing unsaved input on every field but SKU was still a real
// (if lesser) annoyance. `fitments` is the tag editor's hidden-field JSON
// string, round-tripped the same way as every other field — so a user who
// adds a few vehicle tags and then hits a duplicate-SKU error gets them
// back instead of having to re-enter them.
interface RawItemFormFields {
  sku: string;
  name: string;
  categoryId: string;
  unit: string;
  lowStockThreshold: string;
  fitments: string;
}

function buildErrorRedirectParams(
  error: string,
  fields: RawItemFormFields
): string {
  return new URLSearchParams({ error, ...fields }).toString();
}

async function addItem(formData: FormData) {
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
    redirect(`/items/new?${buildErrorRedirectParams("missing-fields", rawFields)}`);
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // A duplicate SKU is an everyday typo, not an exceptional condition.
  // Unhandled, Postgres's unique-constraint violation propagated straight
  // out of this Server Action and crashed to Next.js's generic error
  // page, losing everything else the user had typed. Caught here and fed
  // back inline instead.
  //
  // The flag-then-redirect shape is deliberate: `redirect()` works by
  // throwing a NEXT_REDIRECT control-flow error, so calling it from
  // inside the `catch` (or inside the `try`) would have it swallowed by
  // this very handler.
  let duplicateSku = false;
  try {
    await createItem(supabase, user.id, {
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
    redirect(`/items/new?${buildErrorRedirectParams("duplicate-sku", rawFields)}`);
  }

  redirect("/items");
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-fields": "SKU and name are both required.",
  "duplicate-sku": "That SKU already exists — pick a different one.",
};

export default async function NewItemPage({
  searchParams,
}: {
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
  const [categories, makes, models, variants] = await Promise.all([
    listCategories(supabase),
    listCarMakes(supabase),
    listCarModels(supabase),
    listDistinctVariants(supabase),
  ]);

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  // On a fresh load there's no round-tripped `fitments` param, so the
  // editor starts empty. On an error redirect, re-hydrate the chip list
  // from the round-tripped JSON — each parsed entry gets a fresh client
  // `key` here since it never had one (a round-tripped entry carries an
  // `id` only if it already existed in the database, which can't happen on
  // this Add form, but the mapping stays shape-compatible with
  // `FitmentInput` either way).
  const initialFitments: FitmentChip[] = fitmentsRaw
    ? parseFitmentsJson(fitmentsRaw).map((fitment) => ({
        ...fitment,
        key: crypto.randomUUID(),
      }))
    : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Add item</h1>

      <form action={addItem} className="mt-6 flex max-w-md flex-col gap-4">
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
            defaultValue={sku ?? ""}
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
            defaultValue={name ?? ""}
            placeholder="12V Battery"
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={categoryId ?? ""}
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
          <Input id="unit" name="unit" defaultValue={unit ?? "pcs"} className="h-11" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lowStockThreshold">Low stock threshold</Label>
          <Input
            id="lowStockThreshold"
            name="lowStockThreshold"
            type="number"
            min="0"
            step="any"
            defaultValue={lowStockThreshold ?? ""}
            placeholder="Optional"
            className="h-11"
          />
        </div>

        <Button type="submit" size="touch" className="mt-2">
          Add item
        </Button>
      </form>
    </div>
  );
}
