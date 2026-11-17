import Link from "next/link";
import { ChevronLeft, ChevronRight, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { manilaToday } from "@/lib/date";
import { getDailyReport, getMonthlyReport, getAnnualReport } from "@/lib/reports";
import { formatCurrency } from "@/lib/format";
import { ReportTable, type ReportTableRow } from "./report-table";
import { PendingIcon, PendingLabel, PendingSubmitButton } from "./pending-indicators";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type View = "day" | "month" | "year";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Previous/next month, wrapping the year at the Jan/Dec boundary. Page-
 * local duplicate of `app/(dashboard)/calendar/page.tsx`'s own copy — same
 * convention, not imported. */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Previous/next calendar day ("YYYY-MM-DD" in, "YYYY-MM-DD" out) — the
 * day-level equivalent of `shiftMonth` above, same `Date.UTC` technique. */
function shiftDay(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function dayHref(date: string): string {
  return `/reports?view=day&date=${date}`;
}

function monthHref(year: number, month: number): string {
  return `/reports?view=month&year=${year}&month=${month}`;
}

function yearHref(year: number): string {
  return `/reports?view=year&year=${year}`;
}

function tabClass(active: boolean): string {
  return active
    ? "rounded-md bg-brand-green px-3 py-1.5 text-sm font-bold text-white"
    : "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground";
}

/**
 * Owner-visible (or assistant-visible-when-opted-in) cost report: Day,
 * Month, and Year views over `lib/reports.ts`'s `getDailyReport`/
 * `getMonthlyReport`/`getAnnualReport`, each showing two stat numbers
 * (Purchases, Stock-out value) plus — for Month/Year — a `ReportTable`
 * breakdown.
 *
 * Gated by `canSeeCost` (lib/permissions.ts), re-checked here rather than
 * relying only on `isOwnerOnlyRoute` (lib/permissions.ts) — this route is
 * NOT owner-only (an assistant can reach it once the owner opts in via
 * Settings), so the layout's owner-only gate doesn't cover it at all. The
 * gate runs before `createAdminClient()` and before any report function
 * is called: a viewer who can't see cost gets neither the service-role
 * client nor a cost query, not just a hidden result.
 *
 * View/date state is entirely URL-driven (`?view=&date=&year=&month=`),
 * matching Calendar's own navigational pattern — plain `<Link>`s, no
 * client JS, no component state.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; year?: string; month?: string }>;
}) {
  const { view: viewParam, date: dateParam, year: yearParam, month: monthParam } = await searchParams;

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
    return (
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Reports</h1>
        <p className="mt-6 text-sm text-muted-foreground">
          Ask the owner to turn on cost visibility in Settings to see this page.
        </p>
      </div>
    );
  }

  const adminSupabase = createAdminClient();

  const today = manilaToday();
  const [todayYear, todayMonth] = today.split("-").map(Number);

  const view: View = viewParam === "day" || viewParam === "year" ? viewParam : "month";

  const year = Number.isFinite(Number(yearParam)) && yearParam ? Number(yearParam) : todayYear;
  const month =
    Number.isFinite(Number(monthParam)) && monthParam && Number(monthParam) >= 1 && Number(monthParam) <= 12
      ? Number(monthParam)
      : todayMonth;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  // Where each tab link lands, preserving the current date context as
  // closely as possible rather than always resetting to "today":
  // - from Day, Month/Year keep that day's own month/year.
  // - from Month/Year, Day lands on today if the viewed period contains
  //   today, otherwise the 1st of the viewed month (Jan 1 for Year, or
  //   the current month if the viewed year is the current year).
  // - Month -> Year and Year -> Month both keep the viewed year.
  let tabDate = date;
  let tabYear = year;
  let tabMonth = month;

  if (view === "day") {
    const [dYear, dMonth] = date.split("-").map(Number);
    tabYear = dYear;
    tabMonth = dMonth;
  } else if (view === "month") {
    tabDate = year === todayYear && month === todayMonth ? today : `${year}-${pad2(month)}-01`;
  } else {
    tabMonth = year === todayYear ? todayMonth : 1;
    tabDate = year === todayYear ? today : `${year}-${pad2(tabMonth)}-01`;
  }

  let purchases = 0;
  let stockOutValue = 0;
  let tableRows: ReportTableRow[] = [];
  let periodLabel = "";
  let prevHref = "";
  let nextHref = "";
  let prevLabel = "";
  let nextLabel = "";

  if (view === "day") {
    const report = await getDailyReport(supabase, adminSupabase, date);
    purchases = report.purchases;
    stockOutValue = report.stockOutValue;
    const [dateYear, dateMonth, dateDay] = date.split("-").map(Number);
    periodLabel = `${MONTH_NAMES[dateMonth - 1]} ${dateDay}, ${dateYear}`;
    prevHref = dayHref(shiftDay(date, -1));
    nextHref = dayHref(shiftDay(date, 1));
    prevLabel = "Previous day";
    nextLabel = "Next day";
  } else if (view === "month") {
    const report = await getMonthlyReport(supabase, adminSupabase, year, month);
    purchases = report.purchases;
    stockOutValue = report.stockOutValue;
    periodLabel = `${MONTH_NAMES[month - 1]} ${year}`;
    tableRows = report.days.map((d) => ({
      label: String(Number(d.date.slice(8, 10))),
      isCurrent: d.date === today,
      purchases: d.purchases,
      stockOutValue: d.stockOutValue,
    }));
    const prev = shiftMonth(year, month, -1);
    const next = shiftMonth(year, month, 1);
    prevHref = monthHref(prev.year, prev.month);
    nextHref = monthHref(next.year, next.month);
    prevLabel = "Previous month";
    nextLabel = "Next month";
  } else {
    const report = await getAnnualReport(supabase, adminSupabase, year);
    purchases = report.purchases;
    stockOutValue = report.stockOutValue;
    periodLabel = String(year);
    tableRows = report.months.map((m) => ({
      label: MONTH_NAMES[m.month - 1],
      isCurrent: m.month === todayMonth && year === todayYear,
      purchases: m.purchases,
      stockOutValue: m.stockOutValue,
    }));
    prevHref = yearHref(year - 1);
    nextHref = yearHref(year + 1);
    prevLabel = "Previous year";
    nextLabel = "Next year";
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Reports</h1>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          <Link href={dayHref(tabDate)} className={tabClass(view === "day")}>
            <PendingLabel>Day</PendingLabel>
          </Link>
          <Link href={monthHref(tabYear, tabMonth)} className={tabClass(view === "month")}>
            <PendingLabel>Month</PendingLabel>
          </Link>
          <Link href={yearHref(tabYear)} className={tabClass(view === "year")}>
            <PendingLabel>Year</PendingLabel>
          </Link>
        </div>

        {/* Jump straight to a date/month/year — plain GET forms, no client
            JS for the navigation itself (PendingSubmitButton only reports
            status; it doesn't drive the submit). Each form only carries its
            own fields, so submitting always lands on a clean URL for that
            view rather than inheriting stale params from whatever view the
            viewer was on before. */}
        {view === "day" && (
          <form action="/reports" method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value="day" />
            <label className="sr-only" htmlFor="report-date">
              Jump to date
            </label>
            <input
              id="report-date"
              type="date"
              name="date"
              defaultValue={date}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-brand-ink"
            />
            <PendingSubmitButton />
          </form>
        )}
        {view === "month" && (
          <form action="/reports" method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value="month" />
            <label className="sr-only" htmlFor="report-month">
              Jump to month
            </label>
            <select
              id="report-month"
              name="month"
              defaultValue={month}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-brand-ink"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="report-month-year">
              Jump to year
            </label>
            <input
              id="report-month-year"
              type="number"
              name="year"
              defaultValue={year}
              min={2000}
              max={2100}
              className="h-9 w-20 rounded-md border border-border bg-background px-2 text-sm text-brand-ink"
            />
            <PendingSubmitButton />
          </form>
        )}
        {view === "year" && (
          <form action="/reports" method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value="year" />
            <label className="sr-only" htmlFor="report-year">
              Jump to year
            </label>
            <input
              id="report-year"
              type="number"
              name="year"
              defaultValue={year}
              min={2000}
              max={2100}
              className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm text-brand-ink"
            />
            <PendingSubmitButton />
          </form>
        )}
      </div>

      <div className="mt-6 max-w-3xl overflow-hidden rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between bg-brand-green px-4 py-3 text-white">
          <Link
            href={prevHref}
            aria-label={prevLabel}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10 hover:bg-white/20"
          >
            <PendingIcon className="size-4">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </PendingIcon>
          </Link>
          <span className="text-base font-extrabold">{periodLabel}</span>
          <Link
            href={nextHref}
            aria-label={nextLabel}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10 hover:bg-white/20"
          >
            <PendingIcon className="size-4">
              <ChevronRight className="size-4" aria-hidden="true" />
            </PendingIcon>
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-card p-4">
            <ArrowDownToLine className="mb-2 size-5 text-brand-green" aria-hidden="true" />
            <span className="block text-2xl font-bold text-brand-ink">
              {formatCurrency(purchases)}
            </span>
            <span className="text-xs text-muted-foreground">Purchases</span>
          </div>
          <div className="bg-card p-4">
            <ArrowUpFromLine className="mb-2 size-5 text-brand-gold-dark" aria-hidden="true" />
            <span className="block text-2xl font-bold text-brand-ink">
              {formatCurrency(stockOutValue)}
            </span>
            <span className="text-xs text-muted-foreground">Stock-out value</span>
          </div>
        </div>

        {view !== "day" && (
          <div className="bg-card px-4 pb-2">
            <ReportTable
              rows={tableRows}
              labelHeader={view === "month" ? "Day" : "Month"}
            />
          </div>
        )}
      </div>
    </div>
  );
}
