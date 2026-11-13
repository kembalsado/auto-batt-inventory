import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Load .env.local (and friends) into process.env so server-only code
    // under test (e.g. the Supabase admin client) can read them, matching
    // how Next.js loads them for the app itself.
    env: loadEnv("test", process.cwd(), ""),
    // All test files share one local Supabase database (no per-file
    // isolation), so a test file that touches a GLOBAL singleton row —
    // app_settings (tests/lib/cost-visibility.test.ts) — can otherwise
    // race against another file reading that same row concurrently (e.g.
    // tests/db/schema.test.ts asserting app_settings' default value).
    // Running test files sequentially closes that race for every current
    // and future test file, rather than papering over it in one file.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
