import { getSupabaseClient } from "config/supabase.config";
import { ApiFunction } from "api-calls/createApiFunction";
import { AccessibilitySettingsDocument } from "api-calls/user/settings/_settings.type";
import { USER_SETTINGS_TABLE } from "./_getRef";

export const updateAccessibilitySettings: ApiFunction<
  { uid: string; settings: Partial<AccessibilitySettingsDocument> },
  void
> = async (params) => {
  const { uid, settings } = params;
  const patch: { verbose_roll_results?: boolean } = {};
  if (settings.verboseRollResults !== undefined) {
    patch.verbose_roll_results = settings.verboseRollResults;
  }
  const { error } = await getSupabaseClient()
    .from(USER_SETTINGS_TABLE)
    .upsert({ user_id: uid, ...patch }, { onConflict: "user_id" });
  if (error) {
    console.error(error);
    throw error;
  }
};
