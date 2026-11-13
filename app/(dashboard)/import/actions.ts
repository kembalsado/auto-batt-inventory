"use server";

import { createServerClient } from "@/lib/supabase/server";
import {
  importOpeningStock,
  type ImportOpeningStockResult,
  type OpeningStockRow,
} from "@/lib/import";

/**
 * Server action backing the owner-only opening-stock import page
 * (app/(dashboard)/import/page.tsx). Resolves the signed-in user from the
 * request's session (the client never gets to choose `actorId`) and
 * forwards straight to `importOpeningStock` (lib/import.ts) — this file
 * has no logic of its own beyond that auth lookup, matching the
 * categories/items pages' convention of a thin "use server" action.
 */
export async function submitOpeningStockImport(
  rows: OpeningStockRow[]
): Promise<ImportOpeningStockResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      succeeded: 0,
      errors: rows.map((_, row) => ({ row, message: "Not signed in." })),
    };
  }

  return importOpeningStock(supabase, user.id, rows);
}
