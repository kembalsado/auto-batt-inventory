import ExcelJS from "exceljs";
import { createServerClient } from "@/lib/supabase/server";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { buildStockListRows } from "@/lib/stock-list";

// exceljs writes via Node Buffers/streams, so this needs the Node.js
// runtime, not Edge — already the default for a Route Handler. (See the
// PDF route's matching comment for why that default isn't spelled out
// via `export const runtime` here: next.config.ts's `cacheComponents:
// true` rejects that route segment config.)

/**
 * GET /api/stock-list/excel — the same rows the stock list page shows
 * (via the shared `buildStockListRows`, lib/stock-list.ts), built into a
 * workbook via exceljs and returned as
 * `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
 *
 * The header row only includes Unit cost / Inventory value when
 * `canSeeCost` allows it for this request's own session role + current
 * settings (re-derived here, not trusted from the client), matching the
 * page and the PDF route — so a hidden viewer's workbook has no cost
 * columns at all, not blank ones.
 */
export async function GET() {
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

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stock List");

  const columns: Partial<ExcelJS.Column>[] = [
    { header: "SKU", key: "sku", width: 16 },
    { header: "Name", key: "name", width: 28 },
    { header: "Category", key: "category", width: 20 },
    { header: "Qty on hand", key: "qtyOnHand", width: 14 },
    { header: "Unit", key: "unit", width: 10 },
  ];
  if (showCost) {
    columns.push(
      { header: "Unit cost", key: "unitCost", width: 14 },
      { header: "Inventory value", key: "inventoryValue", width: 18 }
    );
  }
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      sku: row.sku,
      name: row.name,
      category: row.category,
      qtyOnHand: row.qtyOnHand,
      unit: row.unit,
      ...(showCost
        ? {
            unitCost: row.unitCost ?? "",
            inventoryValue: row.inventoryValue ?? "",
          }
        : {}),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  // See the PDF route's matching comment: Response's BodyInit type
  // doesn't recognize Node's Buffer, so wrap it.
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="stock-list.xlsx"',
    },
  });
}
