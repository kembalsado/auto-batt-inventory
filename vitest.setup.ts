import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// `server-only` throws by default outside Next's RSC `react-server` build
// condition (its "default" export condition always throws; only
// "react-server" resolves to a no-op). Stub it so server-only modules
// (e.g. lib/supabase/admin.ts) can be imported directly in tests.
vi.mock("server-only", () => ({}));
