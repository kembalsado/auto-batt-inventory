import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SignOutButton } from "@/components/sign-out-button";

vi.mock("@/lib/actions/sign-out", () => ({
  signOutAction: vi.fn(),
}));

test("renders a Sign out button that is enabled when idle", () => {
  render(<SignOutButton />);
  expect(screen.getByRole("button", { name: "Sign out" })).not.toBeDisabled();
});

test("disables the button and shows a pending label while the sign-out action is in flight", async () => {
  const { signOutAction } = await import("@/lib/actions/sign-out");
  let resolveAction: () => void;
  vi.mocked(signOutAction).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      })
  );

  render(<SignOutButton />);

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  const pendingButton = await screen.findByRole("button", { name: "Signing out…" });
  expect(pendingButton).toBeDisabled();

  resolveAction!();

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Sign out" })).not.toBeDisabled();
  });
});
