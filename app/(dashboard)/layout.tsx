import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getRole, isOwnerOnlyRoute } from "@/lib/permissions";
import { Sidebar } from "@/components/sidebar";

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
    <div className="flex flex-1">
      <Sidebar role={role} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
