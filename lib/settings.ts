import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";

/**
 * The single `app_settings` row (id is pinned to 1 — see
 * supabase/migrations/0001_init.sql), mapped from snake_case columns to
 * camelCase fields for application code.
 */
export interface AppSettings {
  showCostToAssistant: boolean;
  defaultLowStockThreshold: number;
  notificationEmails: string[];
  /** "HH:MM:SS", as Postgres's `time` type returns it. */
  dailyEmailSendTime: string;
}

/** Fields `updateSettings` accepts — any subset of `AppSettings`. */
export interface UpdateSettingsInput {
  showCostToAssistant?: boolean;
  defaultLowStockThreshold?: number;
  notificationEmails?: string[];
  dailyEmailSendTime?: string;
}

interface AppSettingsRow {
  show_cost_to_assistant: boolean;
  default_low_stock_threshold: number;
  notification_emails: string[];
  daily_email_send_time: string;
}

function toAppSettings(row: AppSettingsRow): AppSettings {
  return {
    showCostToAssistant: row.show_cost_to_assistant,
    defaultLowStockThreshold: Number(row.default_low_stock_threshold),
    notificationEmails: row.notification_emails,
    dailyEmailSendTime: row.daily_email_send_time,
  };
}

/**
 * Fetches the single `app_settings` row. Readable by any authenticated
 * user (RLS, supabase/migrations/0009_app_settings_rls.sql) — an
 * assistant's own `canSeeCost` check (lib/permissions.ts) needs
 * `showCostToAssistant` too, not just the owner.
 */
export async function getSettings(
  supabase: SupabaseClient
): Promise<AppSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    throw error;
  }

  return toAppSettings(data);
}

/**
 * Updates the single `app_settings` row and records an audit_log entry
 * for it (`action: "settings.updated"`). Only an owner can succeed here —
 * enforced by RLS (0009_app_settings_rls.sql), not re-checked in
 * application code, following the pattern set by items/categories RLS.
 *
 * This is a plain application-level update, not a Postgres function like
 * `record_stock_in`/`record_stock_out` — there's no multi-table atomicity
 * concern for a single-row settings change, so the audit write happens
 * here via `recordAudit` after the update succeeds (the normal pattern
 * `createItem`/`createCategory` use), rather than inside a SECURITY
 * DEFINER function.
 *
 * `app_settings.id` is an int (always 1), not a uuid, so no `entityId` is
 * passed to `recordAudit` — `audit_log.entity_id` is a uuid column, and
 * there's only ever one settings row to identify anyway.
 */
export async function updateSettings(
  supabase: SupabaseClient,
  actorId: string,
  patch: UpdateSettingsInput
): Promise<AppSettings> {
  const updatePayload: Record<string, unknown> = {};
  if (patch.showCostToAssistant !== undefined) {
    updatePayload.show_cost_to_assistant = patch.showCostToAssistant;
  }
  if (patch.defaultLowStockThreshold !== undefined) {
    updatePayload.default_low_stock_threshold = patch.defaultLowStockThreshold;
  }
  if (patch.notificationEmails !== undefined) {
    updatePayload.notification_emails = patch.notificationEmails;
  }
  if (patch.dailyEmailSendTime !== undefined) {
    updatePayload.daily_email_send_time = patch.dailyEmailSendTime;
  }

  const { data, error } = await supabase
    .from("app_settings")
    .update(updatePayload)
    .eq("id", 1)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await recordAudit(supabase, {
    actorId,
    action: "settings.updated",
    entityType: "app_settings",
    summary: "Updated app settings",
    details: patch as Record<string, unknown>,
  });

  return toAppSettings(data);
}
