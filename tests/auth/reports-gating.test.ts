import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBrowserClient } from "@/lib/supabase/client";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordStockIn } from "@/lib/movements";
import { getSettings, updateSettings, type AppSettings } from "@/lib/settings";

// This file exercises the real GET /reports route over HTTP (not by
// importing the page component directly), because the thing under test —
// the spec's anti-goal that an assistant must never be able to read cost
// through this page when show_cost_to_assistant is off — can only be
// proven end-to-end against the actual rendered response. Same documented
// pre-existing dependency on a live `next dev` server on localhost:3000 as
// tests/auth/route-protection.test.tsx and tests/api/users.test.ts.
const BASE_URL = "http://localhost:3000";

// Signs in via the real browser client so @supabase/ssr writes an actual
// session cookie to `document.cookie` (vitest's jsdom environment defaults
// its origin to http://localhost:3000, matching the dev server above), then
// hands back the Cookie header to replay with plain `fetch` — the same
// technique tests/api/users.test.ts uses.
async function signInCookieHeader(
  email: string,
  password: string
): Promise<string> {
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return document.cookie;
}

const PASSWORD = "test-password-123";

// app_settings is a single GLOBAL row shared by the whole database — see
// tests/lib/cost-visibility.test.ts's own note on this. This file flips
// show_cost_to_assistant, so it saves the pre-existing value and restores
// it in afterAll.
let originalSettings: AppSettings;

let OWNER_ID: string;
let ASSISTANT_ID: string;
let ASSISTANT_EMAIL: string;
let ownerEmail: string;
let today: string;
const createdItemIds: string[] = [];
const createdCategoryIds: string[] = [];

// The distinctive unit cost seeded below — chosen to be unmistakable (not
// a value any other UI chrome, id, or formatting could plausibly produce)
// so finding its formatted form anywhere in the response body is a real
// positive, not a coincidence.
const SEEDED_UNIT_COST = 12345;

