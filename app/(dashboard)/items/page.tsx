import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { listItems } from "@/lib/items";
import { listCategories } from "@/lib/categories";

export default async function ItemsPage() {
  const supabase = await createServerClient();
  const [items, categories] = await Promise.all([
    listItems(supabase),
    listCategories(supabase),
  ]);

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

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
          {items.map((item) => (
            <tr key={item.id} className="text-brand-ink">
              <td className="py-2">{item.sku}</td>
              <td className="py-2">{item.name}</td>
              <td className="py-2">
                {item.category_id
                  ? categoryNameById.get(item.category_id) ?? "—"
                  : "—"}
              </td>
              <td className="py-2">{item.unit}</td>
              {/* Qty on hand is computed from batches/stock_movements in Task 12. */}
              <td className="py-2 text-muted-foreground">—</td>
            </tr>
          ))}
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
