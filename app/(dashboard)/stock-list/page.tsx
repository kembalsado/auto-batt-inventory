import { createServerClient } from "@/lib/supabase/server";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { buildStockListRows } from "@/lib/stock-list";
import { Button } from "@/components/ui/button";
import { PrintButton } from "./print-button";
import { StockListTable } from "./stock-list-table";

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <h1 className="text-2xl font-semibold text-brand-ink">Stock List</h1>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          <Button asChild variant="outline" size="touch">
            <a href="/api/stock-list/pdf">Export PDF</a>
          </Button>
          <Button asChild variant="outline" size="touch">
            <a href="/api/stock-list/excel">Export Excel</a>
          </Button>
        </div>
      </div>

      <StockListTable rows={rows} showCost={showCost} />
    </div>
  );
}
