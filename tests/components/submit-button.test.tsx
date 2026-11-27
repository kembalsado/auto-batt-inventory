import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SubmitButton } from "@/components/submit-button";

test("renders its children and is enabled when the form is idle", () => {
  render(
    <form action={() => Promise.resolve()}>
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
    </form>
  );

  expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
});

test("disables the button and shows the pending label while the form action is in flight, then returns to idle", async () => {
  let resolveAction: () => void;
  const action = () =>
    new Promise<void>((resolve) => {
      resolveAction = resolve;
    });

  render(
    <form action={action}>
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
    </form>
  );

  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  const pendingButton = await screen.findByRole("button", { name: "Saving…" });
  expect(pendingButton).toBeDisabled();

  resolveAction!();

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});
