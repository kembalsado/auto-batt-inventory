import { createAdminClient } from "@/lib/supabase/admin";
import { createCategory } from "@/lib/categories";
import { createCarMake } from "@/lib/car-makes";
import { createItem } from "@/lib/items"; // CreateItemInput has no fitments field yet until Task 3 — create plain items here, write fitments only via replaceFitmentsForItem
import {
  formatFitment,
  summarizeFitments,
  parseFitmentsJson,
  listFitmentsForItem,
  listFitmentsForItems,
  replaceFitmentsForItem,
  listDistinctModelsAndVariants,
} from "@/lib/item-fitments";
import { randomUUID } from "node:crypto";

test("formatFitment joins only the parts that are set, with no stray spaces", () => {
  expect(formatFitment({ makeName: "Toyota", model: null, variant: null, yearFrom: null, yearTo: null })).toBe("Toyota");
  expect(formatFitment({ makeName: null, model: null, variant: null, yearFrom: null, yearTo: null })).toBe("—");
});

test("formatFitment renders a single-year fitment as one year, and a range with an en dash", () => {
  expect(formatFitment({ makeName: "Toyota", model: "Vios", variant: null, yearFrom: 2018, yearTo: 2018 })).toBe("Toyota Vios 2018");
  expect(formatFitment({ makeName: "Toyota", model: "Vios", variant: null, yearFrom: 2018, yearTo: 2022 })).toBe("Toyota Vios 2018–2022");
});

test("summarizeFitments returns an em dash and empty search text for zero fitments", () => {
  expect(summarizeFitments([])).toEqual({ display: "—", searchText: "" });
});

test("summarizeFitments shows the first (oldest) tag plus a count, but puts every tag in searchText", () => {
  const fitments = [
    { id: "a", itemId: "i", makeId: null, makeName: "Toyota", model: "Wigo", variant: null, yearFrom: null, yearTo: null, createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", itemId: "i", makeId: null, makeName: "Nissan", model: "Terra", variant: null, yearFrom: 2018, yearTo: 2021, createdAt: "2026-01-02T00:00:00Z" },
  ];
  const { display, searchText } = summarizeFitments(fitments);
  expect(display).toBe("Toyota Wigo +1");
  expect(searchText).toContain("Nissan Terra 2018–2021");
});

test("summarizeFitments shows the bare tag with no count when there's exactly one", () => {
  const fitments = [{ id: "a", itemId: "i", makeId: null, makeName: "Toyota", model: "Wigo", variant: null, yearFrom: null, yearTo: null, createdAt: "2026-01-01T00:00:00Z" }];
  expect(summarizeFitments(fitments).display).toBe("Toyota Wigo");
});

test("parseFitmentsJson returns [] for empty/invalid input and parses a valid array", () => {
  expect(parseFitmentsJson("")).toEqual([]);
  expect(parseFitmentsJson("not json")).toEqual([]);
  expect(parseFitmentsJson(JSON.stringify([{ makeId: "m1", model: "Vios", variant: null, yearFrom: 2020, yearTo: 2020 }])))
    .toEqual([{ id: undefined, makeId: "m1", model: "Vios", variant: null, yearFrom: 2020, yearTo: 2020 }]);
});

test("parseFitmentsJson coerces an out-of-range year to null, keeping the rest of the entry", () => {
  // The only gate on raw client-controlled JSON: a hand-crafted POST never
  // passes through the editor's min/max-bounded inputs.
  const nextYear = new Date().getFullYear() + 1;
  expect(parseFitmentsJson(JSON.stringify([{ model: "Vios", yearFrom: 1200, yearTo: 99999 }])))
    .toEqual([{ id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: null, yearTo: null }]);
  expect(parseFitmentsJson(JSON.stringify([{ model: "Vios", yearFrom: -2020, yearTo: -2020 }])))
    .toEqual([{ id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: null, yearTo: null }]);
  expect(parseFitmentsJson(JSON.stringify([{ model: "Vios", yearFrom: 2020.5, yearTo: 2020.5 }])))
    .toEqual([{ id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: null, yearTo: null }]);
  // The bounds themselves are inclusive and still accepted.
  expect(parseFitmentsJson(JSON.stringify([{ model: "Vios", yearFrom: 1900, yearTo: nextYear }])))
    .toEqual([{ id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: 1900, yearTo: nextYear }]);
});

test("parseFitmentsJson coerces an inverted year range to null on both sides", () => {
  // 2022–2018 would otherwise render as the nonsense "2022–2018"; which
  // side is the typo isn't knowable, so neither is kept.
  expect(parseFitmentsJson(JSON.stringify([{ model: "Vios", yearFrom: 2022, yearTo: 2018 }])))
    .toEqual([{ id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: null, yearTo: null }]);
  expect(parseFitmentsJson(JSON.stringify([{ model: "Vios", yearFrom: 2018, yearTo: 2022 }])))
    .toEqual([{ id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: 2018, yearTo: 2022 }]);
});

test("parseFitmentsJson drops an entry whose every field is empty", () => {
  // Mirrors the editor's "no blank tags" rule server-side. An entry that
  // is blank only because its out-of-range years were just nulled out is
  // dropped too.
  expect(parseFitmentsJson(JSON.stringify([{ makeId: null, model: "", variant: "   ", yearFrom: null, yearTo: null }])))
    .toEqual([]);
  expect(parseFitmentsJson(JSON.stringify([{}, { model: "Vios" }]))).toEqual([
    { id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: null, yearTo: null },
  ]);
  expect(parseFitmentsJson(JSON.stringify([{ yearFrom: 1200, yearTo: 1200 }]))).toEqual([]);
});

let ASSISTANT_ID: string;
let categoryId: string;
const createdItemIds: string[] = [];
const createdMakeIds: string[] = [];
const createdCategoryIds: string[] = [];
const runId = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = createAdminClient();
  const { data: assistant } = await admin.auth.admin.createUser({
    email: `test-item-fitments-${runId}@example.com`, password: "test-password-123", email_confirm: true, user_metadata: { role: "assistant" },
  });
  ASSISTANT_ID = assistant!.user!.id;
  const category = await createCategory(admin, ASSISTANT_ID, `Fitments-${runId}`);
  createdCategoryIds.push(category.id);
  categoryId = category.id;
});

