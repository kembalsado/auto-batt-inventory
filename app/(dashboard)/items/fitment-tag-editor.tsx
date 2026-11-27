"use client";

import { useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFitment } from "@/lib/item-fitments";

/**
 * One candidate vehicle fitment in this editor's local list. `key` is a
 * client-only identity used for rendering/removal — it's stripped before
 * the list is serialized into the hidden field, leaving exactly the shape
 * `FitmentInput` (lib/item-fitments.ts) expects. `id` is present only for
 * an existing fitment being re-displayed/edited; a brand-new chip added in
 * this session never has one.
 */
export interface FitmentChip {
  key: string;
  id?: string;
  makeId: string | null;
  model: string | null;
  variant: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface FitmentTagEditorProps {
  makes: { id: string; name: string }[];
  models: { id: string; makeId: string; name: string }[];
  variantSuggestions: string[];
  initialFitments: FitmentChip[];
  /**
   * Hidden input's `name` — the form field the serialized chip list is
   * submitted under, for a page whose Server Action reads it under a
   * different name than the default "fitments". Not a multi-instance
   * knob: this component's internal element ids (`fitment-make`,
   * `fitment-model`, …) are hardcoded, so two editors on one page would
   * collide on DOM ids regardless of `fieldName`. No page does that.
   */
  fieldName?: string;
}

function toNullableNumber(raw: string): number | null {
  return raw === "" ? null : Number(raw);
}

/**
 * Year bounds, matching the single Year field these two replaced: no
 * vehicle predates 1900, and next model year is legitimately on sale.
 * `parseFitmentsJson` (lib/item-fitments.ts) re-applies the same bounds
 * server-side — these attributes only guide the browser's own number
 * input, and a hand-crafted POST never passes through them at all.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 1;

export function FitmentTagEditor({
  makes,
  models,
  variantSuggestions,
  initialFitments,
  fieldName = "fitments",
}: FitmentTagEditorProps) {
  const [chips, setChips] = useState<FitmentChip[]>(initialFitments);
  const [makeId, setMakeId] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");

  const makeNameById = new Map(makes.map((make) => [make.id, make.name]));

  // "Something was entered in the add-row" — the one condition both the
  // Add button's `disabled` state and `handleAdd`'s own guard use, so the
  // button can never be clickable in a state the handler would refuse.
  // `yearTo` counts: a lone Year-to is a valid entry (it gets mirrored
  // into Year-from below), and omitting it here used to make the button
  // silently reject one.
  const canAdd = Boolean(makeId || model.trim() || variant.trim() || yearFrom || yearTo);

  function handleAdd() {
    if (!canAdd) {
      return;
    }

    // An inverted range (2022 → 2018) is refused outright rather than
    // "corrected" by swapping: which field the user mistyped isn't
    // knowable, and formatFitment would otherwise render the nonsense
    // "2022–2018". Silent no-op, the same convention the empty-row guard
    // above uses — the Add button stays enabled and the entered values
    // stay in place for the user to correct.
    if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) {
      return;
    }

    // A fitment's year is always a complete range (formatFitment,
    // replaceFitmentsForItem, and the backfill migration all assume this —
    // "equal for a single year" when there's just one). The add-row lets a
    // user fill only one of the two year fields, so a lone value is
    // mirrored into the other side here, the only place a fitment's year
    // data originates from user input. Left unmirrored, formatFitment
    // renders e.g. "2020–null" since it builds a range whenever
    // yearFrom !== yearTo, including when one side is null.
    let effectiveYearFrom = yearFrom;
    let effectiveYearTo = yearTo;
    if (yearFrom && !yearTo) {
      effectiveYearTo = yearFrom;
    } else if (yearTo && !yearFrom) {
      effectiveYearFrom = yearTo;
    }

    setChips((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        makeId: makeId || null,
        model: model.trim() || null,
        variant: variant.trim() || null,
        yearFrom: toNullableNumber(effectiveYearFrom),
        yearTo: toNullableNumber(effectiveYearTo),
      },
    ]);
    setMakeId("");
    setModel("");
    setVariant("");
    setYearFrom("");
    setYearTo("");
  }

  /**
   * Enter inside any add-row text/number input adds the tag instead of
   * submitting the page's form. These inputs sit inside the Add/Edit Item
   * <form>, whose only `type="submit"` control is Save, and "Add" is a
   * `type="button"` — so without this, Enter triggers implicit form
   * submission: the item saves and whatever tag was being typed is
   * silently discarded. (The Make <select> needs no handler; Enter on a
   * select doesn't produce this, and a select's own keyboard handling
   * shouldn't be intercepted.)
   */
  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") {
      return;
    }
    e.preventDefault();
    handleAdd();
  }

  function handleRemove(key: string) {
    setChips((prev) => prev.filter((chip) => chip.key !== key));
  }

  const serialized = JSON.stringify(
    chips.map((chip) => ({
      id: chip.id,
      makeId: chip.makeId,
      model: chip.model,
      variant: chip.variant,
      yearFrom: chip.yearFrom,
      yearTo: chip.yearTo,
    }))
  );

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={fieldName} value={serialized} readOnly />

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => {
            const label = formatFitment({
              makeName: chip.makeId ? makeNameById.get(chip.makeId) ?? null : null,
              model: chip.model,
              variant: chip.variant,
              yearFrom: chip.yearFrom,
              yearTo: chip.yearTo,
            });
            return (
              <Badge key={chip.key} variant="secondary" className="gap-1.5 py-1">
                {label}
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => handleRemove(chip.key)}
                  className="rounded-full text-secondary-foreground/70 hover:text-secondary-foreground"
                >
                  Remove
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fitment-make">Make</Label>
          <select
            id="fitment-make"
            value={makeId}
            onChange={(e) => setMakeId(e.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">None</option>
            {makes.map((make) => (
              <option key={make.id} value={make.id}>
                {make.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fitment-model">Model</Label>
          <Input
            id="fitment-model"
            list="fitment-model-suggestions"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="Optional"
            className="w-32"
          />
          <datalist id="fitment-model-suggestions">
            {(makeId
              ? models.filter((m) => m.makeId === makeId).map((m) => m.name)
              : Array.from(new Set(models.map((m) => m.name))).sort()
            ).map((suggestion) => (
              <option key={suggestion} value={suggestion}>{suggestion}</option>
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fitment-variant">Variant</Label>
          <Input
            id="fitment-variant"
            list="fitment-variant-suggestions"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="Optional"
            className="w-32"
          />
          <datalist id="fitment-variant-suggestions">
            {variantSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fitment-year-from">Year from</Label>
          <Input
            id="fitment-year-from"
            type="number"
            min={MIN_YEAR}
            max={MAX_YEAR}
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="Optional"
            className="w-24"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fitment-year-to">Year to</Label>
          <Input
            id="fitment-year-to"
            type="number"
            min={MIN_YEAR}
            max={MAX_YEAR}
            value={yearTo}
            onChange={(e) => setYearTo(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="Optional"
            className="w-24"
          />
        </div>

        <Button type="button" variant="outline" onClick={handleAdd} disabled={!canAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}
