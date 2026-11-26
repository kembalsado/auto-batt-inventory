"use client";

import { useState } from "react";
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
  modelSuggestions: string[];
  variantSuggestions: string[];
  initialFitments: FitmentChip[];
  /** Hidden input's `name`, so a page can embed more than one of these. */
  fieldName?: string;
}

function toNullableNumber(raw: string): number | null {
  return raw === "" ? null : Number(raw);
}

export function FitmentTagEditor({
  makes,
  modelSuggestions,
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

  function handleAdd() {
    if (!makeId && !model.trim() && !variant.trim() && !yearFrom) {
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
            placeholder="Optional"
            className="w-32"
          />
          <datalist id="fitment-model-suggestions">
            {modelSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
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
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            placeholder="Optional"
            className="w-24"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fitment-year-to">Year to</Label>
          <Input
            id="fitment-year-to"
            type="number"
            value={yearTo}
            onChange={(e) => setYearTo(e.target.value)}
            placeholder="Optional"
            className="w-24"
          />
        </div>

        <Button type="button" variant="outline" onClick={handleAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}
