import { render, screen, fireEvent, act } from "@testing-library/react";
import { ItemsTable } from "@/app/(dashboard)/items/items-table";
import type { StockListRow } from "@/lib/stock-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const rows: StockListRow[] = [
  { id: "1", sku: "B", name: "Charlie Battery", category: "Cat", qtyOnHand: 5, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—", vehicleSearchText: "" },
  { id: "2", sku: "A", name: "Alice Battery", category: "Cat", qtyOnHand: 20, unit: "pcs", isLowStock: false, isActive: true, vehicle: "—", vehicleSearchText: "" },
  { id: "3", sku: "C", name: "Bob Battery", category: "Cat", qtyOnHand: 1, unit: "pcs", isLowStock: true, isActive: true, vehicle: "—", vehicleSearchText: "" },
];

function nameColumn() {
  return screen.getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
}

test("defaults to Name ascending, matching today's query order", () => {
  render(<ItemsTable rows={rows} />);
  const names = nameColumn();
  expect(names[0]).toContain("Alice");
  expect(names[2]).toContain("Charlie");
});

test("clicking Qty on hand sorts ascending, clicking again sorts descending", () => {
  render(<ItemsTable rows={rows} />);
  fireEvent.click(screen.getByRole("button", { name: /qty on hand/i }));
  expect(nameColumn()[0]).toContain("Bob"); // qty 1
  fireEvent.click(screen.getByRole("button", { name: /qty on hand/i }));
  expect(nameColumn()[0]).toContain("Alice"); // qty 20
});

test("search filtering waits for the debounce delay, and dims the table meanwhile", () => {
  vi.useFakeTimers();
  render(<ItemsTable rows={rows} />);
  fireEvent.change(screen.getByLabelText(/search items/i), { target: { value: "alice" } });
  expect(nameColumn()).toHaveLength(3); // not filtered yet
  expect(screen.getByRole("table")).toHaveClass("opacity-60");
  act(() => vi.advanceTimersByTime(200));
  expect(nameColumn()).toHaveLength(1);
  expect(screen.getByRole("table")).not.toHaveClass("opacity-60");
  vi.useRealTimers();
});

test("search matches a vehicle tag that isn't the one displayed", () => {
  vi.useFakeTimers();
  const rowsWithHiddenTag = [
    ...rows,
    { id: "4", sku: "D", name: "Hidden Tag Item", category: "Cat", qtyOnHand: 1, unit: "pcs", isLowStock: false, isActive: true, vehicle: "Toyota Wigo +1", vehicleSearchText: "Toyota Wigo Nissan Terra 2018–2021" },
  ];
  render(<ItemsTable rows={rowsWithHiddenTag} />);
  fireEvent.change(screen.getByLabelText(/search items/i), { target: { value: "Terra" } });
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getAllByText("Hidden Tag Item")).toHaveLength(2);
  vi.useRealTimers();
});
