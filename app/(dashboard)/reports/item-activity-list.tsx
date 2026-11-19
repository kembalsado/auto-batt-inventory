import { formatCurrency } from "@/lib/format";
import { manilaTime } from "@/lib/date";
import type { ItemActivity } from "@/lib/reports";

/**
 * Per-item activity breakdown list for a single day's report. Each item's
 * name/SKU/vehicle appears once, followed by every one of its individual
 * movements that day — oldest first (`ItemActivity.movements` is already
 * sorted this way), each on its own line with the time it was recorded
 * (`manilaTime`), a qty pill (green +N for IN, gold −N for OUT), and that
 * movement's own cost — not a day total, so which transaction happened
 * first is directly visible rather than folded into a single aggregate.
 * No "use client" — static markup, server-renderable. Layout follows
 * Calendar's day-modal per-item rows and Stock List's vehicle display.
 */
export function ItemActivityList({ items }: { items: ItemActivity[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity this day.</p>;
  }

  return (
    <div>
      {items.map((item) => (
        <div key={item.itemId} className="border-b border-border py-2 last:border-none">
          <span className="text-sm text-brand-ink">
            {item.name}
            <span className="ml-1.5 text-xs text-muted-foreground">{item.sku}</span>
          </span>
          {item.vehicle !== "—" && (
            <div className="mt-1 text-sm text-muted-foreground">{item.vehicle}</div>
          )}

          <div className="mt-1.5 flex flex-col gap-1">
            {item.movements.map((movement) => (
              <div key={movement.movementId} className="flex items-center justify-between text-sm">
                <span className="text-xs text-muted-foreground">
                  {manilaTime(movement.occurredAt)}
                </span>
                <span className="flex gap-1.5">
                  {movement.type === "IN" ? (
                    <>
                      <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-green">
                        +{movement.quantity}
                      </span>
                      <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-green">
                        {formatCurrency(movement.cost)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="rounded bg-brand-warn-bg px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-gold-dark">
                        −{movement.quantity}
                      </span>
                      <span className="rounded bg-brand-warn-bg px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-gold-dark">
                        {formatCurrency(movement.cost)}
                      </span>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
