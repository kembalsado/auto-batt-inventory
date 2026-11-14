import Link from "next/link";
import { Package, TriangleAlert, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { getDashboardSummary } from "@/lib/dashboard";
import { Badge } from "@/components/ui/badge";

/**
 * Dashboard home: four stat tiles (total active items, items currently
 * low on stock, and today's IN/OUT shown separately rather than combined
 * — a quick glance should answer "how much came in" and "how much went
 * out" as two different numbers, not one net figure) plus the same
 * low-stock list the daily email sends. Built on `getDashboardSummary`
 * (lib/dashboard.ts), which itself reuses the daily email's own
 * `buildDailySummary` rather than re-deriving "today" or "low stock" a
 * third time in this project.
 *
 * Two-column tile grid on a phone, four across from `sm` up — this page
 * was named as one of the two or three screens most likely to get a
 * quick phone check, alongside the Stock List and an item's own page.
 */
export default async function DashboardHomePage() {
  const supabase = await createServerClient();
  const summary = await getDashboardSummary(supabase);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Dashboard</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <Package className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
          <span className="block text-2xl font-bold text-brand-ink">
            {summary.totalActiveItems}
          </span>
          <span className="text-xs text-muted-foreground">Total Items</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <TriangleAlert className="mb-2 size-5 text-brand-gold-dark" aria-hidden="true" />
          <span className="block text-2xl font-bold text-brand-gold-dark">
            {summary.lowStockCount}
          </span>
          <span className="text-xs text-muted-foreground">Low Stock</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <ArrowDownToLine className="mb-2 size-5 text-brand-green" aria-hidden="true" />
          <span className="block text-2xl font-bold text-brand-green">
            {summary.qtyInToday}
          </span>
          <span className="text-xs text-muted-foreground">IN today</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <ArrowUpFromLine className="mb-2 size-5 text-brand-gold-dark" aria-hidden="true" />
          <span className="block text-2xl font-bold text-brand-gold-dark">
            {summary.qtyOutToday}
          </span>
          <span className="text-xs text-muted-foreground">OUT today</span>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-brand-ink">Low stock</h2>
        {summary.lowStockItems.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing is currently low on stock.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {summary.lowStockItems.map((item) => (
              <li
                key={item.itemId}
                className="flex items-center justify-between py-2 text-sm"
              >
                <Link
                  href={`/items/${item.itemId}`}
                  className="text-brand-ink hover:underline"
                >
                  {item.name}
                </Link>
                <Badge variant="warning">
                  {item.qtyOnHand} {item.unit} left
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
