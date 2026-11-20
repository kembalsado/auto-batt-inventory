import { render, screen, fireEvent } from "@testing-library/react";
import { ReportTable, type ReportTableRow } from "@/app/(dashboard)/reports/report-table";

// Mimics Month view: labels are day-of-month strings, already in
// chronological (index) order, where "10" would sort before "2" as text.
const rows: ReportTableRow[] = [
  { label: "2", purchases: 100, stockOutValue: 0 },
  { label: "10", purchases: 50, stockOutValue: 0 },
];

function labelColumn() {
  return screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
}

test("defaults to today's chronological order (index), not sorted by label text", () => {
  render(<ReportTable rows={rows} labelHeader="Day" />);
  expect(labelColumn()[0]).toContain("2");
  expect(labelColumn()[1]).toContain("10");
});

test("toggling the label header reverses chronological order, not string order", () => {
  render(<ReportTable rows={rows} labelHeader="Day" />);
  fireEvent.click(screen.getByRole("button", { name: /^day$/i }));
  expect(labelColumn()[0]).toContain("10");
  expect(labelColumn()[1]).toContain("2");
});

test("clicking Purchases sorts by purchase amount", () => {
  render(<ReportTable rows={rows} labelHeader="Day" />);
  fireEvent.click(screen.getByRole("button", { name: /purchases/i }));
  expect(labelColumn()[0]).toContain("10"); // purchases: 50
});
