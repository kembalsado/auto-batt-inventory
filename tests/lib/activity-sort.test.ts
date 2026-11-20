import { actorLabel, sortAuditLog, buildActivitySortHref, type AuditLogEntry } from "@/lib/activity";

const names = new Map([["u1", "Alice"], ["u2", null]]);

test("actorLabel returns the profile's name when known", () => {
  expect(actorLabel("u1", names)).toBe("Alice");
});

test("actorLabel falls back to System for a null actor", () => {
  expect(actorLabel(null, names)).toBe("System");
});

test("actorLabel falls back to a truncated id for an unknown/unnamed actor", () => {
  expect(actorLabel("u2", names)).toBe("Unknown (u2)");
  expect(actorLabel("u-not-in-map", names)).toBe("Unknown (u-not-in)");
});

const entries: AuditLogEntry[] = [
  { id: "1", actorId: "u1", action: "item.created", entityType: "item", entityId: "x", summary: "B", details: null, createdAt: "2026-01-02T00:00:00Z" },
  { id: "2", actorId: "u2", action: "category.created", entityType: "category", entityId: "y", summary: "A", details: null, createdAt: "2026-01-01T00:00:00Z" },
];

test("sortAuditLog sorts by date ascending without mutating the input", () => {
  const sorted = sortAuditLog(entries, names, "date", "asc");
  expect(sorted.map((e) => e.id)).toEqual(["2", "1"]);
  expect(entries.map((e) => e.id)).toEqual(["1", "2"]);
});

test("sortAuditLog sorts by user using the resolved display name, not actorId", () => {
  // Input order is [u2 (actorLabel "Unknown (u2)"), u1 ("Alice")] — the
  // reverse of ascending-by-name order, so this only passes if the
  // comparator actually resolved and compared the display names.
  const reversed = [entries[1], entries[0]];
  const sorted = sortAuditLog(reversed, names, "user", "asc");
  expect(sorted.map((e) => e.id)).toEqual(["1", "2"]); // "Alice" before "Unknown (u2)"
});

test("sortAuditLog sorts by summary ascending", () => {
  // entries is [{id: "1", summary: "B"}, {id: "2", summary: "A"}] — already
  // the reverse of ascending order, so this only passes on a real sort.
  const sorted = sortAuditLog(entries, names, "summary", "asc");
  expect(sorted.map((e) => e.id)).toEqual(["2", "1"]); // "A" before "B"
});

test("buildActivitySortHref defaults to date desc, switches a clicked column to ascending", () => {
  expect(buildActivitySortHref({}, "user")).toBe("/activity?sort=user&dir=asc");
});

test("buildActivitySortHref flips direction when the column is already active", () => {
  expect(buildActivitySortHref({ sort: "user", dir: "asc" }, "user")).toBe(
    "/activity?sort=user&dir=desc"
  );
});

test("buildActivitySortHref preserves existing filters", () => {
  const href = buildActivitySortHref({ itemId: "item-1", q: "battery" }, "action");
  expect(href).toContain("itemId=item-1");
  expect(href).toContain("q=battery");
  expect(href).toContain("sort=action");
  expect(href).toContain("dir=asc");
});
