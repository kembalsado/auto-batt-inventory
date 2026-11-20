"use client";

import { useState, useMemo } from "react";

export type SortDirection = "asc" | "desc";

export interface UseSortableDataConfig<Row, Key extends string> {
  accessors: Record<Key, (row: Row, index: number) => string | number>;
  defaultKey: Key;
  defaultDirection?: SortDirection;
}

export interface UseSortableDataResult<Row, Key extends string> {
  sorted: Row[];
  sortKey: Key;
  direction: SortDirection;
  toggle: (key: Key) => void;
}

export function useSortableData<Row, Key extends string>(
  rows: Row[],
  config: UseSortableDataConfig<Row, Key>
): UseSortableDataResult<Row, Key> {
  const [sortKey, setSortKey] = useState<Key>(config.defaultKey);
  const [direction, setDirection] = useState<SortDirection>(config.defaultDirection ?? "asc");

  const sorted = useMemo(() => {
    // Create a copy with original indices preserved
    const indexed = rows.map((row, index) => ({ row, index }));

    // Sort the indexed array
    indexed.sort((a, b) => {
      const aValue = config.accessors[sortKey](a.row, a.index);
      const bValue = config.accessors[sortKey](b.row, b.index);

      let comparison: number;

      // Compare based on type
      if (typeof aValue === "number" && typeof bValue === "number") {
        comparison = aValue - bValue;
      } else {
        // Both are strings (or coerced to strings)
        const aStr = String(aValue);
        const bStr = String(bValue);
        comparison = aStr.localeCompare(bStr);
      }

      // Negate for descending
      return direction === "desc" ? -comparison : comparison;
    });

    // Extract just the rows from the sorted indexed array
    return indexed.map((item) => item.row);
  }, [rows, sortKey, direction, config.accessors]);

  const toggle = (key: Key) => {
    if (key === sortKey) {
      // Same key: flip direction
      setDirection(direction === "asc" ? "desc" : "asc");
    } else {
      // Different key: switch to that key with ascending
      setSortKey(key);
      setDirection("asc");
    }
  };

  return {
    sorted,
    sortKey,
    direction,
    toggle,
  };
}
