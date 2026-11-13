"use server";

import { createServerClient } from "@/lib/supabase/server";
import {
  importOpeningStockAsOwner,
  ForbiddenError,
  type ImportOpeningStockResult,
  type OpeningStockRow,
} from "@/lib/import";

/**
 * Server action backing the owner-only opening-stock import page
 * (app/(dashboard)/import/page.tsx). Resolves the signed-in user from the
 * request's session (the client never gets to choose `actorId`) and
 * forwards to `importOpeningStockAsOwner` (lib/import.ts), which re-checks
 * the caller's role server-side.
 *
 * That re-check matters here specifically because the dashboard layout's
 * `isOwnerOnlyRoute` redirect only gates *rendering* /import on
 * navigation — it does nothing to stop an authenticated assistant from
 * invoking this Server Action directly (e.g. via devtools), bypassing the
 * UI entirely. This file has no business logic of its own beyond that
 * auth lookup and converting a `ForbiddenError` into the same per-row
 * error shape the rest of this result type uses.
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

  try {
    return await importOpeningStockAsOwner(supabase, user.id, rows);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        succeeded: 0,
        errors: rows.map((_, row) => ({ row, message: err.message })),
      };
    }
    throw err;
  }
}