describe("GET /reports — assistant cost gating (Finding 2 regression)", () => {
  beforeAll(async () => {
    const admin = createAdminClient();
    originalSettings = await getSettings(admin);

    const runId = randomUUID().slice(0, 8);
    ownerEmail = `test-reports-gating-owner-${runId}@example.com`;
    ASSISTANT_EMAIL = `test-reports-gating-assistant-${runId}@example.com`;

    const { data: owner } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "owner" },
    });
    OWNER_ID = owner!.user!.id;

    const { data: assistant } = await admin.auth.admin.createUser({
      email: ASSISTANT_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "assistant" },
    });
    ASSISTANT_ID = assistant!.user!.id;

    // Cost hidden from assistants — the condition the anti-goal is about.
    await updateSettings(admin, OWNER_ID, { showCostToAssistant: false });

    const category = await createCategory(admin, OWNER_ID, `Reports-Gating-${runId}`);
    createdCategoryIds.push(category.id);
    const item = await createItem(admin, OWNER_ID, {
      sku: `RPT-GATE-${runId}`,
      name: "Reports Gating Test Item",
      categoryId: category.id,
      unit: "pcs",
    });
    createdItemIds.push(item.id);

    // Today's date, so this purchase lands inside the Month view the page
    // renders by default (no ?view=/&date=/&year=/&month= query params).
    today = new Date().toISOString().slice(0, 10);
    await recordStockIn(admin, OWNER_ID, {
      itemId: item.id,
      qty: 1,
      unitCost: SEEDED_UNIT_COST,
      batchDate: today,
    });
  });

  afterAll(async () => {
    const admin = createAdminClient();
    await updateSettings(admin, OWNER_ID, originalSettings);

    const { data: batchRows } = await admin
      .from("batches")
      .select("id")
      .in("item_id", createdItemIds);
    const batchIds = (batchRows ?? []).map((b) => b.id);

    if (batchIds.length > 0) {
      await admin.from("movement_allocations").delete().in("batch_id", batchIds);
    }
    await admin.from("stock_movements").delete().in("item_id", createdItemIds);
    await admin.from("batches").delete().in("item_id", createdItemIds);
    await admin.from("audit_log").delete().in("actor_id", [OWNER_ID, ASSISTANT_ID]);
    await admin.from("items").delete().in("id", createdItemIds);
    await admin.from("categories").delete().in("id", createdCategoryIds);
    await admin.from("profiles").delete().in("id", [OWNER_ID, ASSISTANT_ID]);
    await admin.auth.admin.deleteUser(OWNER_ID);
    await admin.auth.admin.deleteUser(ASSISTANT_ID);
  });

  test("an assistant with cost hidden sees the gated message and never the seeded cost anywhere in the page body", async () => {
    const cookie = await signInCookieHeader(ASSISTANT_EMAIL, PASSWORD);

    const res = await fetch(`${BASE_URL}/reports`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);

    const body = await res.text();

    expect(body).toContain(
      "Ask the owner to turn on cost visibility in Settings to see this page."
    );

    // Both halves matter: the gate message alone isn't proof the cost
    // itself never rendered. Check every plausible formatting of the
    // seeded cost (formatCurrency renders "12,345.00"; a raw/unformatted
    // leak would still contain the bare digits).
    expect(body).not.toContain("12345");
    expect(body).not.toContain("12,345.00");
  });

  test("an owner sees the per-item list on Day view, with cost", async () => {
    const cookie = await signInCookieHeader(ownerEmail, PASSWORD);
    const res = await fetch(`${BASE_URL}/reports?view=day&date=${today}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Reports Gating Test Item");
    expect(body).toContain("12,345.00");
  });

  test("an assistant with cost hidden never sees the per-item list's cost on Day view", async () => {
    const cookie = await signInCookieHeader(ASSISTANT_EMAIL, PASSWORD);
    const res = await fetch(`${BASE_URL}/reports?view=day&date=${today}`, {
      headers: { Cookie: cookie },
    });
    const body = await res.text();
    expect(body).toContain(
      "Ask the owner to turn on cost visibility in Settings to see this page."
    );
    expect(body).not.toContain("12345");
    expect(body).not.toContain("12,345.00");
  });

  test("an assistant with cost hidden never sees the per-item list's cost in the Month-view modal", async () => {
    const cookie = await signInCookieHeader(ASSISTANT_EMAIL, PASSWORD);
    const [year, month] = today.split("-");
    const res = await fetch(
      `${BASE_URL}/reports?view=month&year=${year}&month=${Number(month)}&date=${today}`,
      { headers: { Cookie: cookie } }
    );
    const body = await res.text();
    expect(body).toContain(
      "Ask the owner to turn on cost visibility in Settings to see this page."
    );
    expect(body).not.toContain("12345");
    expect(body).not.toContain("12,345.00");
  });

  test("an owner can click a Month-view day to see that day's per-item list", async () => {
    const cookie = await signInCookieHeader(ownerEmail, PASSWORD);
    const [year, month] = today.split("-");
    const res = await fetch(
      `${BASE_URL}/reports?view=month&year=${year}&month=${Number(month)}&date=${today}`,
      { headers: { Cookie: cookie } }
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Reports Gating Test Item");
    expect(body).toContain("12,345.00");
  });

  test("a Month-view day with zero cost (opening stock) is still a clickable link", async () => {
    // Opening-stock import: zero Purchases-tile cost, but a real movement —
    // the day's table-row link must still be present and reachable.
    const openingStockDate = today;
    const { data: batch } = await createAdminClient()
      .from("batches")
      .insert({
        item_id: createdItemIds[0],
        batch_date: openingStockDate,
        qty_received: 1,
        qty_remaining: 1,
        unit_cost: 1,
        source: "opening_stock",
        created_by: OWNER_ID,
      })
      .select("id")
      .single();
    await createAdminClient().from("stock_movements").insert({
      item_id: createdItemIds[0],
      type: "IN",
      quantity: 1,
      batch_id: batch!.id,
      movement_date: openingStockDate,
      created_by: OWNER_ID,
    });

    const cookie = await signInCookieHeader(ownerEmail, PASSWORD);
    const [year, month] = today.split("-");
    const monthRes = await fetch(
      `${BASE_URL}/reports?view=month&year=${year}&month=${Number(month)}`,
      { headers: { Cookie: cookie } }
    );
    const monthBody = await monthRes.text();
    expect(monthBody).toContain(`date=${openingStockDate}`);
  });
});
