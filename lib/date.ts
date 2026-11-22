/**
 * The shop's reference time zone, fixed by the design doc
 * (docs/superpowers/specs/2026-11-13-auto-batt-inventory-design.md). Every
 * "what day is it" decision in this app — the date a movement is recorded
 * under, and the day the daily summary email reports on — must agree on
 * it, or entries recorded in the gap between the two definitions are
 * silently never reported.
 */
export const SHOP_TIME_ZONE = "Asia/Manila";

/**
 * "Today" as a Asia/Manila calendar date ("YYYY-MM-DD"), matching the
 * plain-date (no time zone) shape of `stock_movements.movement_date` and
 * `batches.batch_date`.
 *
 * This is deliberately the ONLY implementation of "today" in the app.
 * Before it existed, the two stock forms and the opening-stock import all
 * used `new Date().toISOString().slice(0, 10)` — a UTC date — while the
 * daily-email cron route computed Asia/Manila. On a UTC-based server
 * (Vercel's default) that mismatch permanently lost data: anything
 * recorded between 00:00 and 08:00 Manila time was dated the *previous*
 * UTC day, so the email for that previous day had already gone out, and
 * the email for the current Manila day queried a date those rows don't
 * carry. Nothing ever reported them.
 *
 * `Intl.DateTimeFormat`'s `en-CA` locale formats dates as `YYYY-MM-DD`
 * natively — a well-known trick that avoids pulling in a date library for
 * what is otherwise a single time-zone-aware format call.
 *
 * `now` is injectable so tests can pin an instant without stubbing the
 * global clock; production callers pass nothing.
 */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TIME_ZONE }).format(
    now
  );
}

/**
 * True when `dateStr` (a plain `YYYY-MM-DD` date, e.g. `batch_date` or
 * `movement_date`) falls after `today`. Plain lexicographic string
 * comparison is safe here — `YYYY-MM-DD` sorts the same way
 * lexicographically as chronologically.
 *
 * `today` defaults to `manilaToday()` so a production caller just
 * validates the date it has in hand; tests pin `today` explicitly
 * instead of relying on the real clock, the same pattern `manilaToday`'s
 * own `now` parameter already uses.
 */
export function isFutureDate(dateStr: string, today: string = manilaToday()): boolean {
  return dateStr > today;
}

/**
 * A timestamp (e.g. `stock_movements.created_at`) as a 12-hour Asia/Manila
 * clock time — `"4:02 AM"` — for display next to an individual movement,
 * same time zone every other "what day/time is it" decision in this app
 * uses (see `SHOP_TIME_ZONE`'s own docstring). Takes an ISO string (what
 * Postgres/PostgREST hands back for a `timestamptz` column) rather than a
 * `Date`, so a caller can pass a row's `created_at` straight through
 * without constructing one first.
 */
export function manilaTime(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoTimestamp));
}

/**
 * A timestamp (e.g. `audit_log.created_at`) as a full Asia/Manila date and
 * time — `"11/23/2026, 1:54:21 AM"` — for screens that need the date
 * alongside the time, not just one or the other (see `manilaToday`/
 * `manilaTime` for those). Same reasoning as both: a bare
 * `new Date(value).toLocaleString()` renders in the server process's
 * default time zone (UTC on Vercel), not Asia/Manila — this is what the
 * Activity page's audit log display used before it was fixed to call
 * this instead, which read a 1:54 AM Manila event as "5:54 PM" the
 * previous day.
 */
export function manilaDateTime(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(isoTimestamp));
}
