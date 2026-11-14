import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { daysInMonth, firstWeekdayOfMonth, getMonthActivity } from "@/lib/calendar";
import { buildDailySummary } from "@/lib/email/dailySummary";
import { manilaToday } from "@/lib/date";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Previous/next month, wrapping the year at the Jan/Dec boundary. */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function monthHref(year: number, month: number): string {
  return `/calendar?year=${year}&month=${month}`;
}

/**
 * Shop-wide calendar: a month grid showing each day's total IN/OUT across
 * every item (built on `getMonthActivity`, one bulk query for the whole
 * month), with a day's full item-level breakdown shown in a modal when
 * clicked. Visible to both roles — unlike Activity, this only ever shows
 * quantities, never cost, so it doesn't need the owner-only gate.
 *
 * The modal is URL-driven (`?date=YYYY-MM-DD`), not client-side state —
 * clicking a day is a plain link, closing it is a link back to the same
 * month with that param dropped. This matches the Activity page's filter
 * pattern (a plain GET, no client JS required) rather than introducing a
 * new interaction model for just this page.
 *
 * Day detail reuses `buildDailySummary` (lib/email/dailySummary.ts,
 * Task 16) for the exact same "this item's IN/OUT on this date" question
 * the daily email already answers, rather than a second implementation —
 * only its `itemsWithActivity` is used here; the email-specific
 * low-stock/hasActivity fields are ignored.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; date?: string }>;
}) {
  const { year: yearParam, month: monthParam, date: dateParam } = await searchParams;

  const today = manilaToday();
  const [todayYear, todayMonth] = today.split("-").map(Number);

  const year = Number.isFinite(Number(yearParam)) && yearParam ? Number(yearParam) : todayYear;
  const month =
    Number.isFinite(Number(monthParam)) && monthParam && Number(monthParam) >= 1 && Number(monthParam) <= 12
      ? Number(monthParam)
      : todayMonth;

  const supabase = await createServerClient();
  const days = await getMonthActivity(supabase, year, month);
  const activityByDate = new Map(days.map((d) => [d.date, d]));

  const leadingEmpty = firstWeekdayOfMonth(year, month);
  const totalDays = daysInMonth(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const dayDetail =
    dateParam && dateParam.startsWith(`${year}-${pad2(month)}`)
      ? (await buildDailySummary(supabase, dateParam)).itemsWithActivity
      : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Calendar</h1>

      <div className="mt-6 max-w-3xl overflow-hidden rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between bg-brand-green px-4 py-3 text-white">
          <Link
            href={monthHref(prev.year, prev.month)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-sm hover:bg-white/20"
            aria-label="Previous month"
          >
            ‹
          </Link>
          <span className="text-base font-extrabold">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <Link
            href={monthHref(next.year, next.month)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-sm hover:bg-white/20"
            aria-label="Next month"
          >
            ›
          </Link>
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[560px] grid-cols-7 gap-px bg-border">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-background py-2 text-center text-[11px] font-bold tracking-wide text-muted-foreground uppercase"
              >
                {label}
              </div>
            ))}

            {Array.from({ length: leadingEmpty }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[76px] bg-accent/40" />
            ))}

            {Array.from({ length: totalDays }).map((_, i) => {
              const dayNum = i + 1;
              const date = `${year}-${pad2(month)}-${pad2(dayNum)}`;
              const activity = activityByDate.get(date);
              const isToday = date === today;

              return (
                <div key={date} className="flex min-h-[76px] flex-col gap-1 bg-card p-1.5">
                  <span
                    className={
                      isToday
                        ? "text-xs font-bold text-brand-green"
                        : "text-xs font-bold text-foreground"
                    }
                  >
                    {dayNum}
                  </span>
                  {activity ? (
                    <Link
                      href={`/calendar?year=${year}&month=${month}&date=${date}`}
                      className="mt-auto flex flex-col gap-0.5"
                    >
                      {activity.qtyIn > 0 && (
                        <span className="w-fit rounded bg-green-100 px-1.5 py-0.5 text-[10.5px] font-extrabold text-green-700">
                          +{activity.qtyIn}
                        </span>
                      )}
                      {activity.qtyOut > 0 && (
                        <span className="w-fit rounded bg-brand-warn-bg px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-gold-dark">
                          −{activity.qtyOut}
                        </span>
                      )}
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {dayDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl bg-card shadow-2xl">
            <div className="flex items-center justify-between bg-brand-green px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold">Activity — {dateParam}</h2>
              <Link
                href={monthHref(year, month)}
                aria-label="Close"
                className="text-lg leading-none"
              >
                ✕
              </Link>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {dayDetail.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity this day.</p>
              ) : (
                dayDetail.map((item) => (
                  <div
                    key={item.itemId}
                    className="flex items-center justify-between border-b border-border py-2 text-sm last:border-none"
                  >
                    <span className="text-brand-ink">
                      {item.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">{item.sku}</span>
                    </span>
                    <span className="flex gap-1.5">
                      {item.qtyIn > 0 && (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10.5px] font-extrabold text-green-700">
                          +{item.qtyIn}
                        </span>
                      )}
                      {item.qtyOut > 0 && (
                        <span className="rounded bg-brand-warn-bg px-1.5 py-0.5 text-[10.5px] font-extrabold text-brand-gold-dark">
                          −{item.qtyOut}
                        </span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
