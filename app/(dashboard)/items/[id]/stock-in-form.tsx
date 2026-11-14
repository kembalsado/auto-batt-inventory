import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { recordStockIn } from "@/lib/movements";
import { manilaToday } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function addStockIn(formData: FormData) {
  "use server";

  const itemId = String(formData.get("itemId") ?? "").trim();
  const qty = Number(formData.get("qty"));
  const unitCost = Number(formData.get("unitCost"));
  const batchDate = String(formData.get("batchDate") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  // Invalid input used to `return` silently: the user pressed the button
  // and absolutely nothing happened — no entry, no message, no clue
  // which field was wrong. Redirect back with a reason instead, so the
  // form can say so. (Server-side rather than only tightening the input
  // attributes, because the action is reachable without the form.)
  if (!itemId) {
    redirect("/items");
  }
  if (!batchDate || !Number.isFinite(qty) || qty <= 0) {
    redirect(`/items/${itemId}?inError=invalid-qty`);
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    redirect(`/items/${itemId}?inError=invalid-cost`);
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  await recordStockIn(supabase, user.id, {
    itemId,
    qty,
    unitCost,
    batchDate,
    note,
  });

  revalidatePath(`/items/${itemId}`);
}

/**
 * Minimal stock-IN form embedded on the item detail page. Batch/movement
 * history display is Task 12's job — this only records a new purchase
 * batch via `recordStockIn` (Task 8).
 *
 * `errorMessage` is resolved by the item detail page from the `inError`
 * query param that `addStockIn` redirects back with on invalid input.
 */
export function StockInForm({
  itemId,
  errorMessage,
}: {
  itemId: string;
  errorMessage?: string | null;
}) {
  // Asia/Manila, not the server's UTC date — see `manilaToday`
  // (lib/date.ts). A UTC default here dated anything entered before 8am
  // Manila to the previous day, which the daily email never reports.
  const today = manilaToday();

  return (
    <form action={addStockIn} className="mt-6 flex max-w-md flex-col gap-4">
      <input type="hidden" name="itemId" value={itemId} />

      <h2 className="text-lg font-medium text-brand-ink">Record stock IN</h2>

      {errorMessage && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="in-qty">Quantity</Label>
        {/* `min` is a positive value, not 0: a quantity of zero is not a
            stock movement, and the server action rejects it too. */}
        <Input
          id="in-qty"
          name="qty"
          type="number"
          min="0.01"
          step="any"
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="in-unitCost">Unit cost</Label>
        <Input
          id="in-unitCost"
          name="unitCost"
          type="number"
          min="0"
          step="any"
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="in-batchDate">Date</Label>
        <Input
          id="in-batchDate"
          name="batchDate"
          type="date"
          defaultValue={today}
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="in-note">Note</Label>
        <Input id="in-note" name="note" placeholder="Optional" className="h-11" />
      </div>

      <Button type="submit" size="touch" className="mt-2 w-full">
        Record stock IN
      </Button>
    </form>
  );
}
