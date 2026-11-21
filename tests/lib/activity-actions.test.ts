import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS } from "@/lib/activity";

/**
 * Guard against the gap `ACTIONS` (lib/activity.ts) has now had three
 * times: a `lib/*.ts` function starts calling `recordAudit` with a new
 * `action` value, and nobody remembers to add it to the Activity page's
 * filter dropdown. See the comments above "item.updated", "user.created",
 * "category.updated"/"category.deleted" and "car_make.updated"/
 * "car_make.deleted" in lib/activity.ts for the history.
 *
 * This scans every `lib/*.ts` file for `action: ...` sites and pulls out
 * every quoted, dotted action-literal it finds there (plain strings like
 * `"category.created"`, and both arms of a ternary like
 * `isActive ? "user.activated" : "user.deactivated"`), then asserts each
 * one is listed in `ACTIONS`. It does not check the reverse — an `ACTIONS`
 * entry with no matching literal here is fine, since some actions
 * (`movement.created`/`movement.voided`) are written by SQL functions in
 * supabase/migrations/, not by any lib/*.ts call site.
 *
 * Deliberately a regex scan, not a TS parser: this only needs to catch
 * "a new action literal exists and ACTIONS doesn't know about it", not
 * understand TypeScript in general.
 */
function findActionLiteralsInLibFiles(): Map<string, string[]> {
  const libDir = join(process.cwd(), "lib");
  const files = readdirSync(libDir).filter((f) => f.endsWith(".ts"));

  // Matches the right-hand side of an `action: ...` property up to the
  // next comma or newline — covers both `action: "foo.bar",` and
  // `action: cond ? "foo.bar" : "baz.qux",`.
  const actionSiteRegex = /action:\s*([^,\n]+)/g;
  // Pulls every quoted, dotted literal (e.g. "category.updated") out of
  // an `action:` site's right-hand side.
  const literalRegex = /["']([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)["']/g;

  const foundByFile = new Map<string, string[]>();

  for (const file of files) {
    const contents = readFileSync(join(libDir, file), "utf-8");
    const literals = new Set<string>();

    for (const siteMatch of contents.matchAll(actionSiteRegex)) {
      const rhs = siteMatch[1];
      for (const literalMatch of rhs.matchAll(literalRegex)) {
        literals.add(literalMatch[1]);
      }
    }

    if (literals.size > 0) {
      foundByFile.set(file, [...literals]);
    }
  }

  return foundByFile;
}

test("every action literal written by lib/*.ts is listed in lib/activity.ts's ACTIONS", () => {
  const foundByFile = findActionLiteralsInLibFiles();

  // Sanity-check the scan itself actually found something, so a regex
  // typo that silently matches nothing doesn't make this test vacuously
  // pass.
  const allFound = [...foundByFile.values()].flat();
  expect(allFound.length).toBeGreaterThan(0);

  const missing: string[] = [];
  for (const [file, actions] of foundByFile) {
    for (const action of actions) {
      if (!ACTIONS.includes(action)) {
        missing.push(`${action} (lib/${file})`);
      }
    }
  }

  expect(missing).toEqual([]);
});
