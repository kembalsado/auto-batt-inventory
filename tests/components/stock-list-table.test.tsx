import { render, screen, fireEvent, act } from "@testing-library/react";
import { StockListTable } from "@/app/(dashboard)/stock-list/stock-list-table";
import type { StockListRow } from "@/lib/stock-list";

const rows: StockListRow[] = [
  { id: "1", sku: "B", name: "Charlie", category: "Cat", qtyOnHand: 5, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—", vehicleSearchText: "", unitCost: 100, inventoryValue: 500 },
  { id: "2", sku: "A", name: "Alice", category: "Cat", qtyOnHand: 20, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—", vehicleSearchText: "" },
];

test("defaults to Name ascending", () => {
  render(<StockListTable rows={rows} showCost />);
  const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
  expect(names[0]).toContain("Alice");
});

test("clicking Inventory value does not crash on a row with no cost", () => {
  render(<StockListTable rows={rows} showCost />);
  fireEvent.click(screen.getByRole("button", { name: /inventory value/i }));
  expect(screen.getAllByRole("row")).toHaveLength(3);
});

test("search debounces before re-filtering", () => {
  vi.useFakeTimers();
  render(<StockListTable rows={rows} showCost={false} />);
  fireEvent.change(screen.getByLabelText(/search stock list/i), { target: { value: "alice" } });
  expect(screen.getAllByRole("row")).toHaveLength(3);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  vi.useRealTimers();
});

test("search matches a vehicle tag that isn't the one displayed", () => {
  vi.useFakeTimers();
  const rowsWithHiddenTag = [
    ...rows,
    { id: "4", sku: "D", name: "Hidden Tag Item", category: "Cat", qtyOnHand: 1, unit: "pcs", isLowStock: false, isActive: true, vehicle: "Toyota Wigo +1", vehicleSearchText: "Toyota Wigo Nissan Terra 2018–2021" },
  ];
  render(<StockListTable rows={rowsWithHiddenTag} showCost={false} />);
  fireEvent.change(screen.getByLabelText(/search stock list/i), { target: { value: "Terra" } });
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByText("Hidden Tag Item")).toHaveLength(2);
  vi.useRealTimers();
});
