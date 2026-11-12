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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
