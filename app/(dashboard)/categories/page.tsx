import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createCategory, listCategories } from "@/lib/categories";

async function addCategory(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await createCategory(supabase, user.id, name);
  revalidatePath("/categories");
}

export default async function CategoriesPage() {
  const supabase = await createServerClient();
  const categories = await listCategories(supabase);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Categories</h1>

      <form action={addCategory} className="mt-6 flex gap-2">
        <input
          name="name"
          required
          placeholder="Category name"
          className="w-64 rounded-md border border-border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
        >
          Add category
        </button>
      </form>

      <ul className="mt-6 divide-y divide-border">
        {categories.map((category) => (
          <li key={category.id} className="py-2 text-sm text-brand-ink">
            {category.name}
          </li>
        ))}
        {categories.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">
            No categories yet.
          </li>
        )}
      </ul>
    </div>
  );
}
