# Delete item — design

## Intent

Let a user permanently remove an item from the Edit Item page, instead of
only being able to edit it.

## Why

Requested directly: "I want 'Delete Item' option inside the Edit item page."

## Goals

- A "Delete item" action on `/items/[id]/edit`.
- Deleting removes the `items` row entirely (not a soft-delete/deactivate).
- Deleting an item that already has stock history (any `batches` or
  `stock_movements` row) is blocked with a clear explanation, not silently
  allowed or silently turned into something else.

## Non-goals

- No "deactivate" / `is_active` toggle. That's a different, unapproved
  feature — out of scope here even though the schema already has the
  column (see Constraints).
- No bulk delete, no delete from the items list page — edit page only, as
  asked.

## Anti-goals

- Must never produce an unhandled 500 / Next.js crash page when deletion
  is blocked — that's exactly the bug this app's error-handling convention
  (`lib/errors.ts`) exists to avoid.
- Must never leave the items list or other item data looking inconsistent
  after a successful delete (stale cached row, dangling reference).

## Constraints

- `batches.item_id` and `stock_movements.item_id` both `references items
  (id)` with **no** `ON DELETE CASCADE` (`supabase/migrations/0001_init.sql`).
  So the database itself rejects deleting an item that has ever had stock
  in or out, with a foreign-key-violation (SQLSTATE `23503`).
- This exact situation already exists for `categories`/`car_makes` (an
  item referencing them blocks their delete the same way) and is already
  handled by `lib/errors.ts`'s `isForeignKeyViolation` plus a friendly 400
  in `app/api/categories/[id]/route.ts` / `app/api/makes/[id]/route.ts`.
- **Found during implementation:** `items` RLS (`supabase/migrations/
  0005_items_rls.sql`) deliberately shipped with no DELETE policy at all
  ("Delete isn't supported (YAGNI...)"). A signed-in user's delete via the
  session-bound server client therefore affected 0 rows regardless of
  application code — not an FK error. Fixed by `supabase/migrations/
  0020_items_delete_rls.sql`, which adds `items_delete_authenticated`
  (`to authenticated using (true)`), matching items' existing open
  select/insert/update policies rather than the owner-only shape used for
  categories/car_makes delete. The FK constraint above remains the real
  safety net for items with history, independent of this RLS policy.
  This feature follows that exact, already-reviewed pattern rather than
  inventing a new one.
- Item edit/update today has no owner-only gate (any signed-in user can
  edit any item) — delete follows the same permission model: signed-in
  only, no role check.

## Approaches considered

1. **Soft-delete via `is_active`** (deactivate, matching how users are
   "deleted"). Rejected: the user explicitly asked for a real delete, not
   a deactivate toggle, after being offered this option.
2. **Pre-check for existing batches/movements before attempting delete**
   (two extra `count` queries, then delete only if both are zero).
   Rejected: redundant — the database's FK constraint already enforces
   exactly this, atomically, with no race between the check and the
   delete. Categories/makes don't pre-check either.
3. **Attempt the delete; let the FK constraint block it; catch
   `isForeignKeyViolation` and return a friendly error** (chosen). Matches
   the existing categories/makes delete pattern exactly, no new helper
   needed beyond mirroring `deleteCategory`.

## Design

- `lib/items.ts`: `deleteItem(supabase, actorId, itemId): Promise<void>` —
  `.from("items").delete().eq("id", itemId).select().single()`, then
  `recordAudit({ action: "item.deleted", entityType: "item", entityId:
  itemId, summary: \`Deleted item ${data.sku}\` })`. Mirrors
  `deleteCategory` exactly.
- `app/api/items/[id]/route.ts` (new file): `DELETE` handler. Requires a
  signed-in user (401 otherwise); no role check. Calls `deleteItem`; on
  `isForeignKeyViolation` responds 400 with `"Can't delete — this item
  has stock history. Only items with no batches or movements can be
  deleted."`; any other error responds 400 with `describeError(error)`;
  success responds `{ ok: true }`.
- Edit Item page (`app/(dashboard)/items/[id]/edit/page.tsx`): a new
  client component, `delete-item-button.tsx`, rendered below the "Save
  changes" button, visually separated and destructive-styled. On click:
  `window.confirm` naming the item's SKU and name ("Delete {sku} — {name}?
  This can't be undone."); on confirm, `fetch DELETE
  /api/items/${itemId}`; on failure show the returned error inline; on
  success `router.push("/items")` (unlike the lookup-list delete button,
  which stays on a list and just removes a row, this page's own subject
  no longer exists after success).

## What's left to the builder

- Exact Tailwind classes for the visual separation between Save and
  Delete (a top border + margin, matching this page's existing spacing
  conventions, is a reasonable default).
- Button loading-state copy ("Deleting…") — matches existing convention
  in `components/lookup-list-table.tsx`.
