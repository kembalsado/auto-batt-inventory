"use client";

import { useLinkStatus } from "next/link";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * Swaps its `children` for a spinner while the enclosing `<Link>`'s
 * navigation is in flight. Must be rendered as a descendant of a
 * `next/link` `<Link>` — `useLinkStatus()` reads that Link's own pending
 * state, not a global one, so each nav control (prev/next arrows,
 * Day/Month/Year tabs) gets independent feedback without any shared state
 * to wire up.
 *
 * Takes the icon as already-rendered `children` (a React element, e.g.
 * `<ChevronLeft />`), not a component reference (`icon: ChevronLeft`) —
 * a component function isn't serializable across the Server/Client
 * boundary ("Functions cannot be passed directly to Client Components"),
 * while a Server Component rendering a child element and handing it to a
 * Client Component as `children` is the standard, supported pattern.
 *
 * Exists because this page's view/date navigation is plain `<Link>`s with
 * no client JS (matching Calendar's own convention) — clicking one changes
 * only the URL's query params on the same route, which Next.js treats as
 * a soft update to the already-mounted page rather than a fresh navigation.
 * That means the route's `loading.tsx` skeleton (which only covers a cold
 * navigation into /reports, e.g. from the sidebar) never fires for it, and
 * without this, clicking a tab or an arrow looks like nothing happened
 * until the new data arrives. This is the minimal fix: feedback on the
 * control you actually clicked, not a full-page skeleton swap.
 */
export function PendingIcon({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className={`${className ?? ""} animate-spin`} aria-hidden="true" />
  ) : (
    children
  );
}

/** Same idea as `PendingIcon`, for a text label (the Day/Month/Year tabs):
 * appends a small spinner next to the label while that tab's navigation is
 * in flight, rather than replacing the label outright — the tab stays
 * readable the whole time. */
export function PendingLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      {pending && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
    </span>
  );
}

/**
 * Submit button for the plain GET `<form>` date pickers below the tabs.
 * `useLinkStatus` only tracks `<Link>` navigations, not form submissions —
 * `useFormStatus` (react-dom) is its form-submission equivalent, and
 * likewise only works as a descendant of the `<form>` it's reporting on.
 */
export function PendingSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Go to date"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-green text-white hover:bg-brand-green-light disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <span className="text-sm font-bold">Go</span>
      )}
    </button>
  );
}
