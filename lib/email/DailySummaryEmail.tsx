import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { DailySummaryItemActivity, DailySummaryLowStockItem } from "@/lib/email/dailySummary";

/** Props for `DailySummaryEmail` — the same shape `buildDailySummary` returns, minus `hasActivity` (the cron route decides whether to send at all; the template itself never needs that flag). */
export interface DailySummaryEmailProps {
  date: string;
  itemsWithActivity: DailySummaryItemActivity[];
  lowStockItems: DailySummaryLowStockItem[];
}

const cellStyle = { padding: "6px 8px", borderBottom: "1px solid #e5e7eb", fontSize: "14px" };
const headerCellStyle = {
  ...cellStyle,
  fontWeight: 700,
  borderBottom: "2px solid #111827",
  color: "#111827",
};

/**
 * The daily email body sent by the cron route (app/api/cron/daily-email/
 * route.ts) when `buildDailySummary` reports `hasActivity: true`.
 *
 * Two sections only, per the design doc: today's IN/OUT activity by item,
 * and items currently at or below their low-stock threshold. No cost, no
 * price, no profit/margin figure anywhere on this page — that's an
 * explicit project non-goal (the accountant computes P&L separately from
 * receipts), and this template has no `unitCost`/`inventoryValue` prop to
 * even accidentally render one.
 *
 * Either section can be empty (e.g. low stock with no activity today, or
 * activity with nothing currently low) — each renders its own "nothing to
 * report" line rather than an empty table, since the cron route only
 * decides whether to send at all, not whether each section has content.
 */
export function DailySummaryEmail({
  date,
  itemsWithActivity,
  lowStockItems,
}: DailySummaryEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Auto Batt daily summary for {date}</Preview>
      <Body style={{ backgroundColor: "#f3f4f6", fontFamily: "Helvetica, Arial, sans-serif" }}>
        <Container
          style={{
            backgroundColor: "#ffffff",
            margin: "0 auto",
            padding: "24px",
            maxWidth: "560px",
          }}
        >
          <Heading as="h1" style={{ fontSize: "20px", color: "#0f172a" }}>
            Auto Batt daily summary
          </Heading>
          <Text style={{ color: "#4b5563", fontSize: "14px" }}>{date}</Text>

          <Section style={{ marginTop: "24px" }}>
            <Heading as="h2" style={{ fontSize: "16px", color: "#0f172a" }}>
              Today&apos;s activity
            </Heading>
            {itemsWithActivity.length === 0 ? (
              <Text style={{ color: "#6b7280", fontSize: "14px" }}>
                No stock movements recorded today.
              </Text>
            ) : (
              <Section style={{ width: "100%" }}>
                <Row>
                  <Column style={headerCellStyle}>Item</Column>
                  <Column style={headerCellStyle}>Qty in</Column>
                  <Column style={headerCellStyle}>Qty out</Column>
                </Row>
                {itemsWithActivity.map((item) => (
                  <Row key={item.itemId}>
                    <Column style={cellStyle}>
                      {item.name} ({item.sku})
                    </Column>
                    <Column style={cellStyle}>
                      {item.qtyIn} {item.unit}
                    </Column>
                    <Column style={cellStyle}>
                      {item.qtyOut} {item.unit}
                    </Column>
                  </Row>
                ))}
              </Section>
            )}
          </Section>

          <Section style={{ marginTop: "24px" }}>
            <Heading as="h2" style={{ fontSize: "16px", color: "#991b1b" }}>
              Low stock
            </Heading>
            {lowStockItems.length === 0 ? (
              <Text style={{ color: "#6b7280", fontSize: "14px" }}>
                No items are currently low on stock.
              </Text>
            ) : (
              <Section style={{ width: "100%" }}>
                <Row>
                  <Column style={headerCellStyle}>Item</Column>
                  <Column style={headerCellStyle}>Qty on hand</Column>
                  <Column style={headerCellStyle}>Threshold</Column>
                </Row>
                {lowStockItems.map((item) => (
                  <Row key={item.itemId}>
                    <Column style={cellStyle}>
                      {item.name} ({item.sku})
                    </Column>
                    <Column style={cellStyle}>
                      {item.qtyOnHand} {item.unit}
                    </Column>
                    <Column style={cellStyle}>
                      {item.threshold} {item.unit}
                    </Column>
                  </Row>
                ))}
              </Section>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default DailySummaryEmail;
