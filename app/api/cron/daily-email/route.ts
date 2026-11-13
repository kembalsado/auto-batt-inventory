import { NextResponse } from "next/server";
import { Resend } from "resend";
import { render } from "@react-email/render";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { buildDailySummary } from "@/lib/email/dailySummary";
import { DailySummaryEmail } from "@/lib/email/DailySummaryEmail";

// Resend's SDK and @react-email/render both do Node-only work (render
// shells out to a Node-only HTML/text pipeline), so this route needs the
// Node.js runtime, not Edge — already the default for a Route Handler.
// (See the PDF/Excel export routes' matching comments for why that
// default isn't spelled out via `export const runtime` here:
// next.config.ts's `cacheComponents: true` rejects that route segment
// config outright.)

/**
 * Resolves "today" as a Asia/Manila calendar date ("YYYY-MM-DD"), matching
 * `stock_movements.movement_date`'s plain-date (no time zone) column.
 * The design doc fixes Asia/Manila as the reference time zone for "end of
 * day" — a cron firing at, say, 11:55pm UTC is already the next calendar
 * day in Manila (UTC+8), so this can't just use the server's own local
 * date.
 *
 * `Intl.DateTimeFormat`'s `en-CA` locale happens to format dates as
 * `YYYY-MM-DD` natively — a well-known trick that avoids pulling in a
 * date library for what is otherwise a single time-zone-aware format
 * call.
 */
function manilaDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date);
}

/**
 * GET /api/cron/daily-email — triggered once daily by Vercel Cron (see
 * the design doc's "Daily email" section). Also safe to hit manually for
 * local testing (`curl localhost:3000/api/cron/daily-email`) — there is
 * no user session involved, so this always runs with the service-role
 * client, not a caller's own session.
 *
 * Gathers the day's summary via `buildDailySummary`, and sends it through
 * Resend to `app_settings.notification_emails` only when there's
 * something to report (`hasActivity`) — matching the design doc's "skip
 * to avoid noise" call. Both the "nothing to report" and "no recipients
 * configured" branches return 200 with `sent: false`, same as the
 * no-`RESEND_API_KEY` branch below — none of these are error conditions.
 *
 * If `CRON_SECRET` is set in the environment, a request must present it
 * as `Authorization: Bearer <CRON_SECRET>` (Vercel's own documented
 * pattern for securing a cron route) or is rejected with 401. Left unset
 * (the default locally, since no cron account exists yet), this check is
 * skipped entirely, so `curl localhost:3000/api/cron/daily-email` keeps
 * working with no setup.
 *
 * No `RESEND_API_KEY` configured yet (true until the user creates a
 * Resend account) is NOT an error: this logs and returns 200 with
 * `sent: false` rather than throwing, so the data-gathering and
 * templating logic can be exercised for real locally before that account
 * exists. A genuine failure calling Resend (key present, call rejected)
 * is allowed to throw/surface as a 500 — that *is* an error worth Vercel
 * Cron's own failure monitoring noticing.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const today = manilaDateString(new Date());

  const [summary, settings] = await Promise.all([
    buildDailySummary(supabase, today),
    getSettings(supabase),
  ]);

  if (!summary.hasActivity) {
    return NextResponse.json({ sent: false, reason: "no-activity", date: today });
  }

  if (settings.notificationEmails.length === 0) {
    console.warn("daily-email: hasActivity but no notificationEmails configured, skipping send");
    return NextResponse.json({ sent: false, reason: "no-recipients", date: today });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      "daily-email: RESEND_API_KEY not set, skipping real send (data-gathering ran fine)",
      { date: today, itemsWithActivity: summary.itemsWithActivity.length, lowStockItems: summary.lowStockItems.length }
    );
    return NextResponse.json({ sent: false, reason: "no-api-key", date: today });
  }

  const element = DailySummaryEmail({
    date: today,
    itemsWithActivity: summary.itemsWithActivity,
    lowStockItems: summary.lowStockItems,
  });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  const resend = new Resend(apiKey);
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "Auto Batt <onboarding@resend.dev>";

  await resend.emails.send({
    from: fromAddress,
    to: settings.notificationEmails,
    subject: `Auto Batt daily summary — ${today}`,
    html,
    text,
  });

  return NextResponse.json({ sent: true, date: today });
}
