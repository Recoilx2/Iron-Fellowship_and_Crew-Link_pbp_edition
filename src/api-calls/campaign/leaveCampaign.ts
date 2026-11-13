import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Leaves a campaign, or -- for GMs -- removes another member. Leaving
 * unlinks the departing member's characters from the campaign without
 * deleting them, then drops the roster row. Anyone may leave themselves;
 * only GMs remove other members. Access ends in the same step, so removed
 * members read nothing afterwards.
 */
export const leaveCampaign = createApiFunction<
  { uid: string; campaignId: string },
  void
>(async (params) => {
  const { uid, campaignId } = params;
  const { error } = await getSupabaseClient().rpc("remove_campaign_member", {
    cid: campaignId,
    target_uid: uid,
  });
  if (error) {
    throw error;
  }
}, "Failed to remove user from campaign.");
