import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "@/lib/use-debounced-value";

test("returns the initial value immediately", () => {
  const { result } = renderHook(() => useDebouncedValue("a"));
  expect(result.current).toBe("a");
});

test("does not update until delayMs has passed with no further changes", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ value }) => useDebouncedValue(value, 200),
    { initialProps: { value: "a" } }
  );
  rerender({ value: "ab" });
  expect(result.current).toBe("a");
  act(() => vi.advanceTimersByTime(199));
  expect(result.current).toBe("a");
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe("ab");
  vi.useRealTimers();
});

test("resets the timer on every change within the delay window", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ value }) => useDebouncedValue(value, 200),
    { initialProps: { value: "a" } }
  );
  rerender({ value: "ab" });
  act(() => vi.advanceTimersByTime(150));
  rerender({ value: "abc" });
  act(() => vi.advanceTimersByTime(150));
  expect(result.current).toBe("a");
  act(() => vi.advanceTimersByTime(50));
  expect(result.current).toBe("abc");
  vi.useRealTimers();
});
