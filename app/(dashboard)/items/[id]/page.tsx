import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import {
  voidMovement,
  AlreadyVoidedError,
  BatchAlreadySoldError,
} from "@/lib/movements";
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

/**
 * Item detail page: hosts the stock-in/stock-out forms (Tasks 8-9) and a
 * movement history list with a per-row "Void" action (Task 10). The full
 * stock summary — qty on hand, low-stock badge, batch list — is Task 12's
 * job; the movement list here exists only to give Void something to act
 * on, not to anticipate Task 12's richer view.
 */
export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ outError?: string; available?: string }>;
}) {
  const { id } = await params;
  const { outError, available } = await searchParams;
  const supabase = await createServerClient();

  const { data: item } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (!item) {
    notFound();
  }

  const { data: movements } = await supabase
    .from("stock_movements")
    .select("id, type, quantity, movement_date, note, voided_at")
    .eq("item_id", item.id)
    .order("movement_date", { ascending: false })
    .order("created_at", { ascending: false });

  const insufficientStockAvailable =
    outError === "insufficient" && available != null ? Number(available) : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">{item.name}</h1>
      <p className="text-sm text-muted-foreground">{item.sku}</p>

      <StockInForm itemId={item.id} />
      <StockOutForm
        itemId={item.id}
        insufficientStockAvailable={insufficientStockAvailable}
      />

      <MovementsList
        movements={(movements ?? []).map((m) => ({
          id: m.id,
          type: m.type as "IN" | "OUT",
          quantity: Number(m.quantity),
          movementDate: m.movement_date,
          note: m.note,
          voidedAt: m.voided_at,
        }))}
        voidAction={voidMovementAction}
      />
    </div>
  );
}
