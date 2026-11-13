"use client";

import { useState, type FormEvent } from "react";

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
        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Full name
          <input
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Temporary password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Role
          <select
            value={role}
            onChange={(event) =>
              setRole(event.target.value === "owner" ? "owner" : "assistant")
            }
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="assistant">Assistant</option>
            <option value="owner">Owner</option>
          </select>
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-brand-green">User created.</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Add user"}
        </button>
      </form>
    </div>
  );
}
