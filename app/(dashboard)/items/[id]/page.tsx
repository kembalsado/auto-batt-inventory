import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import {
  voidMovement,
  AlreadyVoidedError,
  BatchAlreadySoldError,
} from "@/lib/movements";
import { getItemStockSummary } from "@/lib/stock";
import { StockInForm } from "./stock-in-form";
import { StockOutForm } from "./stock-out-form";
import { MovementsList, type VoidActionResult } from "./movements-list";

async function voidMovementAction(movementId: string): Promise<VoidActionResult> {
  "use server";

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: movement } = await supabase
    .from("stock_movements")
    .select("item_id")
    .eq("id", movementId)
    .single();

  try {
    await voidMovement(supabase, user.id, movementId);
  } catch (error) {
    if (error instanceof AlreadyVoidedError) {
      return { error: "This movement has already been voided." };
    }
    if (error instanceof BatchAlreadySoldError) {
      return {
        error: "This item has already been sold from this batch — can't void the purchase.",
      };
    }
    throw error;
  }

  if (movement?.item_id) {
    revalidatePath(`/items/${movement.item_id}`);
  }
}

// Messages for the `inError`/`outError` query params the two stock forms'
// Server Actions redirect back with when input is rejected before it
// reaches the database. Before these existed, an invalid entry (a
// quantity of zero, say) made the action `return` silently — the user
// pressed the button and nothing happened at all.
const STOCK_ERROR_MESSAGES: Record<string, string> = {
  "invalid-qty": "Enter a quantity greater than zero, and a valid date.",
  "invalid-cost": "Enter a unit cost of zero or more.",
};

/**
 * Item detail page: hosts the stock-in/stock-out forms (Tasks 8-9), the
 * full stock summary (qty on hand, low-stock badge, batch list) and a
 * movement history list with a per-row "Void" action (Task 10). The
 * summary itself — qtyOnHand, isLowStock, batches, movements — is computed
 * once by `getItemStockSummary` (lib/stock.ts), not re-derived here, so
 * this page and Task 13's stock list never disagree on what "low stock"
 * means.
 *
 * Rejections from the two stock forms come back as `inError`/`outError`
 * query params and are turned into the messages below — see
 * STOCK_ERROR_MESSAGES.
 */
export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    inError?: string;
    outError?: string;
    available?: string;
  }>;
}) {
  const { id } = await params;
  const { inError, outError, available } = await searchParams;
  const supabase = await createServerClient();

  const { data: item } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (!item) {
    notFound();
  }

  const summary = await getItemStockSummary(supabase, item.id);

  const insufficientStockAvailable =
    outError === "insufficient" && available != null ? Number(available) : null;
  const stockInError = inError ? STOCK_ERROR_MESSAGES[inError] : undefined;
  const stockOutError = outError ? STOCK_ERROR_MESSAGES[outError] : undefined;

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-brand-ink">{item.name}</h1>
        {summary.isLowStock && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
            Low stock
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{item.sku}</p>
      <p className="mt-2 text-sm text-brand-ink">
        Qty on hand:{" "}
        <span className="font-medium">
          {summary.qtyOnHand} {item.unit}
        </span>
      </p>

      <StockInForm itemId={item.id} errorMessage={stockInError} />
      <StockOutForm
        itemId={item.id}
        insufficientStockAvailable={insufficientStockAvailable}
        errorMessage={stockOutError}
      />

      <div className="mt-6">
        <h2 className="text-lg font-medium text-brand-ink">Batches</h2>
        {summary.batches.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No batches yet.</p>
        ) : (
          <>
            <table className="mt-2 hidden w-full max-w-2xl text-sm md:table">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Received</th>
                  <th className="py-1 pr-3">Remaining</th>
                  {summary.batches.some((b) => b.unit_cost !== undefined) && (
                    <th className="py-1 pr-3">Unit cost</th>
                  )}
                  <th className="py-1 pr-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {summary.batches.map((batch) => (
                  <tr key={batch.id} className="text-brand-ink">
                    <td className="py-1 pr-3">{batch.batch_date}</td>
                    <td className="py-1 pr-3">{batch.qty_received}</td>
                    <td className="py-1 pr-3">{batch.qty_remaining}</td>
                    {summary.batches.some((b) => b.unit_cost !== undefined) && (
                      <td className="py-1 pr-3">
                        {batch.unit_cost !== undefined ? batch.unit_cost : ""}
                      </td>
                    )}
                    <td className="py-1 pr-3">{batch.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-2 flex flex-col gap-2 md:hidden">
              {summary.batches.map((batch) => (
                <div
                  key={batch.id}
                  className="rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-brand-ink">
                      {batch.batch_date}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {batch.source}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground">
                    <span>
                      {batch.qty_remaining} / {batch.qty_received} remaining
                    </span>
                    {batch.unit_cost !== undefined && (
                      <span>{batch.unit_cost}/unit</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <MovementsList
        movements={summary.movements.map((m) => ({
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          movementDate: m.movementDate,
          note: m.note,
          voidedAt: m.voidedAt,
        }))}
        voidAction={voidMovementAction}
      />
    </div>
  );
}
