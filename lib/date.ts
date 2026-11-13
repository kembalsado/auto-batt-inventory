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
