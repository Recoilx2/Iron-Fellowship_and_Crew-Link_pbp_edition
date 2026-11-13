/**
 * Identifiers for the user_settings table. The data layer is the only place
 * that names backend tables and live-update topics; stores, pages and
 * components stay backend-free.
 */

export const USER_SETTINGS_TABLE = "user_settings";

export interface UserSettingsRow {
  user_id: string;
  verbose_roll_results: boolean;
  pinned_oracle_sections: Record<string, boolean>;
  updated_at: string;
}

export type UserSettingsScope = "accessibility" | "oracle";

export function constructUserSettingsChannelName(
  userId: string,
  scope: UserSettingsScope = "accessibility"
): string {
  // Accessibility + oracle listeners must never share one realtime topic
  // (#90): supabase-js channel() creates-OR-REUSES by topic, so a shared
  // topic hands the second listenToRows an already-subscribed channel and
  // realtime-js throws on the second .on() — the same hazard class as #83.
  // The :oracle suffix keeps the 'user-%' realtime allowlist prefix, so no
  // policy change; the accessibility topic stays byte-identical.
  return scope === "oracle"
    ? `user-settings:${userId}:oracle`
    : `user-settings:${userId}`;
}

export function constructUserSettingsFilter(userId: string): string {
  return `user_id=eq.${userId}`;
}
