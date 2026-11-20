import { render, screen, fireEvent, act } from "@testing-library/react";
import { MovementsList, type MovementRow } from "@/app/(dashboard)/items/[id]/movements-list";

const movements: MovementRow[] = [
  { id: "1", type: "IN", quantity: 5, movementDate: "2026-01-01", note: null, voidedAt: null, createdAt: "2026-01-01T08:00:00Z" },
  { id: "2", type: "OUT", quantity: 2, movementDate: "2026-01-01", note: null, voidedAt: null, createdAt: "2026-01-01T14:00:00Z" },
];

function typeColumn() {
  return screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
}

test("defaults to Date descending, keeping same-day rows in reverse time order", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  // id 2 (created 14:00) is newer than id 1 (created 08:00) on the same movement_date.
  expect(typeColumn()[0]).toContain("OUT");
  expect(typeColumn()[1]).toContain("IN");
});

test("toggling Date to ascending reverses same-day rows by time, not arbitrarily", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^date$/i }));
  expect(typeColumn()[0]).toContain("IN");
  expect(typeColumn()[1]).toContain("OUT");
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/search movement history/i), {
    target: { value: "out" },
  });
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2, unchanged yet
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2); // header + 1
  vi.useRealTimers();
});
