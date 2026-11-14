import Link from "next/link";
import { Plus } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/permissions";
import { buildStockListRows } from "@/lib/stock-list";
import { Button } from "@/components/ui/button";
import { ItemsTable } from "./items-table";

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
        <Button asChild size="touch">
          <Link href="/items/new">
            <Plus aria-hidden="true" />
            Add item
          </Link>
        </Button>
      </div>

      <ItemsTable rows={rows} />
    </div>
  );
}
