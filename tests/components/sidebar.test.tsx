import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/sidebar";

test("assistant role does not see Users, Activity, or Settings links", () => {
  render(<Sidebar role="assistant" pathname="/" />);
  expect(screen.queryByText("Users")).toBeNull();
  expect(screen.queryByText("Activity")).toBeNull();
  expect(screen.queryByText("Settings")).toBeNull();
});

test("owner role sees Users, Activity, and Settings links", () => {
  render(<Sidebar role="owner" pathname="/" />);
  expect(screen.getByText("Users")).toBeInTheDocument();
  expect(screen.getByText("Activity")).toBeInTheDocument();
  expect(screen.getByText("Settings")).toBeInTheDocument();
});

test("the link matching the current path is visually marked active", () => {
  render(<Sidebar role="owner" pathname="/items" />);
  expect(screen.getByText("Items").className.split(" ")).toContain("bg-brand-green-light");
  expect(screen.getByText("Dashboard").className.split(" ")).not.toContain("bg-brand-green-light");
});

// On a shared shop computer, no sign-out means the owner logs in once and
// the assistant operates as the owner for the rest of the day — seeing
// cost, Activity and Settings and defeating the whole role model. Both
// roles must be able to end the session.
test("both roles see a sign out control", () => {
  const { unmount } = render(<Sidebar role="owner" pathname="/" />);
  expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  unmount();

  render(<Sidebar role="assistant" pathname="/" />);
  expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
});
