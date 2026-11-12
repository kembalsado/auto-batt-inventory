import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { StockInForm } from "./stock-in-form";
import { StockOutForm } from "./stock-out-form";

/**
 * Minimal item detail page: just enough to host the stock-in/stock-out
 * forms (Tasks 8-9). The full stock summary — qty on hand, low-stock
 * badge, batch list, movement history — is Task 12's job.
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
    </div>
  );
}
