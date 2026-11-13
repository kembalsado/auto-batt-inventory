import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Ends the current session and sends the user back to /login.
 *
 * A Server Action, not a client-side `createBrowserClient().auth
 * .signOut()`, for two reasons. First, it matches how every other
 * mutation in this app is written (app/(dashboard)/categories/page.tsx,
 * items/new/page.tsx, the two stock forms all use an inline `"use
 * server"` action in a server component) — the client-side login page is
 * the exception, not the rule. Second, clearing the session server-side
 * means the auth cookies are expired by the response itself, so the very
 * next request already has no session and middleware redirects it; there
 * is no window in which a stale client router cache can still render
 * owner-only server components.
 *
 * This is the control that makes role separation mean anything on a
 * shared shop computer. Before it existed there was no `signOut` call
 * anywhere in the app, so the owner signed in once in the morning and
 * the assistant then operated as the owner — seeing cost data, the
 * Activity log and Settings — for the rest of the day.
 */
export function SignOutButton() {
  async function signOut() {
    "use server";

    const supabase = await createServerClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <form action={signOut}>
      <button
        type="submit"
        className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
