import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getRole, isOwnerOnlyRoute } from "@/lib/permissions";
import { Sidebar } from "@/components/sidebar";

// Every dashboard route reads the caller's session (cookies) and renders
// per-user data, so there is nothing valid to prerender here — force
// dynamic rendering instead of letting cacheComponents try to statically
// build these routes (which fails: "uncached or runtime data during
// prerendering").
export const instant = false;

/**
 * Shell for every authenticated route: fetches the signed-in user's
 * profile, renders the role-gated sidebar, and redirects an assistant
 * away from an owner-only route. Unauthenticated requests never reach
 * here — middleware.ts already redirects those to /login.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single()
      ).data
    : null;

  const role = getRole(profile);

  const pathname = (await headers()).get("x-pathname") ?? "/";
  if (role !== "owner" && isOwnerOnlyRoute(pathname)) {
    redirect("/");
  }

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      {/* `pathname` above is still used for the owner-only-route redirect
          check — it's deliberately NOT passed to Sidebar for highlighting
          the active link; see the comment on Sidebar's own `usePathname`
          call for why a server-sourced pathname goes stale there. */}
      <Sidebar role={role} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
