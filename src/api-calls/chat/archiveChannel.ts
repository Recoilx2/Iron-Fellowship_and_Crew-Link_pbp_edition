import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_CHANNELS_TABLE } from "./_getRef";

/**
 * Archives (or reopens) a channel. Only GMs of the campaign may archive;
 * everyone else fails on the channel access rules, which return no row and
 * therefore read as "channel not found". The two starting channels refuse
 * to archive: the database raises, and the caller sees the failure.
 */
export const archiveChannel = createApiFunction<
  { channelId: string; archived: boolean },
  void
>(async (params) => {
  const { channelId, archived } = params;
  const { data, error } = await getSupabaseClient()
    .from(CHAT_CHANNELS_TABLE)
    .update({ archived })
    .eq("id", channelId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Channel not found.");
  }
}, "Failed to archive channel.");
