import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { manilaToday, manilaTime } from "@/lib/date";
import { firstDayOfMonth, lastDayOfMonth } from "@/lib/calendar";
import {
  getDailyReport,
  getMonthlyReport,
  getAnnualReport,
  getItemActivityByDate,
  getItemActivityByDateRange,
  parseReportsViewParams,
  type ItemActivity,
} from "@/lib/reports";

// exceljs writes via Node Buffers/streams, so this needs the Node.js
// runtime, not Edge — already the default for a Route Handler. Same
// documented reasoning as app/api/reports/pdf/route.tsx and app/api/
// stock-list/excel/route.ts for why that default isn't spelled out via
// `export const runtime` here: next.config.ts's `cacheComponents: true`
// rejects that route segment config.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Plain (non-keyed) array column widths for the item-activity detail
// sheets below — deliberately NOT set via exceljs's `columns = [{header,
// key, ...}]` convenience, which writes a header row into row 1 the
// moment it's assigned: both detail sheets below need their own header
// row somewhere other than row 1 (Day Activity's sits after two totals
// rows and a blank), so headers are written as plain rows instead and
// `columns` here only ever carries `width` — a column def with no
// `header` property doesn't touch row 1 at all.
const ITEM_DETAIL_WIDTHS = [10, 16, 28, 20, 8, 10, 14]; // Time, SKU, Name, Vehicle, Type, Qty, Cost
const ITEM_DETAIL_HEADER = ["Time", "SKU", "Name", "Vehicle", "Type", "Qty", "Cost"];

/** Writes one item-activity row per movement, across every item in
 * `items`, into `sheet` — or, when `items` is empty, a single row with
 * `emptyText` instead. `date`, when given, is prepended to each row
 * (Month view's flattened "Item Detail" sheet needs it; Day view's single-
 * date sheet doesn't). Plain positional arrays, matching whatever header
 * row the caller already wrote — see `ITEM_DETAIL_HEADER`'s column order. */
function writeItemActivityRows(
  sheet: ExcelJS.Worksheet,
  items: ItemActivity[],
  emptyText: string,
  date?: string
) {
  if (items.length === 0) {
    sheet.addRow([emptyText]);
    return;
  }

  for (const item of items) {
    for (const movement of item.movements) {
      const row = [
        manilaTime(movement.occurredAt),
        item.sku,
        item.name,
        item.vehicle,
        movement.type,
        movement.quantity,
        movement.cost,
      ];
      sheet.addRow(date ? [date, ...row] : row);
    }
  }
}

/**
 * GET /api/reports/excel?view=&date=&year=&month= — same resolution and
 * gating as app/api/reports/pdf/route.tsx (see that route's docstring);
 * built as a workbook via exceljs instead of a PDF document tree.
 */
export async function GET(request: Request): Promise<Response> {
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
  const settings = await getSettings(supabase);

  if (!canSeeCost(role, settings)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { view, date, year, month } = parseReportsViewParams(
    Object.fromEntries(new URL(request.url).searchParams),
    manilaToday()
  );

  const adminSupabase = createAdminClient();

  const workbook = new ExcelJS.Workbook();
  let filename: string;

  if (view === "day") {
    const [report, itemActivity] = await Promise.all([
      getDailyReport(supabase, adminSupabase, date),
      getItemActivityByDate(supabase, adminSupabase, date),
    ]);

    const sheet = workbook.addWorksheet("Day Activity");
    sheet.addRow(["Purchases", report.purchases]);
    sheet.addRow(["Stock-out value", report.stockOutValue]);
    sheet.addRow([]);
    sheet.addRow(ITEM_DETAIL_HEADER);
    sheet.getRow(4).font = { bold: true };
    writeItemActivityRows(sheet, itemActivity, "No activity this day");
    sheet.columns = ITEM_DETAIL_WIDTHS.map((width) => ({ width }));

    filename = `reports-day-${date}.xlsx`;
  } else if (view === "month") {
    const startDate = firstDayOfMonth(year, month);
    const endDate = lastDayOfMonth(year, month);
    const [report, dailyItemActivity] = await Promise.all([
      getMonthlyReport(supabase, adminSupabase, year, month),
      getItemActivityByDateRange(supabase, adminSupabase, startDate, endDate),
    ]);

    const summarySheet = workbook.addWorksheet("Summary");
    summarySheet.columns = [
      { header: "Day", key: "day", width: 10 },
      { header: "Purchases", key: "purchases", width: 14 },
      { header: "Stock-out value", key: "stockOutValue", width: 18 },
    ];
    summarySheet.getRow(1).font = { bold: true };
    for (const day of report.days) {
      summarySheet.addRow({
        day: Number(day.date.slice(8, 10)),
        purchases: day.purchases,
        stockOutValue: day.stockOutValue,
      });
    }

    const itemDetailSheet = workbook.addWorksheet("Item Detail");
    itemDetailSheet.addRow(["Date", ...ITEM_DETAIL_HEADER]);
    itemDetailSheet.getRow(1).font = { bold: true };
    if (dailyItemActivity.length === 0) {
      itemDetailSheet.addRow(["No activity this month"]);
    } else {
      for (const day of dailyItemActivity) {
        writeItemActivityRows(itemDetailSheet, day.items, "No activity this day", day.date);
      }
    }
    itemDetailSheet.columns = [12, ...ITEM_DETAIL_WIDTHS].map((width) => ({ width }));

    filename = `reports-month-${year}-${pad2(month)}.xlsx`;
  } else {
    const report = await getAnnualReport(supabase, adminSupabase, year);

    const sheet = workbook.addWorksheet("Summary");
    sheet.columns = [
      { header: "Month", key: "month", width: 14 },
      { header: "Purchases", key: "purchases", width: 14 },
      { header: "Stock-out value", key: "stockOutValue", width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const monthRow of report.months) {
      sheet.addRow({
        month: MONTH_NAMES[monthRow.month - 1],
        purchases: monthRow.purchases,
        stockOutValue: monthRow.stockOutValue,
      });
    }

    filename = `reports-year-${year}.xlsx`;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  // See the PDF route's matching comment: Response's BodyInit type
  // doesn't recognize Node's Buffer, so wrap it.
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
