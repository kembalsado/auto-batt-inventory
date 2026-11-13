import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRole } from "@/lib/permissions";
import { createUserAsOwner, type CreateUserInput } from "@/lib/users";

/**
 * POST /api/users — owner-only. Creates a new Supabase Auth user (and, via
 * the `handle_new_user` trigger, its `profiles` row) with the requested
 * role, then records an audit_log entry (lib/users.ts does both).
 *
 * In normal use, middleware.ts already redirects an unauthenticated
 * request to /login before it reaches here — the 401 branch below is
 * defense in depth, not the primary guard. The 403 branch (caller
 * authenticated but not an owner) *is* the primary guard: middleware only
 * checks whether a session exists, not role, so this route is the one
 * place that actually enforces "owner only" for this action.
 */
export async function POST(request: Request) {
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
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const fullName = String(body.fullName ?? "").trim();
  const role = body.role === "owner" ? "owner" : "assistant";

  if (!email || !password || !fullName) {
    return NextResponse.json(
      { error: "email, password, and fullName are required" },
      { status: 400 }
    );
  }

  const input: CreateUserInput = { email, password, fullName, role };

  try {
    const created = await createUserAsOwner(
      createAdminClient(),
      user.id,
      input
    );
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
