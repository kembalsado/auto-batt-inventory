import { render, screen, fireEvent } from "@testing-library/react";
import { PrintExportButton } from "@/app/(dashboard)/reports/print-export-button";

test("clicking Print opens the given href and calls print() on the new window once it loads", () => {
  const addEventListener = vi.fn((_event: string, cb: () => void) => cb());
  const print = vi.fn();
  const openSpy = vi
    .spyOn(window, "open")
    .mockReturnValue({ addEventListener, print } as unknown as Window);

  render(<PrintExportButton href="/api/reports/pdf?view=day&date=2026-11-22" />);
  fireEvent.click(screen.getByRole("button", { name: /print/i }));

  expect(openSpy).toHaveBeenCalledWith("/api/reports/pdf?view=day&date=2026-11-22", "_blank");
  expect(addEventListener).toHaveBeenCalledWith("load", expect.any(Function));
  expect(print).toHaveBeenCalled();
});

test("does nothing further when the popup is blocked (window.open returns null)", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  render(<PrintExportButton href="/api/reports/pdf?view=day&date=2026-11-22" />);
  expect(() =>
    fireEvent.click(screen.getByRole("button", { name: /print/i }))
  ).not.toThrow();
});
