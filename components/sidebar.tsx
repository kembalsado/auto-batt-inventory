"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { isOwnerOnlyRoute, type Role } from "@/lib/permissions";
import { SignOutButton } from "@/components/sign-out-button";

interface NavLink {
  href: string;
  label: string;
}

// Order matches the brief: shared links first, then owner-only links.
// Whether a link is owner-only is derived from isOwnerOnlyRoute rather
// than flagged per-entry, so the nav and the route guard can't drift.
const SHARED_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/items", label: "Items" },
  { href: "/categories", label: "Categories" },
  { href: "/stock-list", label: "Stock List" },
  { href: "/calendar", label: "Calendar" },
  { href: "/import", label: "Import" },
];

const OWNER_LINKS: NavLink[] = [
  { href: "/users", label: "Users" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavItem({
  link,
  pathname,
  onNavigate,
}: {
  link: NavLink;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isActive(pathname, link.href);
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      className={
        active
          ? "rounded-md bg-brand-green-light px-3 py-2 text-sm font-semibold text-white"
          : "rounded-md px-3 py-2 text-sm font-medium text-white/85 transition-colors hover:bg-brand-green-light/60 hover:text-white"
      }
    >
      {link.label}
    </Link>
  );
}

/**
 * Nav content shared by the always-visible desktop sidebar and the
 * mobile slide-in drawer — identical links, identical active-state
 * logic, just rendered inside a different shell by `Sidebar` below.
 * `onNavigate` closes the mobile drawer on link click; the desktop
 * sidebar passes a no-op since it's never collapsed.
 */
function NavContent({
  role,
  pathname,
  onNavigate,
}: {
  role: Role;
  pathname: string;
  onNavigate: () => void;
}) {
  const ownerLinks = OWNER_LINKS.filter(
    (link) => role === "owner" || !isOwnerOnlyRoute(link.href)
  );

  return (
    <>
      <div className="px-2">
        <Image
          src="/logo.png"
          alt="Auto Batt"
          width={480}
          height={480}
          priority
          className="h-10 w-10 rounded-md"
        />
      </div>
      <nav className="flex flex-col gap-1">
        {SHARED_LINKS.map((link) => (
          <NavItem
            key={link.href}
            link={link}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
        {ownerLinks.length > 0 && (
          <>
            <div className="mt-4 mb-1 px-3 text-[10px] font-semibold tracking-wider text-white/55 uppercase">
              Owner only
            </div>
            {ownerLinks.map((link) => (
              <NavItem
                key={link.href}
                link={link}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </nav>
      {/*
        Sign out lives at the bottom of the sidebar, separated from the
        nav links, and is shown to BOTH roles — this is a shared shop
        computer, and the owner needs to hand it back to the assistant
        without leaving their own session (cost data, Activity, Settings)
        open.
      */}
      <div className="mt-auto flex flex-col">
        <SignOutButton />
      </div>
    </>
  );
}

/**
 * Below `md`, the sidebar collapses into a fixed top bar with a hamburger
 * button; tapping it slides in the same nav as an overlay drawer over the
 * page content, with a tap-outside backdrop to dismiss. At `md` and up,
 * the drawer markup is simply never shown (`md:hidden` on the top bar and
 * the drawer) and the original always-visible `<aside>` takes over
 * (`hidden md:flex`) — same two code paths, same `NavContent`, so there's
 * only one place the link list and active-state logic can drift.
 */
export function Sidebar({ role, pathname }: { role: Role; pathname: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center gap-3 bg-brand-green px-4 py-3 md:hidden print:hidden">
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 flex-col items-center justify-center gap-1.5 rounded-md hover:bg-brand-green-light/60"
        >
          <span className="h-0.5 w-5 rounded bg-white" />
          <span className="h-0.5 w-5 rounded bg-white" />
          <span className="h-0.5 w-5 rounded bg-white" />
        </button>
        <Image
          src="/logo.png"
          alt="Auto Batt"
          width={480}
          height={480}
          className="h-8 w-8 rounded-md"
        />
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={close}
            aria-hidden="true"
          />
          <aside className="relative flex h-full w-72 max-w-[80%] flex-col gap-6 bg-brand-green px-4 py-6 shadow-xl">
            <NavContent role={role} pathname={pathname} onNavigate={close} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      {/* No h-full here: this aside is a child of the content row's default
          (align-items: normal/stretch) flexbox, which already stretches it
          to match <main>'s height. Pairing h-full (height: 100%) with that
          same stretched, flex-grow-derived parent height caused the
          percentage to resolve against a stale/indefinite size and come up
          short (verified live: 567px of actual vs. 733px available) —
          stretch alone fills the row exactly, with no percentage involved. */}
      <aside className="hidden w-56 flex-col gap-6 bg-brand-green px-4 py-6 md:flex print:hidden">
        <NavContent role={role} pathname={pathname} onNavigate={() => {}} />
      </aside>
    </>
  );
}
