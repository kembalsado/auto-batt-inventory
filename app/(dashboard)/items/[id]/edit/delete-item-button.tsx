"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DeleteItemButton({
  itemId,
  sku,
  name,
}: {
  itemId: string;
  sku: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmed = window.confirm(`Delete ${sku} — ${name}? This can't be undone.`);
    if (!confirmed) return;

    setPending(true);
    setError(null);

    const res = await fetch(`/api/items/${itemId}`, { method: "DELETE" });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to delete item.");
      setPending(false);
      return;
    }

    router.push("/items");
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={handleDelete}
      >
        {pending ? "Deleting…" : "Delete item"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
