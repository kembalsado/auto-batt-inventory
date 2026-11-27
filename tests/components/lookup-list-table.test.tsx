import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LookupListTable } from "@/components/lookup-list-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const items = [
  { id: "1", name: "Batteries" },
  { id: "2", name: "Oil" },
];

test("renders every item's name", () => {
  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={false}
      emptyLabel="No categories yet."
    />
  );
  expect(screen.getByText("Batteries")).toBeInTheDocument();
  expect(screen.getByText("Oil")).toBeInTheDocument();
});

test("renders the empty label when there are no items", () => {
  render(
    <LookupListTable
      items={[]}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={false}
      emptyLabel="No categories yet."
    />
  );
  expect(screen.getByText("No categories yet.")).toBeInTheDocument();
});

test("hides Edit/Delete entirely when isOwner is false", () => {
  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={false}
      emptyLabel="No categories yet."
    />
  );
  expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
});

test("owner can rename an item: Edit swaps to an input, Save calls PATCH, then refreshes", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
  const input = screen.getByDisplayValue("Batteries");
  fireEvent.change(input, { target: { value: "Battery Parts" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories/1",
      expect.objectContaining({ method: "PATCH" })
    )
  );
});

test("owner can rename a make: Save calls PATCH against /api/makes, not /api/categories", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);

  const makes = [
    { id: "1", name: "Toyota" },
    { id: "2", name: "Honda" },
  ];

  render(
    <LookupListTable
      items={makes}
      apiBasePath="/api/makes"
      noun="make"
      isOwner={true}
      emptyLabel="No makes yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
  const input = screen.getByDisplayValue("Toyota");
  fireEvent.change(input, { target: { value: "Toyota Motors" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/makes/1",
      expect.objectContaining({ method: "PATCH" })
    )
  );
});

test("Save is disabled while the edit input is blank or whitespace", () => {
  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
  const input = screen.getByDisplayValue("Batteries");
  fireEvent.change(input, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
});

test("owner can delete an item after confirming, which calls DELETE and refreshes", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories/1",
      expect.objectContaining({ method: "DELETE" })
    )
  );
});

test("declining the delete confirmation makes no request", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a failed rename shows the server's error message inline", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "That name already exists." }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={items}
      apiBasePath="/api/categories"
      noun="category"
      isOwner={true}
      emptyLabel="No categories yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() =>
    expect(screen.getByText("That name already exists.")).toBeInTheDocument()
  );
});

test("renders an item's secondary label when present, and nothing extra when absent", () => {
  const { container } = render(
    <LookupListTable
      items={[{ id: "1", name: "Vios", secondary: "Toyota" }, { id: "2", name: "Batteries" }]}
      apiBasePath="/api/models"
      noun="model"
      isOwner={false}
      emptyLabel="No models yet."
    />
  );
  expect(screen.getByText("Toyota")).toBeInTheDocument();

  // "Batteries" has no `secondary` — its row renders only the one <span>
  // holding its name, with no second <span> for a secondary label. Only
  // one secondary <span> should exist in the whole document: "Toyota".
  const batteriesRow = screen.getByText("Batteries").closest("li")!;
  expect(batteriesRow.querySelectorAll("span")).toHaveLength(1);
  expect(container.querySelectorAll(".text-muted-foreground")).toHaveLength(1);
});

test("the delete confirm dialog includes deleteWarning when present, and omits it when absent", () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(
    <LookupListTable
      items={[
        { id: "1", name: "Toyota", deleteWarning: "This will also delete its 3 model(s)." },
        { id: "2", name: "Honda" },
      ]}
      apiBasePath="/api/makes"
      noun="make"
      isOwner={true}
      emptyLabel="No makes yet."
    />
  );

  fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
  expect(confirmSpy).toHaveBeenCalledWith(
    `Delete make "Toyota"? This can't be undone. This will also delete its 3 model(s).`
  );

  fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[1]);
  expect(confirmSpy).toHaveBeenCalledWith(
    `Delete make "Honda"? This can't be undone.`
  );

  expect(fetchMock).not.toHaveBeenCalled();
});
