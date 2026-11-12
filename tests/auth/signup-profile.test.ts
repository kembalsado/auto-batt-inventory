import { createAdminClient } from "@/lib/supabase/admin";

test("creating an auth user creates a default assistant profile", async () => {
  const admin = createAdminClient();
  const { data: user } = await admin.auth.admin.createUser({
    email: "test-assistant@example.com",
    password: "test-password-123",
    email_confirm: true,
  });
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user!.user!.id)
    .single();
  expect(profile?.role).toBe("assistant");
});
