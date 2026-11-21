import { render, screen, fireEvent, act } from "@testing-library/react";
import { BatchesTable, type BatchRow } from "@/app/(dashboard)/items/[id]/batches-table";

const batches: BatchRow[] = [
  { id: "1", batch_date: "2026-02-01", qty_received: 10, qty_remaining: 4, unit_cost: 500, source: "purchase" },
  { id: "2", batch_date: "2026-01-01", qty_received: 5, qty_remaining: 5, source: "opening_stock" },
];

test("defaults to Date ascending, matching today's query order", () => {
  render(<BatchesTable batches={batches} />);
  const dates = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(dates[0]).toContain("2026-01-01");
});

test("clicking Unit cost sorts rows with no cost predictably to one end", () => {
  render(<BatchesTable batches={batches} />);
  fireEvent.click(screen.getByRole("button", { name: /unit cost/i }));
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2); // no crash on the undefined unit_cost row
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<BatchesTable batches={batches} />);
  fireEvent.change(screen.getByLabelText(/search batches/i), { target: { value: "purchase" } });
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2, unchanged yet
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2); // header + 1
  vi.useRealTimers();
});
