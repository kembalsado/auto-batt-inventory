import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createItem } from "@/lib/items";
import { listCategories } from "@/lib/categories";
import { isUniqueViolation } from "@/lib/errors";

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
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          SKU
          <input
            name="sku"
            required
            defaultValue={sku ?? ""}
            placeholder="AB-001"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Name
          <input
            name="name"
            required
            placeholder="12V Battery"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Category
          <select
            name="categoryId"
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Unit
          <input
            name="unit"
            defaultValue="pcs"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Low stock threshold
          <input
            name="lowStockThreshold"
            type="number"
            min="0"
            step="any"
            placeholder="Optional"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <button
          type="submit"
          className="mt-2 rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
        >
          Add item
        </button>
      </form>
    </div>
  );
}
