import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Replaces a private channel's roster outright. Only GMs of the campaign
 * may change it; anyone removed loses access straight away, including live
 * updates. DMs keep their pair and public channels need no roster, so the
 * database refuses both, and the caller sees the failure.
 */
export const setChannelMembers = createApiFunction<
  { channelId: string; memberIds: string[] },
  void
>(async (params) => {
  const { channelId, memberIds } = params;
  if (!channelId) {
    throw new Error("A channel is required to change its members.");
  }
  const { error } = await getSupabaseClient().rpc("set_channel_members", {
    chid: channelId,
    member_ids: memberIds,
  });
  if (error) {
    throw error;
  }
}, "Failed to change channel members.");
