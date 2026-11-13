import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_CHANNELS_TABLE } from "./_getRef";

/**
 * Renames a channel. Only GMs of the campaign may rename; everyone else
 * (and outsiders) fail on the channel access rules, which return no row and
 * therefore read as "channel not found". Starting channels stay renamable:
 * only archiving them is refused.
 */
export const renameChannel = createApiFunction<
  { channelId: string; name: string },
  void
>(async (params) => {
  const { channelId, name } = params;
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Channel name is required.");
  }
  const { data, error } = await getSupabaseClient()
    .from(CHAT_CHANNELS_TABLE)
    .update({ name: trimmed })
    .eq("id", channelId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Channel not found.");
  }
}, "Failed to rename channel.");
