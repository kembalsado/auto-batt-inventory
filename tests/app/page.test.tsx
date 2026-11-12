import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

test("renders the home page without crashing", () => {
  render(<Page />);
  expect(document.body).toBeDefined();
});
