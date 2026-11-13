import { vi } from "vitest";

// Mock Resend entirely — no real network call is ever made from this test
// file, per this task's explicit instruction (no Resend account exists
// yet). `vi.mock` factories are hoisted above imports by Vitest's
// transform, so this takes effect before app/api/cron/daily-email/route.ts
// (imported below) does its own `import { Resend } from "resend"`.
const sendMock = vi.fn().mockResolvedValue({ data: { id: "mock-email-id" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createItem } from "@/lib/items";
import { recordStockIn } from "@/lib/movements";
import { getSettings, updateSettings, type AppSettings } from "@/lib/settings";
import { randomUUID } from "node:crypto";
import { GET } from "@/app/api/cron/daily-email/route";
import { manilaToday } from "@/lib/date";

// The exact same "today" the route uses — now genuinely imported from
// lib/date.ts rather than re-implemented here. It used to be duplicated
// (the route computed it inline and exported nothing), which is the same
// duplication that let the stock forms and the import drift to UTC.

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/daily-email", { headers });
}

const PASSWORD = "test-password-123";
const runId = randomUUID().slice(0, 8);

let OWNER_ID: string;
let categoryId: string;
let itemId: string;
const createdItemIds: string[] = [];
let originalSettings: AppSettings;
let originalResendApiKey: string | undefined;
let originalCronSecret: string | undefined;

beforeAll(async () => {
  originalResendApiKey = process.env.RESEND_API_KEY;
  originalCronSecret = process.env.CRON_SECRET;

  const admin = createAdminClient();
  originalSettings = await getSettings(admin);

  const { data: owner } = await admin.auth.admin.createUser({
    email: `test-cron-email-owner-${runId}@example.com`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role: "owner" },
  });
  OWNER_ID = owner!.user!.id;

  const category = await createCategory(admin, OWNER_ID, `Batteries-CRON-${runId}`);
  categoryId = category.id;

  const item = await createItem(admin, OWNER_ID, {
    sku: `AB-CRON-${runId}-001`,
    name: "12V Battery",
    categoryId,
    unit: "pcs",
  });
  itemId = item.id;
  createdItemIds.push(itemId);
});

afterEach(() => {
  sendMock.mockClear();
  // Restore both to their pre-test state after every test — several
  // tests below flip one or both to exercise a specific branch.
  if (originalResendApiKey === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = originalResendApiKey;
  }
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

afterAll(async () => {
  const admin = createAdminClient();

  await updateSettings(admin, OWNER_ID, originalSettings);

  const { data: batches } = await admin
    .from("batches")
    .select("id")
    .in("item_id", createdItemIds);
  const batchIds = (batches ?? []).map((b) => b.id);

  const { data: movements } = await admin
    .from("stock_movements")
    .select("id")
    .in("item_id", createdItemIds);
  const movementIds = (movements ?? []).map((m) => m.id);

  if (movementIds.length) {
    await admin.from("movement_allocations").delete().in("movement_id", movementIds);
  }
  await admin.from("stock_movements").delete().in("item_id", createdItemIds);
  if (batchIds.length) {
    await admin.from("batches").delete().in("id", batchIds);
  }
  await admin.from("items").delete().in("id", createdItemIds);
  await admin.from("categories").delete().eq("id", categoryId);
  await admin.from("audit_log").delete().eq("actor_id", OWNER_ID);
  await admin.from("profiles").delete().eq("id", OWNER_ID);
  await admin.auth.admin.deleteUser(OWNER_ID);
});

test("returns sent:false and never constructs Resend when RESEND_API_KEY is unset, even with activity", async () => {
  delete process.env.RESEND_API_KEY;

  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { notificationEmails: ["owner@example.com"] });
  await recordStockIn(admin, OWNER_ID, {
    itemId,
    qty: 10,
    unitCost: 1000,
    batchDate: manilaToday(),
  });

  const res = await GET(makeRequest());

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ sent: false, reason: "no-api-key" });
  expect(sendMock).not.toHaveBeenCalled();
});

test("sends via the (mocked) Resend client when there is activity, a configured recipient, and an API key", async () => {
  process.env.RESEND_API_KEY = "test-fake-key";

  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { notificationEmails: ["owner@example.com"] });
  await recordStockIn(admin, OWNER_ID, {
    itemId,
    qty: 5,
    unitCost: 1000,
    batchDate: manilaToday(),
  });

  const res = await GET(makeRequest());

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ sent: true });

  expect(sendMock).toHaveBeenCalledTimes(1);
  const call = sendMock.mock.calls[0][0];
  expect(call.to).toEqual(["owner@example.com"]);
  expect(call.html).toContain("12V Battery");
  expect(call.text).toContain("12V Battery");
});

test("returns sent:false without calling Resend when there are no recipients configured", async () => {
  process.env.RESEND_API_KEY = "test-fake-key";

  const admin = createAdminClient();
  await updateSettings(admin, OWNER_ID, { notificationEmails: [] });
  await recordStockIn(admin, OWNER_ID, {
    itemId,
    qty: 3,
    unitCost: 1000,
    batchDate: manilaToday(),
  });

  const res = await GET(makeRequest());

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ sent: false, reason: "no-recipients" });
  expect(sendMock).not.toHaveBeenCalled();
});

test("rejects a request with the wrong bearer token when CRON_SECRET is set", async () => {
  process.env.CRON_SECRET = "the-real-secret";

  const res = await GET(makeRequest({ authorization: "Bearer wrong" }));

  expect(res.status).toBe(401);
  expect(sendMock).not.toHaveBeenCalled();
});

test("accepts a request with the correct bearer token when CRON_SECRET is set", async () => {
  process.env.CRON_SECRET = "the-real-secret";
  delete process.env.RESEND_API_KEY;

  const res = await GET(makeRequest({ authorization: "Bearer the-real-secret" }));

  // Not rejected for auth — falls through to the normal data-gathering
  // path (whatever branch that lands on, 401 must not be it).
  expect(res.status).not.toBe(401);
});

test("skips the CRON_SECRET check entirely when it is unset (local manual triggering)", async () => {
  delete process.env.CRON_SECRET;
  delete process.env.RESEND_API_KEY;

  const res = await GET(makeRequest());

  expect(res.status).not.toBe(401);
});
