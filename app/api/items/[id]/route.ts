import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { deleteItem } from "@/lib/items";
import { isForeignKeyViolation, isNotFoundError, describeError } from "@/lib/errors";

/**
 * DELETE /api/items/[id] — any signed-in user (no owner-only gate, same
 * permission model as item edit/update). Deletes an item
 * (lib/items.ts's `deleteItem`). An item that already has stock history
 * (batches/stock_movements) can't be deleted — the database's
 * foreign-key constraint rejects it, surfaced here as a friendly 400
 * instead of a generic one. Same shape as app/api/categories/[id]/
 * route.ts's DELETE handler, minus the owner-only check.
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

  try {
    await deleteItem(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return NextResponse.json(
        {
          error:
            "Can't delete — this item has stock history. Only items with no batches or movements can be deleted.",
        },
        { status: 400 }
      );
    }
    if (isNotFoundError(error)) {
      return NextResponse.json(
        {
          error:
            "This item no longer exists, or you don't have permission to delete it.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
