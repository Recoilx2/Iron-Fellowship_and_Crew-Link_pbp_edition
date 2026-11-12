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

export function constructUserSettingsChannelName(userId: string): string {
  return `user-settings:${userId}`;
}

export function constructUserSettingsFilter(userId: string): string {
  return `user_id=eq.${userId}`;
}