afterAll(async () => {
  const admin = createAdminClient();
  await admin.from("items").delete().in("id", createdItemIds); // cascades item_fitments
  await admin.from("car_makes").delete().in("id", createdMakeIds);
  await admin.from("categories").delete().in("id", createdCategoryIds);
  await admin.from("audit_log").delete().eq("actor_id", ASSISTANT_ID);
  await admin.from("profiles").delete().eq("id", ASSISTANT_ID);
  await admin.auth.admin.deleteUser(ASSISTANT_ID);
});

async function newItem(sku: string) {
  const admin = createAdminClient();
  const item = await createItem(admin, ASSISTANT_ID, { sku, name: "x", categoryId, unit: "pcs" });
  createdItemIds.push(item.id);
  return item;
}

test("listFitmentsForItem returns an item's fitments oldest-first, with the make name joined", async () => {
  const admin = createAdminClient();
  const make = await createCarMake(admin, ASSISTANT_ID, `Fitments-Make-${runId}`);
  createdMakeIds.push(make.id);
  const item = await newItem(`FIT-ORDER-${runId}`);
  await admin.from("item_fitments").insert({ item_id: item.id, model: "Wigo", created_at: "2026-01-01T00:00:00Z" });
  await admin.from("item_fitments").insert({ item_id: item.id, make_id: make.id, model: "Terra", created_at: "2026-01-02T00:00:00Z" });

  const fitments = await listFitmentsForItem(admin, item.id);
  expect(fitments.map((f) => f.model)).toEqual(["Wigo", "Terra"]);
  expect(fitments[1].makeName).toBe(make.name);
});

test("listFitmentsForItems bulk-fetches fitments for multiple items in one call, keyed by item id", async () => {
  const admin = createAdminClient();
  const itemA = await newItem(`FIT-BULK-A-${runId}`);
  const itemB = await newItem(`FIT-BULK-B-${runId}`);
  await replaceFitmentsForItem(admin, itemA.id, [{ makeId: null, model: "Wigo", variant: null, yearFrom: null, yearTo: null }]);
  await replaceFitmentsForItem(admin, itemB.id, [{ makeId: null, model: "Terra", variant: null, yearFrom: null, yearTo: null }]);

  const byItem = await listFitmentsForItems(admin, [itemA.id, itemB.id]);
  expect(byItem.get(itemA.id)?.map((f) => f.model)).toEqual(["Wigo"]);
  expect(byItem.get(itemB.id)?.map((f) => f.model)).toEqual(["Terra"]);
});

test("listFitmentsForItems chunks a long id list and merges every chunk's rows, still grouped per item", async () => {
  // Exercises the CHUNK_SIZE (150) path in lib/item-fitments.ts without
  // creating 150+ real items: the id list is padded with random
  // non-existent UUIDs so that the real items land in *different* chunks
  // (index 0 and index 170). Before chunking existed this query went out
  // as one `.in("item_id", [...])` with 200 UUIDs — long enough to risk
  // the HTTP 414 lib/reports.ts measured at ~216 — and a merge bug across
  // chunks would show up here as a missing item or missing fitments.
  const admin = createAdminClient();
  const first = await newItem(`FIT-CHUNK-A-${runId}`);
  const second = await newItem(`FIT-CHUNK-B-${runId}`);
  await replaceFitmentsForItem(admin, first.id, [
    { makeId: null, model: "Chunk-Wigo", variant: null, yearFrom: null, yearTo: null },
    { makeId: null, model: "Chunk-Vios", variant: null, yearFrom: 2018, yearTo: 2021 },
  ]);
  await replaceFitmentsForItem(admin, second.id, [
    { makeId: null, model: "Chunk-Terra", variant: null, yearFrom: null, yearTo: null },
  ]);

  const padded: string[] = Array.from({ length: 200 }, () => randomUUID());
  padded[0] = first.id;
  padded[170] = second.id;

  const byItem = await listFitmentsForItems(admin, padded);
  expect(byItem.get(first.id)?.map((f) => f.model)).toEqual(["Chunk-Wigo", "Chunk-Vios"]);
  expect(byItem.get(second.id)?.map((f) => f.model)).toEqual(["Chunk-Terra"]);
  // Only the two real items get an entry; the 198 filler ids contribute none.
  expect(byItem.size).toBe(2);
});

