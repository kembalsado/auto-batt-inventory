"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Owner-only "Add user" screen (gated by `isOwnerOnlyRoute` in the
 * dashboard layout, not re-checked here — see app/(dashboard)/activity and
 * app/(dashboard)/settings for the same convention). Posts straight to
 * `POST /api/users` (app/api/users/route.ts), which is the layer that
 * actually enforces "owner only" for this action.
 *
 * Deliberately just a create form — no user list/edit/delete UI. The plan
 * only asks for the ability to add a user; see Task 15's brief.
 */
export default function AddUserPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"assistant" | "owner">("assistant");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, fullName, role }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to create user.");
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setEmail("");
    setPassword("");
    setFullName("");
    setRole("assistant");
    setSubmitting(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Add user</h1>

      <form
        onSubmit={handleSubmit}
        className="mt-6 flex max-w-md flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Temporary password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            value={role}
            onChange={(event) =>
              setRole(event.target.value === "owner" ? "owner" : "assistant")
            }
            className="h-11 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="assistant">Assistant</option>
            <option value="owner">Owner</option>
          </select>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-brand-green">User created.</p>
        )}

        <Button type="submit" size="touch" disabled={submitting} className="mt-2">
          {submitting ? "Creating…" : "Add user"}
        </Button>
      </form>
    </div>
  );
}
