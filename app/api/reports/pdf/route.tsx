import { NextResponse } from "next/server";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
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
  type DailyItemActivity,
} from "@/lib/reports";
import { formatCurrency } from "@/lib/format";

// @react-pdf/renderer's renderToBuffer is Node-only (see app/api/stock-list/
// pdf/route.tsx's matching comment) — this route must run on the Node.js
// runtime, not Edge, already true by default for a Route Handler, so
// there's nothing to opt into here. An explicit `export const runtime =
// "nodejs"` would otherwise be the more self-documenting choice, but
// next.config.ts's `cacheComponents: true` rejects that route segment
// config outright, so the default has to speak for itself, documented
// here instead.

// Page-local duplicate of app/(dashboard)/reports/page.tsx's own
// MONTH_NAMES — same convention that file's own header comment already
// uses for shiftMonth/shiftDay, not imported.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
  brand: { fontSize: 10, marginBottom: 2, color: "#15502f" },
  title: { fontSize: 16, marginBottom: 4, color: "#1a1a1a" },
  period: { fontSize: 11, marginBottom: 12, color: "#1a1a1a" },
  statRow: { flexDirection: "row", marginBottom: 16, gap: 24 },
  statValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#1a1a1a" },
  statLabel: { fontSize: 8, color: "#666666" },
  sectionHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 6,
    color: "#15502f",
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 4,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 4,
  },
  headerCell: { flex: 1, fontFamily: "Helvetica-Bold" },
  headerCellRight: { flex: 1, fontFamily: "Helvetica-Bold", textAlign: "right" },
  cell: { flex: 1 },
  cellRight: { flex: 1, textAlign: "right" },
  itemHeading: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 10 },
  itemSub: { fontSize: 8, color: "#666666" },
  emptyText: { fontSize: 9, color: "#666666", marginTop: 8 },
});

/** One item's name/SKU/vehicle, followed by a per-movement table (time,
 * type, qty, cost) — or `emptyText` when `items` is empty. Shared by Day
 * view's single list and every per-day section inside Month view. */
