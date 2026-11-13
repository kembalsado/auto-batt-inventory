import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { listItems } from "@/lib/items";
import { listCategories } from "@/lib/categories";
import { getItemStockSummary } from "@/lib/stock";
import { getSettings } from "@/lib/settings";

export default async function ItemsPage() {
  const supabase = await createServerClient();
  const [items, categories, settings] = await Promise.all([
    listItems(supabase),
    listCategories(supabase),
    getSettings(supabase),
  ]);

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  // Qty on hand / low-stock status per item, via the single shared
  // getItemStockSummary (lib/stock.ts) — same function the item detail
  // page and Task 13's stock list use, so this list never disagrees with
  // either about what "low stock" means. `settings` is fetched once above
  // and passed into every call so this loop doesn't re-fetch the single
  // global app_settings row once per item.
  const summaries = await Promise.all(
    items.map((item) => getItemStockSummary(supabase, item.id, settings))
  );
  const summaryByItemId = new Map(
    items.map((item, index) => [item.id, summaries[index]])
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand-ink">Items</h1>
        <Link
          href="/items/new"
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
        >
          Add item
        </Link>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Category</th>
            <th className="py-2 font-medium">Unit</th>
            <th className="py-2 font-medium">Qty on hand</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => {
            const summary = summaryByItemId.get(item.id);
            return (
              <tr key={item.id} className="text-brand-ink">
                <td className="py-2">{item.sku}</td>
                <td className="py-2">
                  <Link href={`/items/${item.id}`} className="hover:underline">
                    {item.name}
                  </Link>
                </td>
                <td className="py-2">
                  {item.category_id
                    ? categoryNameById.get(item.category_id) ?? "—"
                    : "—"}
                </td>
                <td className="py-2">{item.unit}</td>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    {summary?.qtyOnHand ?? "—"}
                    {summary?.isLowStock && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Low
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="py-2 text-sm text-muted-foreground"
              >
                No items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