test("replaceFitmentsForItem inserts every fitment when the item has none yet", async () => {
  const admin = createAdminClient();
  const item = await newItem(`FIT-INSERT-${runId}`);
  const result = await replaceFitmentsForItem(admin, item.id, [
    { makeId: null, model: "Wigo", variant: null, yearFrom: null, yearTo: null },
    { makeId: null, model: "Terra", variant: null, yearFrom: 2018, yearTo: 2021 },
  ]);
  expect(result).toHaveLength(2);
});

test("replaceFitmentsForItem inserting 2+ fitments in one call preserves input order as created_at order, not a random id tiebreak", async () => {
  // Regression test: a bulk insert of 2+ rows in one statement previously
  // gave every row the exact same now()-derived created_at, so
  // listFitmentsForItem's "created_at asc, id asc" order fell back on a
  // random UUID tiebreak — non-deterministic in practice. Repeating this
  // across many fresh items makes that ~50/50 coin flip reliably surface
  // as a failure before the fix (effectively guaranteed to fail at least
  // once across 20 runs) and reliably pass after it (strictly increasing
  // created_at values removed the tie entirely).
  const admin = createAdminClient();
  for (let i = 0; i < 20; i++) {
    const item = await newItem(`FIT-ORDER-RACE-${runId}-${i}`);
    await replaceFitmentsForItem(admin, item.id, [
      { makeId: null, model: "Wigo", variant: null, yearFrom: null, yearTo: null },
      { makeId: null, model: "Terra", variant: null, yearFrom: null, yearTo: null },
      { makeId: null, model: "Vios", variant: null, yearFrom: null, yearTo: null },
    ]);

    const fitments = await listFitmentsForItem(admin, item.id);
    expect(fitments.map((f) => f.model)).toEqual(["Wigo", "Terra", "Vios"]);
  }
});

test("replaceFitmentsForItem keeps an existing fitment's id and created_at when it's resubmitted with its id", async () => {
  const admin = createAdminClient();
  const item = await newItem(`FIT-KEEP-${runId}`);
  const [existing] = await replaceFitmentsForItem(admin, item.id, [{ makeId: null, model: "Wigo", variant: null, yearFrom: null, yearTo: null }]);

  const result = await replaceFitmentsForItem(admin, item.id, [{ id: existing.id, makeId: null, model: "Wigo", variant: null, yearFrom: null, yearTo: null }]);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(existing.id);
  expect(result[0].createdAt).toBe(existing.createdAt);
});

test("replaceFitmentsForItem deletes a fitment whose id is missing from the new list, and inserts any new ones", async () => {
  const admin = createAdminClient();
  const item = await newItem(`FIT-DIFF-${runId}`);
  const [a, b] = await replaceFitmentsForItem(admin, item.id, [
    { makeId: null, model: "A-Model", variant: null, yearFrom: null, yearTo: null },
    { makeId: null, model: "B-Model", variant: null, yearFrom: null, yearTo: null },
  ]);

  const result = await replaceFitmentsForItem(admin, item.id, [
    { id: a.id, makeId: null, model: "A-Model", variant: null, yearFrom: null, yearTo: null },
    { makeId: null, model: "C-Model", variant: null, yearFrom: null, yearTo: null },
  ]);

  expect(result.map((f) => f.model).sort()).toEqual(["A-Model", "C-Model"]);
  expect(result.find((f) => f.model === "A-Model")?.id).toBe(a.id);
  expect(result.some((f) => f.id === b.id)).toBe(false);
});

test("replaceFitmentsForItem with an empty array deletes every existing fitment for that item", async () => {
  const admin = createAdminClient();
  const item = await newItem(`FIT-CLEAR-${runId}`);
  await replaceFitmentsForItem(admin, item.id, [
    { makeId: null, model: "A-Model", variant: null, yearFrom: null, yearTo: null },
    { makeId: null, model: "B-Model", variant: null, yearFrom: null, yearTo: null },
  ]);

  const result = await replaceFitmentsForItem(admin, item.id, []);
  expect(result).toEqual([]);
});

test("listDistinctModelsAndVariants reads from item_fitments, not items", async () => {
  const item = await newItem(`FIT-DISTINCT-${runId}`);
  const admin = createAdminClient();
  await replaceFitmentsForItem(admin, item.id, [
    { makeId: null, model: `Fitments-Vios-${runId}`, variant: `Fitments-E-${runId}`, yearFrom: null, yearTo: null },
  ]);

  const { models, variants } = await listDistinctModelsAndVariants(admin);
  expect(models).toContain(`Fitments-Vios-${runId}`);
  expect(variants).toContain(`Fitments-E-${runId}`);
});
