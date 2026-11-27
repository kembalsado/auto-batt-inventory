import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { updateCarModel, deleteCarModel } from "@/lib/car-models";
import {
  isUniqueViolation,
  describeError,
} from "@/lib/errors";
import { getRole } from "@/lib/permissions";

/**
 * PATCH /api/models/[id] — owner-only. Body: `{ name: string }`.
 * Renames a car model (lib/car-models.ts's `updateCarModel`). The
 * owner-only check here is defense in depth alongside the RLS policy
 * that already restricts `car_models` updates to the owner role at the
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
    await updateCarModel(supabase, user.id, id, name);
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "That model already exists for this make." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

/**
 * DELETE /api/models/[id] — owner-only. Deletes a car model
 * (lib/car-models.ts's `deleteCarModel`). Same owner-only defense in
 * depth as PATCH above. No foreign-key violation check needed: the
 * database's cascade on car_models.make_id ensures nothing can hold
 * a reference to a model.
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
    await deleteCarModel(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
