import { render, screen, fireEvent, within } from "@testing-library/react";
import { FitmentTagEditor } from "@/app/(dashboard)/items/fitment-tag-editor";

const makes = [{ id: "m1", name: "Toyota" }];

test("starts with the initial chips rendered and serialized into the hidden field", () => {
  const { container } = render(
    <FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]}
      initialFitments={[{ key: "k1", id: "f1", makeId: "m1", model: "Vios", variant: null, yearFrom: 2018, yearTo: 2018 }]} />
  );
  // Scoped to the chip itself, not a bare screen.getByText(/Toyota/) —
  // the Make select below also has an option literally reading "Toyota",
  // so an unscoped query is ambiguous (finds both). Asserting on the
  // chip's own container keeps this test unambiguous without resorting to
  // an accessible-name-only check that wouldn't catch the chip rendering
  // the wrong text.
  const chip = container.querySelector('[data-slot="badge"]') as HTMLElement;
  expect(chip).toHaveTextContent(/Toyota/);
  expect(chip).toHaveTextContent(/Vios/);
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([{ id: "f1", makeId: "m1", model: "Vios", variant: null, yearFrom: 2018, yearTo: 2018 }]);
});

test("the Make select renders each make's name as real visible option text, not just an accessible label", () => {
  render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  const select = screen.getByLabelText(/^make$/i) as HTMLSelectElement;
  // getByText matches DOM textContent, not the `label` attribute — this
  // fails if an <option> carries its name only via `label` with no text
  // child (the bug: the option's accessible name is set, but a real
  // browser renders nothing visible in the dropdown).
  const option = within(select).getByText("Toyota") as HTMLOptionElement;
  expect(option.tagName).toBe("OPTION");
  expect(option.value).toBe("m1");
});

test("Add appends a new chip (no id) with the entered fields, and updates the hidden field", () => {
  const { container } = render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  fireEvent.change(screen.getByLabelText(/model/i), { target: { value: "Terra" } });
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  expect(screen.getByText(/Terra/)).toBeInTheDocument();
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([{ id: undefined, makeId: null, model: "Terra", variant: null, yearFrom: null, yearTo: null }]);
});

test("Add mirrors a lone Year-from value into Year-to instead of leaving a literal null", () => {
  const { container } = render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  fireEvent.change(screen.getByLabelText(/model/i), { target: { value: "Avanza" } });
  fireEvent.change(screen.getByLabelText(/year from/i), { target: { value: "2020" } });
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  expect(screen.getByText(/Avanza/)).toBeInTheDocument();
  expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([{ id: undefined, makeId: null, model: "Avanza", variant: null, yearFrom: 2020, yearTo: 2020 }]);
});

test("Add mirrors a lone Year-to value into Year-from, the symmetric case", () => {
  const { container } = render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  fireEvent.change(screen.getByLabelText(/model/i), { target: { value: "Avanza" } });
  fireEvent.change(screen.getByLabelText(/year to/i), { target: { value: "2020" } });
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([{ id: undefined, makeId: null, model: "Avanza", variant: null, yearFrom: 2020, yearTo: 2020 }]);
});

test("Add does nothing when every field is empty", () => {
  render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
});

test("Add is disabled while the add-row is empty and enabled once any field is filled", () => {
  render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  const add = screen.getByRole("button", { name: /add/i });
  expect(add).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/year to/i), { target: { value: "2020" } });
  expect(add).toBeEnabled();
});

test("Add accepts a Year-to-only entry, mirroring it into Year-from", () => {
  // The empty-row guard used to omit yearTo, so a lone Year-to was
  // silently rejected even though the mirroring logic handles that case.
  const { container } = render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  fireEvent.change(screen.getByLabelText(/year to/i), { target: { value: "2020" } });
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([{ id: undefined, makeId: null, model: null, variant: null, yearFrom: 2020, yearTo: 2020 }]);
});

test("both Year inputs carry the same 1900..next-year bounds the old single Year field had", () => {
  render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  const nextYear = String(new Date().getFullYear() + 1);
  for (const label of [/year from/i, /year to/i]) {
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute("min", "1900");
    expect(input).toHaveAttribute("max", nextYear);
  }
});

test("Add refuses an inverted year range instead of adding a nonsense 2022–2018 chip", () => {
  const { container } = render(<FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />);
  fireEvent.change(screen.getByLabelText(/model/i), { target: { value: "Vios" } });
  fireEvent.change(screen.getByLabelText(/year from/i), { target: { value: "2022" } });
  fireEvent.change(screen.getByLabelText(/year to/i), { target: { value: "2018" } });
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([]);
  // A right-way-round range from the same two fields still works.
  fireEvent.change(screen.getByLabelText(/year from/i), { target: { value: "2018" } });
  fireEvent.change(screen.getByLabelText(/year to/i), { target: { value: "2022" } });
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  expect(JSON.parse(hidden.value)).toEqual([{ id: undefined, makeId: null, model: "Vios", variant: null, yearFrom: 2018, yearTo: 2022 }]);
});

test("pressing Enter in the Model input adds the chip instead of submitting the surrounding form", () => {
  // Regression test: these inputs live inside the Add/Edit Item page's
  // <form>, whose only type="submit" control is Save. Without an
  // onKeyDown handler, Enter triggers implicit form submission — the item
  // saves and the half-typed tag is silently discarded. The chip
  // assertion is the load-bearing one (jsdom does not implement implicit
  // submission, so onSubmit would not fire here either way); onSubmit is
  // asserted too so the test still means something in a real browser.
  const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  const { container } = render(
    <form onSubmit={onSubmit}>
      <FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />
      <button type="submit">Save</button>
    </form>
  );
  const model = screen.getByLabelText(/model/i);
  fireEvent.change(model, { target: { value: "Terra" } });
  fireEvent.keyDown(model, { key: "Enter" });

  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([{ id: undefined, makeId: null, model: "Terra", variant: null, yearFrom: null, yearTo: null }]);
  // The add-row is cleared, same as clicking Add.
  expect((model as HTMLInputElement).value).toBe("");
});

test("Enter adds the chip from the Variant, Year-from and Year-to inputs too", () => {
  const cases: [RegExp, string][] = [
    [/variant/i, "E"],
    [/year from/i, "2020"],
    [/year to/i, "2020"],
  ];
  for (const [label, value] of cases) {
    const { container, unmount } = render(
      <FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]} initialFitments={[]} />
    );
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
    const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
    expect(JSON.parse(hidden.value)).toHaveLength(1);
    unmount();
  }
});

test("removing a chip drops it from both the display and the hidden field", () => {
  const { container } = render(
    <FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]}
      initialFitments={[{ key: "k1", id: "f1", makeId: "m1", model: "Vios", variant: null, yearFrom: 2018, yearTo: 2018 }]} />
  );
  fireEvent.click(screen.getByRole("button", { name: /remove/i }));
  expect(screen.queryByText(/Vios/)).not.toBeInTheDocument();
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([]);
});
