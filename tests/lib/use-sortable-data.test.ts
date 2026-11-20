import { renderHook, act } from "@testing-library/react";
import { useSortableData } from "@/lib/use-sortable-data";

test("sorts rows ascending by the default key", () => {
  const rows = [{ name: "Charlie" }, { name: "Alice" }, { name: "Bob" }];
  const { result } = renderHook(() =>
    useSortableData(rows, { accessors: { name: (r) => r.name }, defaultKey: "name" })
  );
  expect(result.current.sorted.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  expect(result.current.direction).toBe("asc");
});

test("toggling the active key flips direction", () => {
  const rows = [{ name: "Charlie" }, { name: "Alice" }, { name: "Bob" }];
  const { result } = renderHook(() =>
    useSortableData(rows, { accessors: { name: (r) => r.name }, defaultKey: "name" })
  );
  act(() => result.current.toggle("name"));
  expect(result.current.direction).toBe("desc");
  expect(result.current.sorted.map((r) => r.name)).toEqual(["Charlie", "Bob", "Alice"]);
  act(() => result.current.toggle("name"));
  expect(result.current.direction).toBe("asc");
});

test("toggling a different key switches to that key ascending", () => {
  const rows = [{ name: "Bob", age: 30 }, { name: "Alice", age: 20 }];
  const { result } = renderHook(() =>
    useSortableData(rows, {
      accessors: { name: (r) => r.name, age: (r) => r.age },
      defaultKey: "name",
    })
  );
  act(() => result.current.toggle("age"));
  expect(result.current.sortKey).toBe("age");
  expect(result.current.direction).toBe("asc");
  expect(result.current.sorted.map((r) => r.age)).toEqual([20, 30]);
});

test("accessor receives the row's original index, for position-based sorting", () => {
  const rows = [{ label: "10" }, { label: "2" }];
  const { result } = renderHook(() =>
    useSortableData(rows, {
      accessors: { position: (_row, index) => index },
      defaultKey: "position",
    })
  );
  expect(result.current.sorted.map((r) => r.label)).toEqual(["10", "2"]);
  act(() => result.current.toggle("position"));
  expect(result.current.sorted.map((r) => r.label)).toEqual(["2", "10"]);
});

test("does not mutate the input array", () => {
  const rows = [{ name: "Charlie" }, { name: "Alice" }];
  const { result } = renderHook(() =>
    useSortableData(rows, { accessors: { name: (r) => r.name }, defaultKey: "name" })
  );
  expect(result.current.sorted).not.toBe(rows);
  expect(rows.map((r) => r.name)).toEqual(["Charlie", "Alice"]);
});
