import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createCategory, listCategories } from "@/lib/categories";
import { isUniqueViolation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function addCategory(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/categories?error=missing-name");
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Same reasoning as app/(dashboard)/items/new/page.tsx: re-entering an
  // existing category name is an everyday typo, and letting Postgres's
  // unique-constraint violation escape the Server Action crashed to
  // Next.js's generic error page. Flag then redirect, so `redirect()`'s
  // own NEXT_REDIRECT throw isn't caught by this handler.
  let duplicateName = false;
  try {
    await createCategory(supabase, user.id, name);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    duplicateName = true;
  }

  if (duplicateName) {
    redirect(`/categories?error=duplicate-name&name=${encodeURIComponent(name)}`);
  }

  revalidatePath("/categories");
  redirect("/categories");
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-name": "Enter a category name.",
  "duplicate-name": "That category already exists.",
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; name?: string }>;
}) {
  const { error, name } = await searchParams;
  const supabase = await createServerClient();
  const categories = await listCategories(supabase);

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Categories</h1>

      <form action={addCategory} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Input
          name="name"
          required
          defaultValue={name ?? ""}
          placeholder="Category name"
          className="h-11 w-full sm:w-64"
        />
        <Button type="submit" size="touch">
          Add category
        </Button>
      </form>

      {errorMessage && (
        <p
          role="alert"
          className="mt-3 max-w-md rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {errorMessage}
        </p>
      )}

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
