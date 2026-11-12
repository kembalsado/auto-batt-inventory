import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createItem } from "@/lib/items";
import { listCategories } from "@/lib/categories";

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

  if (!sku || !name) return;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await createItem(supabase, user.id, {
    sku,
    name,
    categoryId,
    unit,
    lowStockThreshold,
  });

  redirect("/items");
}

export default async function NewItemPage() {
  const supabase = await createServerClient();
  const categories = await listCategories(supabase);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Add item</h1>

      <form action={addItem} className="mt-6 flex max-w-md flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          SKU
          <input
            name="sku"
            required
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
