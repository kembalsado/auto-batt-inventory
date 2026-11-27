import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createCarModel, listCarModels } from "@/lib/car-models";
import { listCarMakes } from "@/lib/car-makes";
import { isUniqueViolation } from "@/lib/errors";
import { getRole } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LookupListTable } from "@/components/lookup-list-table";

async function addModel(formData: FormData) {
  "use server";

  const makeId = String(formData.get("makeId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!makeId) {
    redirect(`/models?error=missing-make&name=${encodeURIComponent(name)}`);
  }
  if (!name) {
    redirect(`/models?error=missing-name&makeId=${encodeURIComponent(makeId)}`);
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Same reasoning as app/(dashboard)/makes/page.tsx's addMake: re-entering
  // an existing model name under the same make is an everyday typo, and
  // letting Postgres's unique-constraint violation escape the Server
  // Action crashed to Next.js's generic error page. Flag then redirect, so
  // `redirect()`'s own NEXT_REDIRECT throw isn't caught by this handler.
  let duplicateName = false;
  try {
    await createCarModel(supabase, user.id, makeId, name);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    duplicateName = true;
  }

  if (duplicateName) {
    redirect(
      `/models?error=duplicate-name&name=${encodeURIComponent(name)}&makeId=${encodeURIComponent(makeId)}`
    );
  }

  revalidatePath("/models");
  redirect("/models");
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-make": "Choose a make.",
  "missing-name": "Enter a model name.",
  "duplicate-name": "That model already exists for this make.",
};

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; name?: string; makeId?: string }>;
}) {
  const { error, name, makeId } = await searchParams;
  const supabase = await createServerClient();
  const [makes, models] = await Promise.all([
    listCarMakes(supabase),
    listCarModels(supabase),
  ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single();
  const isOwner = getRole(profile) === "owner";

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  const makeNameById = new Map(makes.map((make) => [make.id, make.name]));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Models</h1>

      <form action={addModel} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <select
          name="makeId"
          required
          defaultValue={makeId ?? ""}
          className="h-11 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-48"
        >
          <option value="">Select a make</option>
          {makes.map((make) => (
            <option key={make.id} value={make.id}>
              {make.name}
            </option>
          ))}
        </select>
        <Input
          name="name"
          required
          defaultValue={name ?? ""}
          placeholder="Model name"
          className="h-11 w-full sm:w-64"
        />
        <Button type="submit" size="touch">
          Add model
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

      <LookupListTable
        items={models.map((m) => ({
          id: m.id,
          name: m.name,
          secondary: makeNameById.get(m.makeId),
        }))}
        apiBasePath="/api/models"
        noun="model"
        isOwner={isOwner}
        emptyLabel="No models yet."
      />
    </div>
  );
}
