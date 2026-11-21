import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { updateCarMake, deleteCarMake } from "@/lib/car-makes";
import {
  isUniqueViolation,
  isForeignKeyViolation,
  describeError,
} from "@/lib/errors";
import { getRole } from "@/lib/permissions";

/**
 * PATCH /api/makes/[id] — owner-only. Body: `{ name: string }`.
 * Renames a car make (lib/car-makes.ts's `updateCarMake`). The
 * owner-only check here is defense in depth alongside the RLS policy
 * that already restricts `car_makes` updates to the owner role at the
 * database layer — see the same shape in app/api/users/[id]/route.ts.
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
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }

  try {
    await updateCarMake(supabase, user.id, id, name);
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "That name already exists." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

/**
 * DELETE /api/makes/[id] — owner-only. Deletes a car make
 * (lib/car-makes.ts's `deleteCarMake`). Same owner-only defense in
 * depth as PATCH above.
 */
export async function DELETE(
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

  try {
    await deleteCarMake(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return NextResponse.json(
        {
          error:
            "Still in use by one or more items — remove or reassign them first.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
