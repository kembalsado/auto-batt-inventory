import { createServerClient } from "@/lib/supabase/server";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { buildStockListRows } from "@/lib/stock-list";
import { PrintButton } from "./print-button";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Stock list: one row per active item (sku, name, category, qty on hand,
 * unit, and — only when `canSeeCost` allows it — unit cost / inventory
 * value), built by the single shared `buildStockListRows` (lib/stock-
 * list.ts) so this page and both export routes (app/api/stock-list/pdf,
 * app/api/stock-list/excel) never disagree about a row's shape or which
 * viewer gets to see cost.
 *
 * Includes a "Print" button (print-button.tsx — a Client Component only
 * because `window.print()` needs one) and print-only styling via
 * Tailwind's `print:` variant: the dashboard sidebar
 * (components/sidebar.tsx, `print:hidden`) and this page's own action
 * buttons disappear when printing, replaced by a text-based Auto Batt
 * header that's otherwise hidden on screen (`hidden print:flex`).
 */
export default async function StockListPage() {
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

  const [rows, settings] = await Promise.all([
    buildStockListRows(supabase, role),
    getSettings(supabase),
  ]);
  const showCost = canSeeCost(role, settings);
  const columnCount = showCost ? 7 : 5;

  return (
    <div>
      {/* Print-only header: invisible on screen, shown in place of the
          sidebar/action-bar when the page is printed. */}
      <div className="hidden items-center gap-3 border-b border-border pb-4 print:mb-6 print:flex">
        <span className="text-xl font-bold tracking-tight text-brand-ink">
          Auto<span className="text-brand-green">Batt</span>
        </span>
        <span className="text-sm text-muted-foreground">Stock List</span>
      </div>

      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold text-brand-ink">Stock List</h1>
        <div className="flex gap-2">
          <PrintButton />
          <a
            href="/api/stock-list/pdf"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-accent"
          >
            Export PDF
          </a>
          <a
            href="/api/stock-list/excel"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-accent"
          >
            Export Excel
          </a>
        </div>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Category</th>
            <th className="py-2 font-medium">Qty on hand</th>
            <th className="py-2 font-medium">Unit</th>
            {showCost && <th className="py-2 font-medium">Unit cost</th>}
            {showCost && (
              <th className="py-2 font-medium">Inventory value</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.sku} className="text-brand-ink">
              <td className="py-2">{row.sku}</td>
              <td className="py-2">{row.name}</td>
              <td className="py-2">{row.category}</td>
              <td className="py-2">{row.qtyOnHand}</td>
              <td className="py-2">{row.unit}</td>
              {showCost && (
                <td className="py-2">
                  {row.unitCost !== undefined
                    ? formatCurrency(row.unitCost)
                    : ""}
                </td>
              )}
              {showCost && (
                <td className="py-2">
                  {row.inventoryValue !== undefined
                    ? formatCurrency(row.inventoryValue)
                    : ""}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columnCount}
                className="py-2 text-sm text-muted-foreground"
              >
                No active items.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
