"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SortButtonHeader } from "@/components/sortable-header";
import { useSortableData } from "@/lib/use-sortable-data";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { UserListItem } from "@/lib/users";

// Stable accessors object (module scope: none of these close over props or
// state) so `useSortableData`'s internal useMemo doesn't recompute the sort
// on every render — see Task 1's review note.
//
// The "￿" fallback for a null fullName sorts a blank-name row AFTER every
// real name ascending (and before them descending), rather than first
// ascending — a fresh owner-only user list can plausibly have a no-name row
// and it shouldn't dominate the top of the default view.
const sortAccessors: Record<
  "name" | "email" | "role" | "status",
  (row: UserListItem) => string | number
> = {
  name: (row) => row.fullName ?? "￿",
  email: (row) => row.email,
  role: (row) => row.role,
  status: (row) => (row.isActive ? 1 : 0),
};

/**
 * The owner-only user list, with a Deactivate/Reactivate action per row.
 * "Deactivate" bans the account via Supabase Auth rather than deleting
 * it — see lib/users.ts's `setUserActive` docstring for why a real
 * delete isn't safe here (profiles/audit_log foreign keys, plus losing
 * the name on that user's own historical audit rows). Mirrors the
 * "Inactive" badge convention already used for items
 * (app/(dashboard)/items/page.tsx) rather than inventing a new one.
 *
 * `router.refresh()` after a successful toggle re-runs page.tsx's
 * server-side `listUsers` call so the row's status updates without a
 * full reload, the same pattern AddUserForm uses after creating one.
 */
export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserListItem[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const isSearchPending = query !== debouncedQuery;

  const filteredUsers = useMemo(() => {
    const normalized = debouncedQuery.trim().toLowerCase();
    if (!normalized) return users;
    return users.filter(
      (u) =>
        (u.fullName ?? "").toLowerCase().includes(normalized) ||
        u.email.toLowerCase().includes(normalized) ||
        u.role.toLowerCase().includes(normalized)
    );
  }, [users, debouncedQuery]);

  const { sorted, direction, sortKey, toggle } = useSortableData<
    UserListItem,
    keyof typeof sortAccessors
  >(filteredUsers, {
    accessors: sortAccessors,
    defaultKey: "name",
  });

  async function toggleActive(targetUser: UserListItem) {
    const nextIsActive = !targetUser.isActive;
    const verb = nextIsActive ? "Reactivate" : "Deactivate";
    const name = targetUser.fullName || targetUser.email;

    const confirmed = window.confirm(
      nextIsActive
        ? `Reactivate ${name}? They'll be able to sign in again right away.`
        : `Deactivate ${name}? They won't be able to sign in until reactivated — this doesn't remove their name from past activity.`
    );
    if (!confirmed) return;

    setPendingId(targetUser.id);
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[targetUser.id];
      return next;
    });

    const res = await fetch(`/api/users/${targetUser.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: nextIsActive }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorById((prev) => ({
        ...prev,
        [targetUser.id]: body.error ?? `Failed to ${verb.toLowerCase()} user.`,
      }));
      setPendingId(null);
      return;
    }

    setPendingId(null);
    router.refresh();
  }

  return (
    <div className="mt-10">
      <h2 className="text-lg font-medium text-brand-ink">All users</h2>

      <div className="relative mt-4 max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, email, or role"
          aria-label="Search users"
          className="h-11 pl-8"
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table
          className={`w-full min-w-[640px] text-left text-sm${
            isSearchPending ? " opacity-60 transition-opacity" : ""
          }`}
        >
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <SortButtonHeader
                label="Name"
                thClassName="py-2 font-medium"
                direction={sortKey === "name" ? direction : "none"}
                onClick={() => toggle("name")}
              />
              <SortButtonHeader
                label="Email"
                thClassName="py-2 font-medium"
                direction={sortKey === "email" ? direction : "none"}
                onClick={() => toggle("email")}
              />
              <SortButtonHeader
                label="Role"
                thClassName="py-2 font-medium"
                direction={sortKey === "role" ? direction : "none"}
                onClick={() => toggle("role")}
              />
              <SortButtonHeader
                label="Status"
                thClassName="py-2 font-medium"
                direction={sortKey === "status" ? direction : "none"}
                onClick={() => toggle("status")}
              />
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((u) => {
              const isSelf = u.id === currentUserId;
              const isPending = pendingId === u.id;
              return (
                <tr key={u.id} className="text-brand-ink transition-colors hover:bg-muted/40">
                  <td className="py-2">
                    {u.fullName || <span className="text-muted-foreground">—</span>}
                    {isSelf && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                    )}
                  </td>
                  <td className="py-2">{u.email}</td>
                  <td className="py-2 capitalize">{u.role}</td>
                  <td className="py-2">
                    {!u.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </td>
                  <td className="py-2 text-right">
                    {isSelf ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Button
                        type="button"
                        variant={u.isActive ? "outline" : "default"}
                        size="sm"
                        disabled={isPending}
                        onClick={() => toggleActive(u)}
                      >
                        {isPending
                          ? "Working…"
                          : u.isActive
                            ? "Deactivate"
                            : "Reactivate"}
                      </Button>
                    )}
                    {errorById[u.id] && (
                      <p className="mt-1 text-xs text-destructive">{errorById[u.id]}</p>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-sm text-muted-foreground">
                  {users.length === 0 ? "No users yet." : "No users match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
