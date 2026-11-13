import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { recordStockOut, InsufficientStockError } from "@/lib/movements";
import { manilaToday } from "@/lib/date";

async function addStockOut(formData: FormData) {
  "use server";

  const itemId = String(formData.get("itemId") ?? "").trim();
  const qty = Number(formData.get("qty"));
  const movementDate = String(formData.get("movementDate") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  // Invalid input used to `return` silently — the user pressed the
  // button and nothing at all happened. Redirect back with a reason, the
  // same way the "insufficient stock" rejection below already does, so
  // the form can show it.
  if (!itemId) {
    redirect("/items");
  }
  if (!movementDate || !Number.isFinite(qty) || qty <= 0) {
    redirect(`/items/${itemId}?outError=invalid-qty`);
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  try {
    await recordStockOut(supabase, user.id, {
      itemId,
      qty,
      movementDate,
      note,
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      const { data: batches } = await supabase
        .from("batches")
        .select("qty_remaining")
        .eq("item_id", itemId)
        .gt("qty_remaining", 0);
      const available = (batches ?? []).reduce(
        (sum, b) => sum + Number(b.qty_remaining),
        0
      );
      redirect(`/items/${itemId}?outError=insufficient&available=${available}`);
    }
    throw error;
  }

  revalidatePath(`/items/${itemId}`);
}

/**
 * Minimal stock-OUT form embedded on the item detail page. Batch/movement
 * history display is Task 12's job — this only records a FIFO-allocated
 * sale via `recordStockOut` (Task 9). On "insufficient stock" it redirects
 * back with the currently available quantity so the user understands why
 * the request was rejected.
 */
export function StockOutForm({
  itemId,
  insufficientStockAvailable,
  errorMessage,
}: {
  itemId: string;
  /** Available quantity to show after an "insufficient stock" rejection. */
  insufficientStockAvailable?: number | null;
  /**
   * Message for any other rejection — currently invalid input, resolved
   * by the item detail page from the `outError` query param this form's
   * action redirects back with.
   */
  errorMessage?: string | null;
}) {
  // Asia/Manila, not the server's UTC date — see `manilaToday`
  // (lib/date.ts). A UTC default here dated anything entered before 8am
  // Manila to the previous day, which the daily email never reports.
  const today = manilaToday();

  return (
    <form action={addStockOut} className="mt-6 flex max-w-md flex-col gap-4">
      <input type="hidden" name="itemId" value={itemId} />

      <h2 className="text-lg font-medium text-brand-ink">Record stock OUT</h2>

      {insufficientStockAvailable != null && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Not enough stock — only {insufficientStockAvailable} available.
        </p>
      )}

      {errorMessage && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm text-brand-ink">
        Quantity
        {/* `min` is a positive value, not 0 — see the matching note in
            stock-in-form.tsx. */}
        <input
          name="qty"
          type="number"
          min="0.01"
          step="any"
          required
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-brand-ink">
        Date
        <input
          name="movementDate"
          type="date"
          defaultValue={today}
          required
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-brand-ink">
        Note
        <input
          name="note"
          placeholder="Optional"
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <button
        type="submit"
        className="mt-2 rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
      >
        Record stock OUT
      </button>
    </form>
  );
}
