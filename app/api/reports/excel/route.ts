import ExcelJS from "exceljs";
import { manilaTime } from "@/lib/date";
import { firstDayOfMonth, lastDayOfMonth } from "@/lib/calendar";
import {
  getDailyReport,
  getMonthlyReport,
  getAnnualReport,
  getItemActivityByDate,
  getItemActivityByDateRange,
  type ItemActivity,
} from "@/lib/reports";
import { resolveReportsExportRequest } from "@/lib/reports-export";

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

// Every sheet below is built from plain (non-keyed) array rows rather
// than exceljs's `columns = [{header, key, ...}]` convenience, which
// writes a header row into row 1 the moment it's assigned — every sheet
// here puts its own period-label row (e.g. "Day" / "2026-11-10") above
// the header, so none of them can let `columns` own row 1. `columns` is
// only ever used afterward, and only for `{width}` (no `header`/`key`),
// which doesn't touch any row's contents.
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

/** Writes a bold `["<label>", value]` period-marker row (row 1) + a blank
 * separator row (row 2) at the top of `sheet` — every sheet below opens
 * this way, so a workbook saved or renamed away from its original
 * filename (the only other place the period appeared) still says what
 * it's reporting on. */
function writePeriodHeader(sheet: ExcelJS.Worksheet, label: string, value: string) {
  sheet.addRow([label, value]);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow([]);
}

/**
 * GET /api/reports/excel?view=&date=&year=&month= — same resolution and
 * gating as app/api/reports/pdf/route.tsx (see that route's docstring and
 * `resolveReportsExportRequest`); built as a workbook via exceljs instead
 * of a PDF document tree.
 */
export async function GET(request: Request): Promise<Response> {
  const resolved = await resolveReportsExportRequest(request);
  if (!resolved.ok) {
    return resolved.response;
  }
  const { supabase, adminSupabase, view, date, year, month } = resolved.value;

  const workbook = new ExcelJS.Workbook();
  let filename: string;

  if (view === "day") {
    const [report, itemActivity] = await Promise.all([
      getDailyReport(supabase, adminSupabase, date),
      getItemActivityByDate(supabase, adminSupabase, date),
    ]);

    const sheet = workbook.addWorksheet("Day Activity");
    writePeriodHeader(sheet, "Day", date);
    sheet.addRow(["Purchases", report.purchases]);
    sheet.addRow(["Stock-out value", report.stockOutValue]);
    sheet.addRow([]);
    sheet.addRow(ITEM_DETAIL_HEADER);
    sheet.getRow(6).font = { bold: true };
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
    const monthLabel = `${year}-${pad2(month)}`;

    const summarySheet = workbook.addWorksheet("Summary");
    writePeriodHeader(summarySheet, "Month", monthLabel);
    summarySheet.addRow(["Day", "Purchases", "Stock-out value"]);
    summarySheet.getRow(3).font = { bold: true };
    for (const day of report.days) {
      summarySheet.addRow([Number(day.date.slice(8, 10)), day.purchases, day.stockOutValue]);
    }
    summarySheet.columns = [10, 14, 18].map((width) => ({ width }));

    const itemDetailSheet = workbook.addWorksheet("Item Detail");
    writePeriodHeader(itemDetailSheet, "Month", monthLabel);
    itemDetailSheet.addRow(["Date", ...ITEM_DETAIL_HEADER]);
    itemDetailSheet.getRow(3).font = { bold: true };
    if (dailyItemActivity.length === 0) {
      itemDetailSheet.addRow(["No activity this month"]);
    } else {
      for (const day of dailyItemActivity) {
        writeItemActivityRows(itemDetailSheet, day.items, "No activity this day", day.date);
      }
    }
    itemDetailSheet.columns = [12, ...ITEM_DETAIL_WIDTHS].map((width) => ({ width }));

    filename = `reports-month-${monthLabel}.xlsx`;
  } else {
    const report = await getAnnualReport(supabase, adminSupabase, year);

    const sheet = workbook.addWorksheet("Summary");
    writePeriodHeader(sheet, "Year", String(year));
    sheet.addRow(["Month", "Purchases", "Stock-out value"]);
    sheet.getRow(3).font = { bold: true };
    for (const monthRow of report.months) {
      sheet.addRow([MONTH_NAMES[monthRow.month - 1], monthRow.purchases, monthRow.stockOutValue]);
    }
    sheet.columns = [14, 14, 18].map((width) => ({ width }));

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
