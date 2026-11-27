import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createCarMake, listCarMakes } from "@/lib/car-makes";
import { listCarModels } from "@/lib/car-models";
import { isUniqueViolation } from "@/lib/errors";
import { getRole } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/submit-button";
import { LookupListTable } from "@/components/lookup-list-table";

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
  const [makes, models] = await Promise.all([
    listCarMakes(supabase),
    listCarModels(supabase),
  ]);

  const modelCountByMakeId = new Map<string, number>();
  for (const model of models) {
    modelCountByMakeId.set(
      model.makeId,
      (modelCountByMakeId.get(model.makeId) ?? 0) + 1
    );
  }

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
        <SubmitButton size="touch" pendingLabel="Adding…">
          Add make
        </SubmitButton>
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
        items={makes.map((make) => {
          const count = modelCountByMakeId.get(make.id) ?? 0;
          return {
            id: make.id,
            name: make.name,
            deleteWarning:
              count > 0
                ? `This will also delete its ${count} model(s).`
                : undefined,
          };
        })}
        apiBasePath="/api/makes"
        noun="make"
        isOwner={isOwner}
        emptyLabel="No makes yet."
      />
    </div>
  );
}
