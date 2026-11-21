import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { manilaToday } from "@/lib/date";
import { parseReportsViewParams, type ReportsViewParams } from "@/lib/reports";

export interface ReportsExportRequest extends ReportsViewParams {
  supabase: SupabaseClient;
  adminSupabase: SupabaseClient;
}

/**
 * Shared cost gate + view-param resolution for both Reports export routes
 * (app/api/reports/pdf, app/api/reports/excel) — before this extraction,
 * both routes carried an identical copy of this block (session/role/
 * settings resolution, the `canSeeCost` 403 gate, `parseReportsViewParams`,
 * `createAdminClient`), which risked the two silently drifting apart on
 * security-sensitive logic. `page.tsx` is deliberately NOT routed through
 * this — its gate failure renders a full page, not a JSON 403 Response, so
 * the two shapes don't actually share a return type.
 *
 * Returns a ready-to-return 403 Response (never touching `adminSupabase`
 * or leaking cost data) when `!canSeeCost`; otherwise the resolved view
 * params plus both Supabase clients a report function needs.
 */
export async function resolveReportsExportRequest(
  request: Request
): Promise<
  | { ok: true; value: ReportsExportRequest }
  | { ok: false; response: Response }
> {
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
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const { view, date, year, month } = parseReportsViewParams(
    Object.fromEntries(new URL(request.url).searchParams),
    manilaToday()
  );

  const adminSupabase = createAdminClient();

  return { ok: true, value: { supabase, adminSupabase, view, date, year, month } };
}
