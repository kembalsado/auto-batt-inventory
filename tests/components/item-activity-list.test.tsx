import { render, screen } from "@testing-library/react";
import { ItemActivityList } from "@/app/(dashboard)/reports/item-activity-list";
import type { ItemActivity } from "@/lib/reports";

const baseItem: ItemActivity = {
  itemId: "item-1",
  sku: "SKU-1",
  name: "Amaron N50",
  vehicle: "Toyota Vios 2020",
  unit: "pcs",
  movements: [
    {
      movementId: "mv-1",
      type: "IN",
      occurredAt: "2026-11-19T20:02:00Z", // 4:02 AM Manila
      quantity: 20,
      cost: 45000,
    },
  ],
};

test("renders each item's name, sku, vehicle, movement time, qty, and formatted cost", () => {
  render(<ItemActivityList items={[baseItem]} />);
  expect(screen.getByText("Amaron N50")).toBeInTheDocument();
  expect(screen.getByText("SKU-1")).toBeInTheDocument();
  expect(screen.getByText("Toyota Vios 2020")).toBeInTheDocument();
  expect(screen.getByText("4:02 AM")).toBeInTheDocument();
  expect(screen.getByText("+20")).toBeInTheDocument();
  expect(screen.getByText("45,000.00")).toBeInTheDocument();
});

test("renders an IN and a later OUT movement on the same item in chronological order", () => {
  const item: ItemActivity = {
    ...baseItem,
    movements: [
      { movementId: "mv-1", type: "IN", occurredAt: "2026-11-19T20:02:00Z", quantity: 20, cost: 45000 },
      { movementId: "mv-2", type: "OUT", occurredAt: "2026-11-19T21:02:00Z", quantity: 3, cost: 6750 },
    ],
  };
  render(<ItemActivityList items={[item]} />);

  const times = screen.getAllByText(/^\d{1,2}:\d{2} (AM|PM)$/).map((el) => el.textContent);
  expect(times).toEqual(["4:02 AM", "5:02 AM"]);
  expect(screen.getByText("+20")).toBeInTheDocument();
  expect(screen.getByText("45,000.00")).toBeInTheDocument();
  expect(screen.getByText("−3")).toBeInTheDocument();
  expect(screen.getByText("6,750.00")).toBeInTheDocument();
});

test("an OUT movement's quantity and cost render with the gold/warn styling, not the IN green", () => {
  const item: ItemActivity = {
    ...baseItem,
    movements: [{ movementId: "mv-2", type: "OUT", occurredAt: "2026-11-19T21:02:00Z", quantity: 3, cost: 6750 }],
  };
  render(<ItemActivityList items={[item]} />);
  expect(screen.getByText("−3").className).toContain("text-brand-gold-dark");
  expect(screen.getByText("6,750.00").className).toContain("text-brand-gold-dark");
});

test("shows an empty state when there are no items", () => {
  render(<ItemActivityList items={[]} />);
  expect(screen.getByText("No activity this day.")).toBeInTheDocument();
});
