import { render, screen, fireEvent, act } from "@testing-library/react";
import { UsersTable } from "@/app/(dashboard)/users/users-table";
import type { UserListItem } from "@/lib/users";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const users: UserListItem[] = [
  { id: "1", email: "charlie@example.com", fullName: "Charlie", role: "assistant", isActive: true, createdAt: "2026-01-01" },
  { id: "2", email: "alice@example.com", fullName: "Alice", role: "owner", isActive: true, createdAt: "2026-01-02" },
  { id: "3", email: "nameless@example.com", fullName: null, role: "assistant", isActive: false, createdAt: "2026-01-03" },
];

test("defaults to Name ascending (no prior order to preserve, per design)", () => {
  render(<UsersTable users={users} currentUserId="1" />);
  const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(names[0]).toContain("Alice");
});

test("clicking Email sorts ascending by email", () => {
  render(<UsersTable users={users} currentUserId="1" />);
  fireEvent.click(screen.getByRole("button", { name: /email/i }));
  const emails = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(emails[0]).toContain("alice@example.com");
});

test("a null fullName does not crash Name sorting", () => {
  render(<UsersTable users={users} currentUserId="1" />);
  expect(screen.getAllByRole("row")).toHaveLength(4);
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<UsersTable users={users} currentUserId="1" />);
  fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: "alice" } });
  expect(screen.getAllByRole("row")).toHaveLength(4);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  vi.useRealTimers();
});
