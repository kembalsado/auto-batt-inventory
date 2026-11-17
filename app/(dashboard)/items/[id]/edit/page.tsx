import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { updateItem, listDistinctModelsAndVariants } from "@/lib/items";
import { listCategories } from "@/lib/categories";
import { listCarMakes } from "@/lib/car-makes";
import { isUniqueViolation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function updateItemAction(itemId: string, formData: FormData) {
  "use server";

  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  const unit = String(formData.get("unit") ?? "").trim() || "pcs";
  const lowStockThresholdRaw = String(
    formData.get("lowStockThreshold") ?? ""
  ).trim();
  const lowStockThreshold = lowStockThresholdRaw
    ? Number(lowStockThresholdRaw)
    : null;
  const makeId = String(formData.get("makeId") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "").trim() || null;
  const variant = String(formData.get("variant") ?? "").trim() || null;
  const yearRaw = String(formData.get("year") ?? "").trim();
  const year = yearRaw ? Number(yearRaw) : null;

  if (!sku || !name) {
    redirect(`/items/${itemId}/edit?error=missing-fields`);
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
      makeId,
      model,
      variant,
      year,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    duplicateSku = true;
  }

  if (duplicateSku) {
    redirect(
      `/items/${itemId}/edit?error=duplicate-sku&sku=${encodeURIComponent(sku)}`
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
  searchParams: Promise<{ error?: string; sku?: string }>;
}) {
  const { id } = await params;
  const { error, sku } = await searchParams;
  const supabase = await createServerClient();

  const { data: item } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (!item) {
    notFound();
  }

  const [categories, makes, { models, variants }] = await Promise.all([
    listCategories(supabase),
    listCarMakes(supabase),
    listDistinctModelsAndVariants(supabase),
  ]);

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;
  const action = updateItemAction.bind(null, item.id);

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
            defaultValue={sku ?? item.sku}
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
            defaultValue={item.name}
            placeholder="12V Battery"
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={item.category_id ?? ""}
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
          <Label htmlFor="makeId">Make</Label>
          <select
            id="makeId"
            name="makeId"
            defaultValue={item.make_id ?? ""}
            className="h-11 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">None</option>
            {makes.map((make) => (
              <option key={make.id} value={make.id}>
                {make.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            name="model"
            list="model-suggestions"
            defaultValue={item.model ?? ""}
            placeholder="Optional"
            className="h-11"
          />
          <datalist id="model-suggestions">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="variant">Variant</Label>
          <Input
            id="variant"
            name="variant"
            list="variant-suggestions"
            defaultValue={item.variant ?? ""}
            placeholder="Optional"
            className="h-11"
          />
          <datalist id="variant-suggestions">
            {variants.map((variant) => (
              <option key={variant} value={variant} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            name="year"
            type="number"
            min={1980}
            max={new Date().getFullYear() + 1}
            defaultValue={item.year ?? ""}
            placeholder="Optional"
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="unit">Unit</Label>
          <Input
            id="unit"
            name="unit"
            defaultValue={item.unit}
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
            defaultValue={item.low_stock_threshold ?? ""}
            placeholder="Optional"
            className="h-11"
          />
        </div>

        <Button type="submit" size="touch" className="mt-2">
          Save changes
        </Button>
      </form>
    </div>
  );
}
