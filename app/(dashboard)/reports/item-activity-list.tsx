import { formatCurrency } from "@/lib/format";
import type { ItemActivity } from "@/lib/reports";

/**
 * Per-item activity breakdown list for a single day's report.
 * Shows each item's name, SKU, vehicle, and qty/cost in and out as small
 * colored pill badges. No "use client" — static markup, server-renderable.
 * Layout follows Calendar's day-modal per-item rows and Stock List's
 * vehicle display.
 */
export function ItemActivityList({ items }: { items: ItemActivity[] }): JSX.Element {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity this day.</p>;
  }

  return (
    <div>
      {items.map((item) => (
        <div
          key={item.itemId}
          className="flex items-center justify-between border-b border-border py-2 text-sm last:border-none"
        >
          <div className="flex-1">
            <span className="text-brand-ink">
              {item.name}
              <span className="ml-1.5 text-xs text-muted-foreground">{item.sku}</span>
            </span>
            {item.vehicle !== "—" && (
              <div className="mt-1 text-sm text-muted-foreground">{item.vehicle}</div>
            )}
          </div>
          <span className="flex gap-1.5">
            {item.qtyIn > 0 && (
              <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-green">
                +{item.qtyIn}
              </span>
            )}
            {item.qtyOut > 0 && (
              <span className="rounded bg-brand-warn-bg px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-gold-dark">
                −{item.qtyOut}
              </span>
            )}
            {item.costIn > 0 && (
              <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-green">
                {formatCurrency(item.costIn)}
              </span>
            )}
            {item.costOut > 0 && (
              <span className="rounded bg-brand-warn-bg px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-gold-dark">
                {formatCurrency(item.costOut)}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
