import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/sidebar";

test("assistant role does not see Users, Activity, or Settings links", () => {
  render(<Sidebar role="assistant" />);
  expect(screen.queryByText("Users")).toBeNull();
  expect(screen.queryByText("Activity")).toBeNull();
  expect(screen.queryByText("Settings")).toBeNull();
});

test("owner role sees Users, Activity, and Settings links", () => {
  render(<Sidebar role="owner" />);
  expect(screen.getByText("Users")).toBeInTheDocument();
  expect(screen.getByText("Activity")).toBeInTheDocument();
  expect(screen.getByText("Settings")).toBeInTheDocument();
});
