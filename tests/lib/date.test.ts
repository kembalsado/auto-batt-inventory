import { manilaToday, SHOP_TIME_ZONE } from "@/lib/date";

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
