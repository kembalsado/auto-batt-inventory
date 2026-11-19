import { render, screen } from "@testing-library/react";
import { ItemActivityList } from "@/app/(dashboard)/reports/item-activity-list";
import type { ItemActivity } from "@/lib/reports";

const baseItem: ItemActivity = {
  itemId: "item-1",
  sku: "SKU-1",
  name: "Amaron N50",
  vehicle: "Toyota Vios 2020",
  unit: "pcs",
  qtyIn: 20,
  qtyOut: 0,
  costIn: 45000,
  costOut: 0,
};

test("renders each item's name, sku, vehicle, qty, and formatted cost", () => {
  render(<ItemActivityList items={[baseItem]} />);
  expect(screen.getByText("Amaron N50")).toBeInTheDocument();
  expect(screen.getByText("SKU-1")).toBeInTheDocument();
  expect(screen.getByText("Toyota Vios 2020")).toBeInTheDocument();
  expect(screen.getByText("+20")).toBeInTheDocument();
  expect(screen.getByText("45,000.00")).toBeInTheDocument();
});

test("shows only the OUT pill/cost when qtyIn is 0", () => {
  render(<ItemActivityList items={[{ ...baseItem, qtyIn: 0, costIn: 0, qtyOut: 3, costOut: 6000 }]} />);
  expect(screen.queryByText("+0")).toBeNull();
  expect(screen.getByText("−3")).toBeInTheDocument();
  expect(screen.getByText("6,000.00")).toBeInTheDocument();
});

test("shows an empty state when there are no items", () => {
  render(<ItemActivityList items={[]} />);
  expect(screen.getByText("No activity this day.")).toBeInTheDocument();
});
