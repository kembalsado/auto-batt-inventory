import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSettings, updateSettings } from "@/lib/settings";

async function saveSettings(formData: FormData) {
  "use server";

  const showCostToAssistant = formData.get("showCostToAssistant") === "on";

  const defaultLowStockThreshold = Number(
    formData.get("defaultLowStockThreshold")
  );
  if (
    !Number.isFinite(defaultLowStockThreshold) ||
    defaultLowStockThreshold < 0
  ) {
    return;
  }

  const notificationEmails = String(formData.get("notificationEmails") ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  const dailyEmailSendTime = String(
    formData.get("dailyEmailSendTime") ?? ""
  ).trim();
  if (!dailyEmailSendTime) return;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await updateSettings(supabase, user.id, {
    showCostToAssistant,
    defaultLowStockThreshold,
    notificationEmails,
    dailyEmailSendTime,
  });

  revalidatePath("/settings");
}

/**
 * Owner-only settings screen (gated by `isOwnerOnlyRoute` in the dashboard
 * layout, not re-checked here): the cost-visibility toggle that
 * `canSeeCost`/`getItemBatchesForViewer` (lib/permissions.ts, lib/items.ts)
 * enforce server-side, plus the other global `app_settings` fields from
 * Task 2 (default low-stock threshold, notification emails, daily email
 * send time) that later tasks (low-stock alerts, the daily email) read.
 */
export default async function SettingsPage() {
  const supabase = await createServerClient();
  const settings = await getSettings(supabase);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Settings</h1>

      <form action={saveSettings} className="mt-6 flex max-w-md flex-col gap-4">
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            name="showCostToAssistant"
            defaultChecked={settings.showCostToAssistant}
          />
          Show cost to assistant
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Default low-stock threshold
          <input
            name="defaultLowStockThreshold"
            type="number"
            min="0"
            step="any"
            required
            defaultValue={settings.defaultLowStockThreshold}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Notification email(s)
          <input
            name="notificationEmails"
            placeholder="owner@example.com, assistant@example.com"
            defaultValue={settings.notificationEmails.join(", ")}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-brand-ink">
          Daily email send time
          <input
            name="dailyEmailSendTime"
            type="time"
            required
            defaultValue={settings.dailyEmailSendTime.slice(0, 5)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <button
          type="submit"
          className="mt-2 rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
        >
          Save settings
        </button>
      </form>
    </div>
  );
}
