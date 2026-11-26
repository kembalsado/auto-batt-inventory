import { render, screen, fireEvent } from "@testing-library/react";
import { FitmentTagEditor } from "@/app/(dashboard)/items/fitment-tag-editor";

const makes = [{ id: "m1", name: "Toyota" }];

test("starts with the initial chips rendered and serialized into the hidden field", () => {
  const { container } = render(
    <FitmentTagEditor makes={makes} modelSuggestions={[]} variantSuggestions={[]}
      initialFitments={[{ key: "k1", id: "f1", makeId: "m1", model: "Vios", variant: null, yearFrom: 2018, yearTo: 2018 }]} />
  );
  expect(screen.getByText(/Toyota/)).toBeInTheDocument();
  expect(screen.getByText(/Vios/)).toBeInTheDocument();
  const hidden = container.querySelector('input[name="fitments"]') as HTMLInputElement;
  expect(JSON.parse(hidden.value)).toEqual([{ id: "f1", makeId: "m1", model: "Vios", variant: null, yearFrom: 2018, yearTo: 2018 }]);
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