function ItemActivitySection({
  items,
  emptyText,
}: {
  items: ItemActivity[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View>
      {items.map((item) => (
        <View key={item.itemId}>
          <Text style={styles.itemHeading}>
            {item.name} <Text style={styles.itemSub}>{item.sku}</Text>
          </Text>
          {item.vehicle !== "—" && <Text style={styles.itemSub}>{item.vehicle}</Text>}
          <View style={styles.headerRow}>
            <Text style={styles.headerCell}>Time</Text>
            <Text style={styles.headerCell}>Type</Text>
            <Text style={styles.headerCellRight}>Qty</Text>
            <Text style={styles.headerCellRight}>Cost</Text>
          </View>
          {item.movements.map((movement) => (
            <View style={styles.row} key={movement.movementId}>
              <Text style={styles.cell}>{manilaTime(movement.occurredAt)}</Text>
              <Text style={styles.cell}>{movement.type}</Text>
              <Text style={styles.cellRight}>{String(movement.quantity)}</Text>
              <Text style={styles.cellRight}>{formatCurrency(movement.cost)}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Day-by-day (Month view) or month-by-month (Year view) totals table —
 * same fields `ReportTable` (app/(dashboard)/reports/report-table.tsx)
 * shows on screen, flattened into a static PDF table. */
function TotalsTable({
  labelHeader,
  rows,
}: {
  labelHeader: string;
  rows: { label: string; purchases: number; stockOutValue: number }[];
}) {
  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.headerCell}>{labelHeader}</Text>
        <Text style={styles.headerCellRight}>Purchases</Text>
        <Text style={styles.headerCellRight}>Stock-out value</Text>
      </View>
      {rows.map((row) => (
        <View style={styles.row} key={row.label}>
          <Text style={styles.cell}>{row.label}</Text>
          <Text style={styles.cellRight}>{formatCurrency(row.purchases)}</Text>
          <Text style={styles.cellRight}>{formatCurrency(row.stockOutValue)}</Text>
        </View>
      ))}
    </View>
  );
}

type ReportsDocumentProps =
  | {
      view: "day";
      periodLabel: string;
      purchases: number;
      stockOutValue: number;
      itemActivity: ItemActivity[];
    }
  | {
      view: "month";
      periodLabel: string;
      purchases: number;
      stockOutValue: number;
      days: { label: string; purchases: number; stockOutValue: number }[];
      dailyItemActivity: DailyItemActivity[];
    }
  | {
      view: "year";
      periodLabel: string;
      purchases: number;
      stockOutValue: number;
      months: { label: string; purchases: number; stockOutValue: number }[];
    };

/**
 * The PDF document tree for Reports. Branches on `view` the same way
 * `page.tsx` branches its on-screen rendering: Day shows the stat totals
 * plus that date's per-item activity list; Month shows the totals plus the
 * day-by-day table plus every day-with-activity's per-item list (or "No
 * activity this month." when the whole month is quiet); Year shows the
 * totals plus the month-by-month table only — no per-item content, per the
 * design's Option A scope.
 */
function ReportsDocument(props: ReportsDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>Auto Batt</Text>
        <Text style={styles.title}>Reports</Text>
        <Text style={styles.period}>{props.periodLabel}</Text>

        <View style={styles.statRow}>
          <View>
            <Text style={styles.statValue}>{formatCurrency(props.purchases)}</Text>
            <Text style={styles.statLabel}>Purchases</Text>
          </View>
          <View>
            <Text style={styles.statValue}>{formatCurrency(props.stockOutValue)}</Text>
            <Text style={styles.statLabel}>Stock-out value</Text>
          </View>
        </View>

        {props.view === "day" && (
          <ItemActivitySection items={props.itemActivity} emptyText="No activity this day." />
        )}

        {props.view === "month" && (
          <>
            <TotalsTable labelHeader="Day" rows={props.days} />
            {props.dailyItemActivity.length === 0 ? (
              <Text style={styles.emptyText}>No activity this month.</Text>
            ) : (
              props.dailyItemActivity.map((day) => (
                <View key={day.date}>
                  <Text style={styles.sectionHeading}>{formatDayLabel(day.date)}</Text>
                  <ItemActivitySection items={day.items} emptyText="No activity this day." />
                </View>
              ))
            )}
          </>
        )}

        {props.view === "year" && <TotalsTable labelHeader="Month" rows={props.months} />}
      </Page>
    </Document>
  );
}

/**
 * GET /api/reports/pdf?view=&date=&year=&month= — same `view`/`date`/
 * `year`/`month` resolution as the Reports page itself
 * (`parseReportsViewParams`), so an export always matches what the viewer
 * is currently looking at. Cost-gated independently of the page (403 when
 * `!canSeeCost`, before `adminSupabase` or any report function is touched)
 * since this route is reachable directly, not only through the page's own
 * (already-hidden) export buttons.
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

  const url = new URL(request.url);
  const { view, date, year, month } = parseReportsViewParams(
    Object.fromEntries(url.searchParams),
    manilaToday()
  );
  // `?inline=1` — used only by the Reports page's Print button
  // (print-export-button.tsx), which opens this route in a new tab and
  // calls `.print()` on it: an `attachment` disposition (the Export PDF
  // link's own default) makes the browser download the file instead of
  // displaying it, leaving nothing in that tab to print.
  const inline = url.searchParams.get("inline") === "1";

  const adminSupabase = createAdminClient();

  let documentProps: ReportsDocumentProps;
  let filename: string;

  if (view === "day") {
    const [report, itemActivity] = await Promise.all([
      getDailyReport(supabase, adminSupabase, date),
      getItemActivityByDate(supabase, adminSupabase, date),
    ]);
    documentProps = {
      view: "day",
      periodLabel: formatDayLabel(date),
      purchases: report.purchases,
      stockOutValue: report.stockOutValue,
      itemActivity,
    };
    filename = `reports-day-${date}.pdf`;
  } else if (view === "month") {
    const startDate = firstDayOfMonth(year, month);
    const endDate = lastDayOfMonth(year, month);
    const [report, dailyItemActivity] = await Promise.all([
      getMonthlyReport(supabase, adminSupabase, year, month),
      getItemActivityByDateRange(supabase, adminSupabase, startDate, endDate),
    ]);
    documentProps = {
      view: "month",
      periodLabel: `${MONTH_NAMES[month - 1]} ${year}`,
      purchases: report.purchases,
      stockOutValue: report.stockOutValue,
      days: report.days.map((d) => ({
        label: String(Number(d.date.slice(8, 10))),
        purchases: d.purchases,
        stockOutValue: d.stockOutValue,
      })),
      dailyItemActivity,
    };
    filename = `reports-month-${year}-${pad2(month)}.pdf`;
  } else {
    const report = await getAnnualReport(supabase, adminSupabase, year);
    documentProps = {
      view: "year",
      periodLabel: String(year),
      purchases: report.purchases,
      stockOutValue: report.stockOutValue,
      months: report.months.map((m) => ({
        label: MONTH_NAMES[m.month - 1],
        purchases: m.purchases,
        stockOutValue: m.stockOutValue,
      })),
    };
    filename = `reports-year-${year}.pdf`;
  }

  const buffer = await renderToBuffer(<ReportsDocument {...documentProps} />);

  // Response's BodyInit type doesn't recognize Node's Buffer (it's
  // structurally a Uint8Array but TS's DOM lib types don't know that) —
  // wrap it so this type-checks without losing the actual bytes. Same
  // pattern as app/api/stock-list/pdf/route.tsx.
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    },
  });
}
