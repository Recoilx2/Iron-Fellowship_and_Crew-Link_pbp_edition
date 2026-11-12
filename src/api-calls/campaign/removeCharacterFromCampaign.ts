import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Takes a character out of a campaign without deleting it. The owner may
 * always unlink their own character; anyone else must GM the campaign.
 */
export const removeCharacterFromCampaign = createApiFunction<
  { uid: string; campaignId: string; characterId: string },
  void
>(async (params) => {
  const { characterId } = params;
  const { error } = await getSupabaseClient().rpc(
    "unlink_campaign_character",
    { char_id: characterId }
  );
  if (error) {
    throw error;
  }
}, "Failed to remove character from campaign");
