import { isPublicRoute } from "@/lib/permissions";

test("the login page is public", () => {
  expect(isPublicRoute("/login")).toBe(true);
});

// C3: middleware's matcher covers /api/*, so before /api/cron was listed
// here, Vercel Cron's cookie-less request to the daily-email route was
// answered with a 307 to /login and the handler never ran.
test("the cron route is public so Vercel Cron's cookie-less request reaches the handler", () => {
  expect(isPublicRoute("/api/cron/daily-email")).toBe(true);
});

test("the /api/cron prefix covers future cron routes too", () => {
  expect(isPublicRoute("/api/cron")).toBe(true);
  expect(isPublicRoute("/api/cron/weekly-report")).toBe(true);
});

// The previously-deferred prefix-matching hardening: a bare
// `startsWith` made any route merely prefixed by a public one public.
test("a route that merely starts with a public path's text is NOT public", () => {
  expect(isPublicRoute("/login-history")).toBe(false);
  expect(isPublicRoute("/loginx")).toBe(false);
  expect(isPublicRoute("/api/cronjobs-admin")).toBe(false);
  expect(isPublicRoute("/api/cron-secrets")).toBe(false);
});

test("ordinary dashboard and API routes are not public", () => {
  expect(isPublicRoute("/")).toBe(false);
  expect(isPublicRoute("/items")).toBe(false);
  expect(isPublicRoute("/items/abc-123")).toBe(false);
  expect(isPublicRoute("/settings")).toBe(false);
  expect(isPublicRoute("/api/users")).toBe(false);
  expect(isPublicRoute("/api/stock-list/pdf")).toBe(false);
});
