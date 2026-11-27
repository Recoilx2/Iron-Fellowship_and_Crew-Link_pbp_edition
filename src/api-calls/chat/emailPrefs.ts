import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { updateAccessibilitySettings } from "api-calls/user/settings/updateAccessibilitySettings";

/**
 * Email notification preferences (ticket #203). The global switch lives on
 * user_settings with the other personal settings; the per-channel choice is
 * its own owner-only row. A missing channel row is meaningful: it means "no
 * email", so reads return null rather than a default of true. Components
 * never name either table directly.
 */

export const CHAT_CHANNEL_EMAIL_PREFS_TABLE = "chat_channel_email_prefs";

export interface ChannelEmailPrefRow {
  user_id: string;
  channel_id: string;
  opted_in: boolean;
}

export const getGlobalEmailNotifications = createApiFunction<
  { uid: string },
  boolean
>(async ({ uid }) => {
  const { data, error } = await getSupabaseClient()
    .from("user_settings")
    .select("email_notifications_enabled")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  // No settings row yet means the migration's default: email is on, but a
  // channel still has to be opted into before anything is sent.
  return data?.email_notifications_enabled ?? true;
}, "Failed to load email notification settings.");

export const setGlobalEmailNotifications = createApiFunction<
  { uid: string; enabled: boolean },
  void
>(async ({ uid, enabled }) => {
  await updateAccessibilitySettings({
    uid,
    settings: { emailNotificationsEnabled: enabled },
  });
}, "Failed to save email notification settings.");

export const getChannelEmailPreference = createApiFunction<
  { uid: string; channelId: string },
  boolean | null
>(async ({ uid, channelId }) => {
  const { data, error } = await getSupabaseClient()
    .from(CHAT_CHANNEL_EMAIL_PREFS_TABLE)
    .select("opted_in")
    .eq("user_id", uid)
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.opted_in : null;
}, "Failed to load channel email preference.");

export const setChannelEmailPreference = createApiFunction<
  { uid: string; channelId: string; optedIn: boolean },
  void
>(async ({ uid, channelId, optedIn }) => {
  const { error } = await getSupabaseClient()
    .from(CHAT_CHANNEL_EMAIL_PREFS_TABLE)
    .upsert(
      { user_id: uid, channel_id: channelId, opted_in: optedIn },
      { onConflict: "user_id,channel_id" }
    );
  if (error) throw error;
}, "Failed to save channel email preference.");
