import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { StockInForm } from "./stock-in-form";

/**
 * Minimal item detail page: just enough to host the stock-in form (Task 8).
 * The full stock summary — qty on hand, low-stock badge, batch list,
 * movement history — is Task 12's job.
 */
export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();

  const { data: item } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (!item) {
    notFound();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">{item.name}</h1>
      <p className="text-sm text-muted-foreground">{item.sku}</p>

      <StockInForm itemId={item.id} />
    </div>
  );
}
