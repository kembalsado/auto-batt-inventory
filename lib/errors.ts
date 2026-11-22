/**
 * Helpers for reading what actually went wrong out of a Supabase error.
 *
 * supabase-js does NOT throw `Error` instances for database failures — it
 * resolves with a plain `PostgrestError` object (`{ message, code,
 * details, hint }`), and the lib/ wrappers in this project re-`throw`
 * that object as-is. So the usual `err instanceof Error` reflex is wrong
 * here in both directions: it misses the message, and it misses the
 * SQLSTATE code that says *which* failure this was.
 */

/** The shape supabase-js uses for a database error. */
interface DatabaseErrorLike {
  message?: unknown;
  code?: unknown;
}

function asDatabaseError(err: unknown): DatabaseErrorLike | null {
  return typeof err === "object" && err !== null
    ? (err as DatabaseErrorLike)
    : null;
}

/**
 * A message worth showing a user, for anything that might be thrown.
 *
 * `err instanceof Error ? err.message : String(err)` renders a
 * `PostgrestError` as the literal text "[object Object]", which is what
 * the opening-stock import screen displayed for every database failure.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  const dbError = asDatabaseError(err);
  if (dbError && typeof dbError.message === "string") {
    return dbError.message;
  }
  return String(err);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * This is the everyday typo case — re-entering an SKU or a category name
 * that already exists. `items.sku` and `categories.name` are both UNIQUE
 * (supabase/migrations/0001_init.sql), and before this was handled the
 * violation propagated unhandled out of the Server Action and crashed to
 * Next.js's generic error page, losing whatever else the user had typed.
 */
export function isUniqueViolation(err: unknown): boolean {
  return asDatabaseError(err)?.code === "23505";
}

/**
 * True for a Postgres foreign-key-constraint violation (SQLSTATE 23503).
 *
 * This occurs when attempting to delete a row that is referenced by a
 * foreign key constraint. For example, trying to delete a category that
 * still has items referencing it.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return asDatabaseError(err)?.code === "23503";
}

/**
 * True for PostgREST's "no rows" error (code PGRST116) — thrown by a
 * `.single()` call whose preceding `update`/`delete` matched zero rows
 * (the id doesn't exist, or RLS filtered it out). Distinguishes "there
 * was nothing to act on" from a real database error, so a caller doesn't
 * surface this error object's raw PostgREST sentence to the user.
 */
export function isNotFoundError(err: unknown): boolean {
  return asDatabaseError(err)?.code === "PGRST116";
}
