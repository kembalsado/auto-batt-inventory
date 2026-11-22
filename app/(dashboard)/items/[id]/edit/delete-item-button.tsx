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

    const res = await fetch(`/api/items/${itemId}`, {
      method: "DELETE",
      redirect: "manual",
    });

    // middleware.ts redirects an unauthenticated request to /login before
    // the route handler's own 401 check ever runs (see app/api/items/
    // [id]/route.ts and tests/api/items.test.ts's documented reasoning).
    // With fetch's default redirect:"follow" that redirect resolves to a
    // 200 (the /login page itself), so `res.ok` would read as success and
    // this component would navigate away as if the item were deleted.
    // redirect:"manual" turns it into an opaque "opaqueredirect" response
    // instead, caught here before the generic !res.ok branch below.
    if (res.type === "opaqueredirect") {
      setError("Your session expired. Sign in again and retry.");
      setPending(false);
      return;
    }

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
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
