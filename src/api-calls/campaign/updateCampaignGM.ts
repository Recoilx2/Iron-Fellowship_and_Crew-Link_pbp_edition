import { getSupabaseClient } from "config/supabase.config";
import { CAMPAIGN_MEMBERS_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Adds a co-GM, or demotes one back to player. Only existing GMs change the
 * roster; demoting keeps the person as a campaign member.
 *
 * The previous world-side guide sync stays with the worlds ticket: worlds
 * still live in Firebase, so there is no world row to update yet.
 */
export const updateCampaignGM = createApiFunction<
  {
    campaignId: string;
    worldId?: string;
    gmId: string;
    shouldRemove?: boolean;
  },
  void
>(async (params) => {
  const { campaignId, gmId, shouldRemove } = params;
  const client = getSupabaseClient();
  if (!shouldRemove) {
    const { error } = await client.from(CAMPAIGN_MEMBERS_TABLE).upsert(
      { campaign_id: campaignId, user_id: gmId, role: "gm" },
      { onConflict: "campaign_id,user_id" }
    );
    if (error) {
      throw error;
    }
    return;
  }
  const { data, error } = await client
    .from(CAMPAIGN_MEMBERS_TABLE)
    .update({ role: "player" })
    .eq("campaign_id", campaignId)
    .eq("user_id", gmId)
    .select("user_id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("GM not found");
  }
}, "Failed to update GM.");
