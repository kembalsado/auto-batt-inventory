"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A `<Button type="submit">` for a Server Action `<form>` that disables
 * itself and shows a spinner + `pendingLabel` while that action is in
 * flight — same mechanism as `PendingSubmitButton`
 * (app/(dashboard)/reports/pending-indicators.tsx), generalized so every
 * Add/Save form's submit button can share it instead of having no pending
 * state at all. Must be rendered as a descendant of the `<form>` whose
 * submission it reports on — `useFormStatus` reads that form's own
 * pending state, not a global one.
 */
export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
      {pending ? pendingLabel : children}
    </Button>
  );
}
