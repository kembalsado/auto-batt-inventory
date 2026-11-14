"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UserListItem } from "@/lib/users";

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

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => {
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
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-sm text-muted-foreground">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
