import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { recordStockIn } from "@/lib/movements";

async function addStockIn(formData: FormData) {
  "use server";

  const itemId = String(formData.get("itemId") ?? "").trim();
  const qty = Number(formData.get("qty"));
  const unitCost = Number(formData.get("unitCost"));
  const batchDate = String(formData.get("batchDate") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!itemId || !batchDate || !Number.isFinite(qty) || qty <= 0) return;
  if (!Number.isFinite(unitCost) || unitCost < 0) return;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

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
 */
export function StockInForm({ itemId }: { itemId: string }) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={addStockIn} className="mt-6 flex max-w-md flex-col gap-4">
      <input type="hidden" name="itemId" value={itemId} />

      <h2 className="text-lg font-medium text-brand-ink">Record stock IN</h2>

      <label className="flex flex-col gap-1 text-sm text-brand-ink">
        Quantity
        <input
          name="qty"
          type="number"
          min="0"
          step="any"
          required
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-brand-ink">
        Unit cost
        <input
          name="unitCost"
          type="number"
          min="0"
          step="any"
          required
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-brand-ink">
        Date
        <input
          name="batchDate"
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
        Record stock IN
      </button>
    </form>
  );
}
