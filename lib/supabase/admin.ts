import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client that uses the service-role key and bypasses RLS.
 *
 * Server-only — the service-role key must never reach the browser. Never
 * import this module from a Client Component or any code bundled for the
 * client.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
