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
//
// Type/Qty/Cost are each split into an IN sub-column and an OUT
// sub-column (under one merged group header) rather than one shared
// column holding both directions — so a reader can see IN and OUT
// movements, and total IN cost vs. OUT cost, without reading every row's
// Type cell. `itemActivityColumns` is the single source of truth for
// which column index is which sub-column, shared by the header writer,
// the row writer, and the totals writer so the three can never drift out
// of alignment with each other.
const ITEM_DETAIL_LABELS = ["Time", "SKU", "Name", "Vehicle"];
const ITEM_DETAIL_WIDTHS = [10, 16, 28, 28, 8, 8, 6, 6, 14, 14]; // Time, SKU, Name, Vehicle, Type(IN/OUT), Qty(IN/OUT), Cost(IN/OUT)

/** 1-based column indices for the IN/OUT sub-columns of each merged group,
 * given whether a leading "Date" column (Month's flattened sheet) shifts
 * everything right by one. */
function itemActivityColumns(withDate: boolean) {
  const base = withDate ? 5 : 4; // [Date,] Time, SKU, Name, Vehicle
  return {
    typeIn: base + 1,
    typeOut: base + 2,
    qtyIn: base + 3,
    qtyOut: base + 4,
    costIn: base + 5,
    costOut: base + 6,
  };
}

/** Writes the item-activity header row at `rowNumber`: single-column
 * labels (optionally prefixed with "Date") followed by three merged
 * 2-column groups — Type, Qty, Cost — each spanning that group's IN/OUT
 * sub-columns from `itemActivityColumns`. Styling (bold, centered group
 * labels) is applied before merging — exceljs folds a merged range's
 * non-anchor cells into references to the anchor, so styling after the
 * merge would be touching cells that no longer hold their own style. */
function writeItemActivityHeader(sheet: ExcelJS.Worksheet, rowNumber: number, withDate: boolean) {
  const row = sheet.getRow(rowNumber);
  const labels = withDate ? ["Date", ...ITEM_DETAIL_LABELS] : ITEM_DETAIL_LABELS;
  labels.forEach((label, i) => {
    row.getCell(i + 1).value = label;
  });

  const cols = itemActivityColumns(withDate);
  const groups: [string, number, number][] = [
    ["Type", cols.typeIn, cols.typeOut],
    ["Qty", cols.qtyIn, cols.qtyOut],
    ["Cost", cols.costIn, cols.costOut],
  ];
  for (const [label, inCol] of groups) {
    const cell = row.getCell(inCol);
    cell.value = label;
    cell.alignment = { horizontal: "center" };
  }
  row.font = { bold: true };
  for (const [, inCol, outCol] of groups) {
    sheet.mergeCells(rowNumber, inCol, rowNumber, outCol);
  }
}

/** Writes one item-activity row per movement, across every item in
 * `items`, into `sheet` — or, when `items` is empty, a single row with
 * `emptyText` instead. `date`, when given, is prepended to each row
 * (Month view's flattened "Item Detail" sheet needs it; Day view's single-
 * date sheet doesn't). Each movement's Type/Qty/Cost land in that
 * direction's sub-column only (see `itemActivityColumns`) — the other
 * direction's sub-column on that row stays blank. */
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
      const isIn = movement.type === "IN";
      const row = [
        manilaTime(movement.occurredAt),
        item.sku,
        item.name,
        item.vehicle,
        isIn ? movement.type : null,
        isIn ? null : movement.type,
        isIn ? movement.quantity : null,
        isIn ? null : movement.quantity,
        isIn ? movement.cost : null,
        isIn ? null : movement.cost,
      ];
      sheet.addRow(date ? [date, ...row] : row);
    }
  }
}

/** Appends a totals row with `purchases`/`stockOutValue` in the Cost
 * group's IN/OUT sub-columns respectively — the same two totals already
 * shown in the "Purchases"/"Stock-out value" rows above the table, so
 * this is the row-level breakdown's own readout of the same numbers
 * rather than a recomputation that could drift from them. */
function writeItemActivityTotals(
  sheet: ExcelJS.Worksheet,
  withDate: boolean,
  purchases: number,
  stockOutValue: number
) {
  const { costIn, costOut } = itemActivityColumns(withDate);
  const row = sheet.addRow([]);
  row.getCell(costIn).value = purchases;
  row.getCell(costOut).value = stockOutValue;
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
    writeItemActivityHeader(sheet, 6, false);
    writeItemActivityRows(sheet, itemActivity, "No activity this day");
    if (itemActivity.length > 0) {
      writeItemActivityTotals(sheet, false, report.purchases, report.stockOutValue);
    }
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
    writeItemActivityHeader(itemDetailSheet, 3, true);
    if (dailyItemActivity.length === 0) {
      itemDetailSheet.addRow(["No activity this month"]);
    } else {
      for (const day of dailyItemActivity) {
        writeItemActivityRows(itemDetailSheet, day.items, "No activity this day", day.date);
      }
      writeItemActivityTotals(itemDetailSheet, true, report.purchases, report.stockOutValue);
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
