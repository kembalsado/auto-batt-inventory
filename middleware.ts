import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
// Which paths are reachable without a session, and why, lives in
// lib/permissions.ts next to isOwnerOnlyRoute — both are route-matching
// rules of the same shape, and keeping it there makes it unit-testable
// without standing up a request.
import { isPublicRoute } from "@/lib/permissions";

/**
 * Refreshes the Supabase session on every request and redirects
 * unauthenticated requests to `/login`. Follows Supabase's standard
 * `@supabase/ssr` Next.js middleware recipe.
 */
export async function middleware(request: NextRequest) {
  // Next.js gives Server Components no built-in way to read the current
  // pathname (next/headers exposes cookies/headers/draftMode only), so the
  // dashboard layout (app/(dashboard)/layout.tsx) needs it forwarded via a
  // request header to decide whether an assistant is hitting an owner-only
  // route. Rebuilt from `request` each time below so it reflects any
  // cookie refresh Supabase performs via setAll.
  function withPathname() {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", request.nextUrl.pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = withPathname();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = withPathname();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and getUser — it would
  // intermittently refresh the session and log the user out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicRoute(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
