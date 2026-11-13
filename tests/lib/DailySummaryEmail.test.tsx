import { render } from "@react-email/render";
import { DailySummaryEmail } from "@/lib/email/DailySummaryEmail";

test("renders item names and IN/OUT quantities for today's activity", async () => {
  const html = await render(
    DailySummaryEmail({
      date: "2026-11-12",
      itemsWithActivity: [
        { itemId: "i1", sku: "AB-001", name: "12V Battery", unit: "pcs", qtyIn: 10, qtyOut: 2 },
      ],
      lowStockItems: [],
    })
  );

  expect(html).toContain("12V Battery");
  expect(html).toContain("AB-001");
  expect(html).toContain("10");
  expect(html).toContain("2");
});

test("renders a low-stock warning section with qty on hand and threshold", async () => {
  const html = await render(
    DailySummaryEmail({
      date: "2026-11-12",
      itemsWithActivity: [],
      lowStockItems: [
        { itemId: "i2", sku: "AB-002", name: "6V Battery", unit: "pcs", qtyOnHand: 1, threshold: 3 },
      ],
    })
  );

  expect(html).toContain("6V Battery");
  expect(html).toContain("Low stock");
  expect(html).toContain("1");
  expect(html).toContain("3");
});

test("never renders cost, price, or profit figures (explicit project non-goal)", async () => {
  const html = await render(
    DailySummaryEmail({
      date: "2026-11-12",
      itemsWithActivity: [
        { itemId: "i1", sku: "AB-001", name: "12V Battery", unit: "pcs", qtyIn: 10, qtyOut: 2 },
      ],
      lowStockItems: [
        { itemId: "i2", sku: "AB-002", name: "6V Battery", unit: "pcs", qtyOnHand: 1, threshold: 3 },
      ],
    })
  );

  // "cost"/"margin" alone would false-positive on CSS like "margin-top" —
  // this template has no cost-bearing props at all (DailySummaryEmailProps
  // carries no unitCost/inventoryValue field), so the sturdier check is
  // that no currency figure or the word "profit" ever appears.
  expect(html.toLowerCase()).not.toContain("profit");
  expect(html).not.toContain("₱");
});

test("renders 'nothing to report' copy for each section when its list is empty, without throwing", async () => {
  const html = await render(
    DailySummaryEmail({ date: "2026-11-12", itemsWithActivity: [], lowStockItems: [] })
  );

  expect(html).toContain("No stock movements recorded today.");
  expect(html).toContain("No items are currently low on stock.");
});
