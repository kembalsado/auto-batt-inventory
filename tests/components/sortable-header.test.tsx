import { render, screen, fireEvent } from "@testing-library/react";
import { SortIcon, SortButtonHeader, SortLinkHeader } from "@/components/sortable-header";

test("SortIcon renders the up arrow when ascending", () => {
  const { container } = render(<SortIcon direction="asc" />);
  expect(container.querySelector("svg")?.getAttribute("class")).toContain("arrow-up");
});

test("SortIcon renders the down arrow when descending", () => {
  const { container } = render(<SortIcon direction="desc" />);
  expect(container.querySelector("svg")?.getAttribute("class")).toContain("arrow-down");
});

test("SortIcon renders the up-down arrow when not sorted by this column", () => {
  const { container } = render(<SortIcon direction="none" />);
  expect(container.querySelector("svg")?.getAttribute("class")).toContain("arrow-up-down");
});

test("SortButtonHeader sets aria-sort=\"ascending\" and calls onClick when clicked", () => {
  const onClick = vi.fn();
  render(
    <table><thead><tr>
      <SortButtonHeader label="Name" direction="asc" onClick={onClick} />
    </tr></thead></table>
  );
  expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute(
    "aria-sort",
    "ascending"
  );
  fireEvent.click(screen.getByRole("button", { name: /name/i }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("SortButtonHeader omits aria-sort when direction is \"none\"", () => {
  render(
    <table><thead><tr>
      <SortButtonHeader label="Name" direction="none" onClick={() => {}} />
    </tr></thead></table>
  );
  expect(screen.getByRole("columnheader")).not.toHaveAttribute("aria-sort");
});

test("SortLinkHeader renders a link with the given href and aria-sort=\"descending\"", () => {
  render(
    <table><thead><tr>
      <SortLinkHeader label="Date" direction="desc" href="/activity?sort=date&dir=desc" />
    </tr></thead></table>
  );
  expect(screen.getByRole("link", { name: /date/i })).toHaveAttribute(
    "href",
    "/activity?sort=date&dir=desc"
  );
  expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
});
