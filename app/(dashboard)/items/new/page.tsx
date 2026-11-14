import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createItem } from "@/lib/items";
import { listCategories } from "@/lib/categories";
import { isUniqueViolation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function addItem(formData: FormData) {
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

  if (!sku || !name) {
    redirect("/items/new?error=missing-fields");
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
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    duplicateSku = true;
  }

  if (duplicateSku) {
    redirect(`/items/new?error=duplicate-sku&sku=${encodeURIComponent(sku)}`);
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
  searchParams: Promise<{ error?: string; sku?: string }>;
}) {
  const { error, sku } = await searchParams;
  const supabase = await createServerClient();
  const categories = await listCategories(supabase);

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

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
          <Input id="name" name="name" required placeholder="12V Battery" className="h-11" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
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
          <Label htmlFor="unit">Unit</Label>
          <Input id="unit" name="unit" defaultValue="pcs" className="h-11" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lowStockThreshold">Low stock threshold</Label>
          <Input
            id="lowStockThreshold"
            name="lowStockThreshold"
            type="number"
            min="0"
            step="any"
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
