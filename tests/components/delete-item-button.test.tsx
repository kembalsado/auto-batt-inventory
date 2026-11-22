import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeleteItemButton } from "@/app/(dashboard)/items/[id]/edit/delete-item-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  push.mockClear();
});

test("confirms with the item's SKU and name, then deletes and navigates to /items", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(window.confirm).toHaveBeenCalledWith(
    "Delete AB-001 — 12V Battery? This can't be undone."
  );
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/items/item-1", expect.objectContaining({ method: "DELETE" }))
  );
  await waitFor(() => expect(push).toHaveBeenCalledWith("/items"));
});

test("declining the confirm dialog makes no request and does not navigate", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(fetchMock).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test("shows the server's error inline and does not navigate away on failure", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Can't delete — this item has stock history." }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(await screen.findByText(/stock history/i)).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

test("the inline error is announced to assistive tech", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Can't delete — this item has stock history." }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/stock history/i);
});

test("shows a session-expired error and does not navigate when the request is redirected to /login", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, type: "opaqueredirect" });
  vi.stubGlobal("fetch", fetchMock);

  render(<DeleteItemButton itemId="item-1" sku="AB-001" name="12V Battery" />);
  fireEvent.click(screen.getByRole("button", { name: /delete item/i }));

  expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/items/item-1",
    expect.objectContaining({ method: "DELETE", redirect: "manual" })
  );
  expect(push).not.toHaveBeenCalled();
});
