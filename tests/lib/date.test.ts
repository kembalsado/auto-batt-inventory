import { manilaToday, manilaTime, manilaDateTime, SHOP_TIME_ZONE, isFutureDate } from "@/lib/date";

test("manilaToday formats as YYYY-MM-DD", () => {
  expect(manilaToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("SHOP_TIME_ZONE is Asia/Manila", () => {
  expect(SHOP_TIME_ZONE).toBe("Asia/Manila");
});

// The bug this helper exists to fix, stated as a test: 2026-11-13T00:30Z
// is 08:30 on 2026-11-13 in Manila, but 2026-11-12T23:30Z is already
// 07:30 on 2026-11-13 there — and that second instant is exactly where
// the old `new Date().toISOString().slice(0, 10)` disagreed, dating the
// movement 2026-11-12 while the daily email (already correct) asked for
// 2026-11-13 and never found it.
test("manilaToday rolls over 8 hours ahead of UTC, so a UTC-evening instant is already the next Manila day", () => {
  const utcEvening = new Date("2026-11-12T23:30:00Z");

  expect(utcEvening.toISOString().slice(0, 10)).toBe("2026-11-12");
  expect(manilaToday(utcEvening)).toBe("2026-11-13");
});

test("manilaToday agrees with the UTC date when the instant is mid-day UTC", () => {
  const utcMidday = new Date("2026-11-13T04:00:00Z");

  expect(manilaToday(utcMidday)).toBe("2026-11-13");
  expect(utcMidday.toISOString().slice(0, 10)).toBe("2026-11-13");
});

// The matching early-morning-Manila case: 00:30 Manila on the 13th is
// 16:30 UTC on the 12th. Under the old UTC computation an entry made
// then was dated the 12th — a day the email had already sent for.
test("an early-morning Manila instant is dated that Manila day, not the previous UTC day", () => {
  const earlyManila = new Date("2026-11-12T16:30:00Z");

  expect(earlyManila.toISOString().slice(0, 10)).toBe("2026-11-12");
  expect(manilaToday(earlyManila)).toBe("2026-11-13");
});

test("manilaTime formats a timestamptz string as a 12-hour Asia/Manila clock time", () => {
  // 2026-11-19T20:02:00Z is 04:02 on 2026-11-20 in Manila (UTC+8).
  expect(manilaTime("2026-11-19T20:02:00Z")).toBe("4:02 AM");
});

test("manilaTime pads single-digit minutes but not the hour", () => {
  // 2026-11-19T21:09:00Z is 05:09 on 2026-11-20 in Manila.
  expect(manilaTime("2026-11-19T21:09:00Z")).toBe("5:09 AM");
});

test("manilaTime formats a PM time correctly", () => {
  // 2026-11-19T06:30:00Z is 14:30 (2:30 PM) on 2026-11-19 in Manila.
  expect(manilaTime("2026-11-19T06:30:00Z")).toBe("2:30 PM");
});

// The exact bug report: the Owner created an account at 11/23/2026 1:54 AM
// Manila time; the Activity page's own ad-hoc `new Date(value).toLocaleString()`
// (no timeZone option) rendered it as "11/22/2026, 5:54:21 PM" instead —
// the server's runtime default (UTC on Vercel) is 8 hours behind Manila.
// Pinned here against the real instant so this regresses loudly if the
// Activity page's date+time formatting ever stops routing through this
// single source of truth.
test("manilaDateTime formats a timestamptz string as a full Asia/Manila date and time", () => {
  expect(manilaDateTime("2026-11-22T17:54:21.000Z")).toBe("11/23/2026, 1:54:21 AM");
});

test("isFutureDate is true for a date after today", () => {
  expect(isFutureDate("2026-11-24", "2026-11-23")).toBe(true);
});

test("isFutureDate is false for today itself", () => {
  expect(isFutureDate("2026-11-23", "2026-11-23")).toBe(false);
});

test("isFutureDate is false for a date before today", () => {
  expect(isFutureDate("2026-11-22", "2026-11-23")).toBe(false);
});
