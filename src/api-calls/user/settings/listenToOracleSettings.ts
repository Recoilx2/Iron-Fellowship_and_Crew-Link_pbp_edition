import { getSupabaseClient } from "config/supabase.config";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { OracleSettingsDocument } from "api-calls/user/settings/_settings.type";
import {
  constructUserSettingsChannelName,
  constructUserSettingsFilter,
  USER_SETTINGS_TABLE,
  UserSettingsRow,
} from "./_getRef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ErrorCallback = (error: any) => void;

export function listenToOracleSettings(
  uid: string,
  onOracleSettings: (settings: OracleSettingsDocument) => void,
  onError: ErrorCallback
) {
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
          "user_id, verbose_roll_results, pinned_oracle_sections, updated_at"
        )
        .eq("user_id", uid);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as UserSettingsRow[];
    },
    getKey: (row) => row.user_id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const row = rows[0];
      onOracleSettings({
        pinnedOracleSections:
          (row?.pinned_oracle_sections as Record<string, boolean>) ?? {},
      });
    },
    onError,
  });
}
