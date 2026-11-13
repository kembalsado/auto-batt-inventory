import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/permissions";
import { buildStockListRows } from "@/lib/stock-list";

/**
 * Items list: one row per item (SKU, name, category, unit, qty on hand,
 * low-stock badge).
 *
 * Built by the shared `buildStockListRows` (lib/stock-list.ts) — a fixed
 * three bulk queries for the whole page, no matter how many items exist.
 * This page previously called `getItemStockSummary` once per item, which
 * is 3 queries per item and pulls each item's complete movement history
 * just to display a single quantity — the N+1 pattern Tasks 12 and 13
 * already removed from the item detail page and the Stock List. This
 * page predated both fixes.
 *
 * `includeInactive: true`, unlike the Stock List: this is the catalogue
 * management view, so an item that has been deactivated must still be
 * visible here (it's marked as such) rather than silently vanishing.
 *
 * No cost is shown on this screen, but the viewer's role is still
 * resolved and passed through, so `buildStockListRows` applies the same
 * `canSeeCost` gating here as everywhere else — an assistant's rows
 * never carry cost fields at all, rather than relying on this template
 * not to render them.
 */
export default async function ItemsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase.from("profiles").select("role").eq("id", user.id).single()
      ).data
    : null;
  const role = getRole(profile);

  const rows = await buildStockListRows(supabase, role, {
    includeInactive: true,
  });

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
          {rows.map((row) => (
            <tr key={row.id} className="text-brand-ink">
              <td className="py-2">{row.sku}</td>
              <td className="py-2">
                <Link href={`/items/${row.id}`} className="hover:underline">
                  {row.name}
                </Link>
                {!row.isActive && (
                  <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                    Inactive
                  </span>
                )}
              </td>
              <td className="py-2">{row.category}</td>
              <td className="py-2">{row.unit}</td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  {row.qtyOnHand}
                  {row.isLowStock && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Low
                    </span>
                  )}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-sm text-muted-foreground">
                No items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
