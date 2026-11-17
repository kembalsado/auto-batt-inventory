import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createCarMake, listCarMakes } from "@/lib/car-makes";
import { isUniqueViolation } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function addMake(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/makes?error=missing-name");
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Same reasoning as app/(dashboard)/items/new/page.tsx: re-entering an
  // existing make name is an everyday typo, and letting Postgres's
  // unique-constraint violation escape the Server Action crashed to
  // Next.js's generic error page. Flag then redirect, so `redirect()`'s
  // own NEXT_REDIRECT throw isn't caught by this handler.
  let duplicateName = false;
  try {
    await createCarMake(supabase, user.id, name);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    duplicateName = true;
  }

  if (duplicateName) {
    redirect(`/makes?error=duplicate-name&name=${encodeURIComponent(name)}`);
  }

  revalidatePath("/makes");
  redirect("/makes");
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-name": "Enter a make name.",
  "duplicate-name": "That make already exists.",
};

export default async function MakesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; name?: string }>;
}) {
  const { error, name } = await searchParams;
  const supabase = await createServerClient();
  const makes = await listCarMakes(supabase);

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Makes</h1>

      <form action={addMake} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Input
          name="name"
          required
          defaultValue={name ?? ""}
          placeholder="Make name"
          className="h-11 w-full sm:w-64"
        />
        <Button type="submit" size="touch">
          Add make
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
        {makes.map((make) => (
          <li key={make.id} className="py-2 text-sm text-brand-ink">
            {make.name}
          </li>
        ))}
        {makes.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">
            No makes yet.
          </li>
        )}
      </ul>
    </div>
  );
}
