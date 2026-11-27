import { getSupabaseClient } from "config/supabase.config";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { AccessibilitySettingsDocument } from "api-calls/user/settings/_settings.type";
import {
  constructUserSettingsChannelName,
  constructUserSettingsFilter,
  USER_SETTINGS_TABLE,
  UserSettingsRow,
} from "./_getRef";
import { logError } from "functions/errorReference";

export const listenToAccessibilitySettings = (
  uid: string,
  onSettings: (settings: AccessibilitySettingsDocument) => void
) => {
  const client = getSupabaseClient();
  return listenToRows<UserSettingsRow>({
    client,
    channelName: constructUserSettingsChannelName(uid),
    bindings: [
      {
        type: "postgres_changes",
        table: USER_SETTINGS_TABLE,
        filter: constructUserSettingsFilter(uid),
        toChange: (payload) => {
          const row = payload.new as Partial<UserSettingsRow>;
          if (row && typeof row.user_id === "string") {
            return { kind: "upsert", row: row as UserSettingsRow };
          }
          return null;
        },
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(USER_SETTINGS_TABLE)
        .select(
          "user_id, verbose_roll_results, email_notifications_enabled, pinned_oracle_sections, updated_at"
        )
        .eq("user_id", uid);
      if (error) {
        logError("listenToAccessibilitySettings", error);
        return [];
      }
      return (data ?? []) as unknown as UserSettingsRow[];
    },
    getKey: (row) => row.user_id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const row = rows[0];
      if (!row) {
        onSettings({});
        return;
      }
      const settings: AccessibilitySettingsDocument = {
        verboseRollResults: row.verbose_roll_results,
      };
      // Only carry the flag when the column is present: older rows and the
      // unit-test fake must still map to the same accessibility shape.
      if (typeof row.email_notifications_enabled === "boolean") {
        settings.emailNotificationsEnabled = row.email_notifications_enabled;
      }
      onSettings(settings);
    },
  });
};
