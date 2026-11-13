"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Ends the current session and sends the user back to /login.
 *
 * Lives in its own file with a top-level "use server" directive — not
 * inline inside sign-out-button.tsx — because that component is now
 * reached through components/sidebar.tsx, a Client Component (needed for
 * the mobile drawer's open/close state). Next.js disallows an inline
 * `"use server"` function defined inside any file that ends up in the
 * client module graph; the fix it documents is exactly this: export the
 * action from a separate file instead.
 */
export async function signOutAction() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
