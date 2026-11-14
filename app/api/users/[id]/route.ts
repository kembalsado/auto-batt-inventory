import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRole } from "@/lib/permissions";
import { setUserActive } from "@/lib/users";
import { describeError } from "@/lib/errors";

/**
 * PATCH /api/users/[id] — owner-only. Body: `{ isActive: boolean }`.
 * Activates or deactivates the target user (lib/users.ts's
 * `setUserActive` — a Supabase Auth ban/unban, not a row delete; see its
 * own docstring for why). Same 401/403 guards as the rest of
 * app/api/users, for the same reason.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (getRole(profile) !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const isActive = body.isActive === true;

  try {
    await setUserActive(createAdminClient(), user.id, id, isActive);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // describeError handles both shapes that can land here: a real
    // `Error` (SelfTargetError, lib/users.ts) and a plain AuthError/
    // PostgrestError-shaped object from the admin API call it wraps —
    // see app/api/users/route.ts's POST handler for why the naive
    // `error instanceof Error` check isn't enough for the latter.
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
