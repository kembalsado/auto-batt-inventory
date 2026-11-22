import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { MovementsList, type MovementRow } from "@/app/(dashboard)/items/[id]/movements-list";

const movements: MovementRow[] = [
  { id: "1", type: "IN", quantity: 5, movementDate: "2026-01-01", note: null, voidedAt: null, createdAt: "2026-01-01T08:00:00Z" },
  { id: "2", type: "OUT", quantity: 2, movementDate: "2026-01-01", note: null, voidedAt: null, createdAt: "2026-01-01T14:00:00Z" },
];

function rowAmounts() {
  return screen.getAllByRole("row").slice(1).map((row) => {
    const cells = within(row).getAllByRole("cell");
    return { in: cells[1].textContent ?? "", out: cells[2].textContent ?? "" };
  });
}

test("defaults to Date descending, keeping same-day rows in reverse time order", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  // id 2 (OUT, qty 2, created 14:00) is newer than id 1 (IN, qty 5, created 08:00) on the same movement_date.
  expect(rowAmounts()[0]).toEqual({ in: "", out: "2" });
  expect(rowAmounts()[1]).toEqual({ in: "5", out: "" });
});

test("toggling Date to ascending reverses same-day rows by time, not arbitrarily", () => {
  render(<MovementsList movements={movements} voidAction={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^date$/i }));
  expect(rowAmounts()[0]).toEqual({ in: "5", out: "" });
  expect(rowAmounts()[1]).toEqual({ in: "", out: "2" });
});

test("a voided row shows its quantity struck through in the populated column, and the other column stays blank", () => {
  const voidedMovements: MovementRow[] = [
    {
      id: "3",
      type: "IN",
      quantity: 7,
      movementDate: "2026-02-01",
      note: null,
      voidedAt: "2026-02-02T00:00:00Z",
      createdAt: "2026-02-01T08:00:00Z",
    },
  ];
  render(<MovementsList movements={voidedMovements} voidAction={vi.fn()} />);
  const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
  expect(cells[1]).toHaveTextContent("7");
  expect(cells[1].className).toContain("line-through");
  expect(cells[2]).toHaveTextContent("");
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
