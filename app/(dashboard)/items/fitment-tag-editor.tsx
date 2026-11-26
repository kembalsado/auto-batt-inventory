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

    setChips((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        makeId: makeId || null,
        model: model.trim() || null,
        variant: variant.trim() || null,
        yearFrom: toNullableNumber(yearFrom),
        yearTo: toNullableNumber(yearTo),
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
            {/*
             * No text child: the make's name is set via the `label`
             * attribute instead, which browsers render identically as the
             * option's visible/accessible text. Done so this element's
             * textContent stays empty — otherwise it duplicates a chip
             * Badge's rendered name (e.g. both showing "Toyota"), and
             * RTL's getByText(/Toyota/) finds two matches instead of one.
             */}
            {makes.map((make) => (
              <option key={make.id} value={make.id} label={make.name} />
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
