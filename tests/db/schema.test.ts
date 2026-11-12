import { expect, test } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

test("app_settings has exactly one seeded row", async () => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("app_settings").select("*");

  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data![0].show_cost_to_assistant).toBe(false);
});
