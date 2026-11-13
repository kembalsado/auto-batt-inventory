import { createServerClient } from "@/lib/supabase/server";
import { getRole, canSeeCost } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { buildStockListRows, type StockListRow } from "@/lib/stock-list";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

// @react-pdf/renderer's renderToBuffer is Node-only (it shells out to
// pdfkit, which needs Node's fs/stream APIs), so this route must run on
// the Node.js runtime, not the Edge runtime — already true by default for
// a Route Handler, so there's nothing to opt into here. (An explicit
// `export const runtime = "nodejs"` would otherwise seem like the more
// self-documenting choice, but next.config.ts's `cacheComponents: true`
// rejects that route segment config outright — "not compatible with
// `nextConfig.cacheComponents`" — so the default has to speak for itself,
// documented here instead.)

// .tsx (not the brief's literal .ts) because @react-pdf/renderer's
// Document/Page/View/Text tree reads far better as JSX than as nested
// React.createElement calls; Next.js treats a route.tsx file identically
// to route.ts for routing purposes, so this doesn't change the route's
// behavior, only how its document tree is written.

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
  brand: { fontSize: 10, marginBottom: 2, color: "#019342" },
  title: { fontSize: 16, marginBottom: 16, color: "#201a1a" },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#201a1a",
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 4,
  },
  headerCell: { flex: 1, fontFamily: "Helvetica-Bold" },
  headerCellRight: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  cell: { flex: 1 },
  cellRight: { flex: 1, textAlign: "right" },
});

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The PDF document tree for the stock list. `showCost` gates the Unit
 * cost / Inventory value columns entirely (not just blanking their
 * values) so a hidden viewer's PDF never renders those headers either.
 */
function StockListDocument({
  rows,
  showCost,
}: {
  rows: StockListRow[];
  showCost: boolean;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>Auto Batt</Text>
        <Text style={styles.title}>Stock List</Text>

        <View style={styles.headerRow}>
          <Text style={styles.headerCell}>SKU</Text>
          <Text style={styles.headerCell}>Name</Text>
          <Text style={styles.headerCell}>Category</Text>
          <Text style={styles.headerCellRight}>Qty on hand</Text>
          <Text style={styles.headerCell}>Unit</Text>
          {showCost && <Text style={styles.headerCellRight}>Unit cost</Text>}
          {showCost && (
            <Text style={styles.headerCellRight}>Inventory value</Text>
          )}
        </View>

        {rows.map((row) => (
          <View style={styles.row} key={row.sku}>
            <Text style={styles.cell}>{row.sku}</Text>
            <Text style={styles.cell}>{row.name}</Text>
            <Text style={styles.cell}>{row.category}</Text>
            <Text style={styles.cellRight}>{String(row.qtyOnHand)}</Text>
            <Text style={styles.cell}>{row.unit}</Text>
            {showCost && (
              <Text style={styles.cellRight}>
                {row.unitCost !== undefined ? formatCurrency(row.unitCost) : ""}
              </Text>
            )}
            {showCost && (
              <Text style={styles.cellRight}>
                {row.inventoryValue !== undefined
                  ? formatCurrency(row.inventoryValue)
                  : ""}
              </Text>
            )}
          </View>
        ))}
      </Page>
    </Document>
  );
}

/**
 * GET /api/stock-list/pdf — renders the same rows the stock list page
 * shows (via the shared `buildStockListRows`, lib/stock-list.ts) into a
 * PDF and returns it as `application/pdf`. Cost gating is re-derived
 * here from the requesting session's own role + the current settings
 * (not trusted from a client-supplied flag), so this route can't be made
 * to leak cost by a crafted request any more than the page can.
 */
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase.from("profiles").select("role").eq("id", user.id).single()
      ).data
    : null;
  const role = getRole(profile);

  const [rows, settings] = await Promise.all([
    buildStockListRows(supabase, role),
    getSettings(supabase),
  ]);
  const showCost = canSeeCost(role, settings);

  const buffer = await renderToBuffer(
    <StockListDocument rows={rows} showCost={showCost} />
  );

  // Response's BodyInit type doesn't recognize Node's Buffer (it's
  // structurally a Uint8Array but TS's DOM lib types don't know that) —
  // wrap it so this type-checks without losing the actual bytes.
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="stock-list.pdf"',
    },
  });
}
