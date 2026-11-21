"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface LookupListItem {
  id: string;
  name: string;
}

/**
 * Shared rename+delete list for simple owner-managed lookup tables
 * (Makes, Categories). Non-owners see the same plain `divide-y` name
 * list these pages already render; owners get an Edit/Delete action
 * per row, following app/(dashboard)/users/users-table.tsx's
 * `pendingId`/`errorById` pattern (one pending row at a time, inline
 * server error text, `router.refresh()` on success) rather than
 * inventing a new interaction pattern for this pair of pages.
 */
export function LookupListTable({
  items,
  apiBasePath,
  noun,
  isOwner,
  emptyLabel,
}: {
  items: LookupListItem[];
  apiBasePath: string;
  noun: string;
  isOwner: boolean;
  emptyLabel: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  function startEditing(item: LookupListItem) {
    setEditingId(item.id);
    setDraftName(item.name);
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  }

  function cancelEditing() {
    setEditingId(null);
    setDraftName("");
  }

  async function saveEdit(item: LookupListItem) {
    const trimmed = draftName.trim();
    if (!trimmed) return;

    setPendingId(item.id);
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    const res = await fetch(`${apiBasePath}/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorById((prev) => ({
        ...prev,
        [item.id]: body.error ?? `Failed to rename ${noun}.`,
      }));
      setPendingId(null);
      return;
    }

    setPendingId(null);
    setEditingId(null);
    router.refresh();
  }

  async function deleteItem(item: LookupListItem) {
    const confirmed = window.confirm(
      `Delete ${noun} "${item.name}"? This can't be undone.`
    );
    if (!confirmed) return;

    setPendingId(item.id);
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    const res = await fetch(`${apiBasePath}/${item.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorById((prev) => ({
        ...prev,
        [item.id]: body.error ?? `Failed to delete ${noun}.`,
      }));
      setPendingId(null);
      return;
    }

    setPendingId(null);
    router.refresh();
  }

  return (
    <ul className="mt-6 divide-y divide-border">
      {items.map((item) => {
        const isEditing = editingId === item.id;
        const isPending = pendingId === item.id;
        return (
          <li key={item.id} className="py-2 text-sm text-brand-ink">
            <div className="flex items-center justify-between gap-2">
              {isEditing ? (
                <>
                  <Input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    className="h-8 max-w-xs"
                    autoFocus
                  />
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!draftName.trim() || isPending}
                      onClick={() => saveEdit(item)}
                    >
                      {isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={cancelEditing}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <span>{item.name}</span>
                  {isOwner && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => startEditing(item)}
                      >
                        <Pencil aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={isPending}
                        onClick={() => deleteItem(item)}
                      >
                        {isPending ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
            {errorById[item.id] && (
              <p className="mt-1 text-xs text-destructive">{errorById[item.id]}</p>
            )}
          </li>
        );
      })}
      {items.length === 0 && (
        <li className="py-2 text-sm text-muted-foreground">{emptyLabel}</li>
      )}
    </ul>
  );
}
