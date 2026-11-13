import Link from "next/link";
import { isOwnerOnlyRoute, type Role } from "@/lib/permissions";

interface NavLink {
  href: string;
  label: string;
}

// Order matches the brief: shared links first, then owner-only links.
// Whether a link is owner-only is derived from isOwnerOnlyRoute rather
// than flagged per-entry, so the nav and the route guard can't drift.
const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/items", label: "Items" },
  { href: "/categories", label: "Categories" },
  { href: "/stock-list", label: "Stock List" },
  { href: "/users", label: "Users" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ role }: { role: Role }) {
  const links = NAV_LINKS.filter(
    (link) => role === "owner" || !isOwnerOnlyRoute(link.href)
  );

  return (
    <aside className="flex h-full w-56 flex-col gap-8 border-r border-border bg-sidebar px-4 py-6 print:hidden">
      <div className="px-2">
        <span className="text-lg font-bold tracking-tight text-brand-ink">
          Auto<span className="text-brand-green">Batt</span>
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
