import { signOutAction } from "@/lib/actions/sign-out";

/**
 * Ends the current session and sends the user back to /login.
 *
 * A Server Action (lib/actions/sign-out.ts), not a client-side
 * `createBrowserClient().auth.signOut()`, for two reasons. First, it
 * matches how every other mutation in this app is written
 * (app/(dashboard)/categories/page.tsx, items/new/page.tsx, the two
 * stock forms all use a Server Action) — the client-side login page is
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
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-white/85 transition-colors hover:bg-brand-green-light/60 hover:text-white"
      >
        Sign out
      </button>
    </form>
  );
}
