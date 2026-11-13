import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // .worktrees/ is a nested checkout with its own node_modules — without
    // this, linting from the main checkout also lints that copy's build
    // artifacts and dependencies (same class of gap as vitest.config.ts's
    // missing exclude).
    "node_modules/**",
    ".worktrees/**",
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
