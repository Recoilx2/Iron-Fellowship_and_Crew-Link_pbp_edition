import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Opens a member's direct channel with another member: the existing channel
 * when the pair already talks, a new one otherwise. Any campaign member may
 * message another member; the database refuses outsiders, strangers to the
 * campaign and messaging oneself, and the caller sees the failure. A direct
 * channel is visible only to its two members, blind even to GMs who are
 * not in it.
 */
export const getOrCreateDirectChannel = createApiFunction<
  { campaignId: string; otherUserId: string },
  string
>(async (params) => {
  const { campaignId, otherUserId } = params;
  if (!campaignId) {
    throw new Error("A campaign is required to message someone.");
  }
  if (!otherUserId) {
    throw new Error("Choose who to message.");
  }
  const { data, error } = await getSupabaseClient().rpc(
    "get_or_create_dm_channel",
    {
      cid: campaignId,
      other_id: otherUserId,
    }
  );
  if (error || typeof data !== "string" || data.length === 0) {
    throw error ?? new Error("Could not open direct message.");
  }
  return data;
}, "Failed to open direct message.");
