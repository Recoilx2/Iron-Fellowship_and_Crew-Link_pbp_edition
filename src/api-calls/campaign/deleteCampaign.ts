import { getSupabaseClient } from "config/supabase.config";
import { CAMPAIGNS_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Deletes a campaign with every shared row: tracks, assets, settings, the
 * roll log and the roster follow through foreign keys, and characters
 * unlink instead of vanishing. Only GMs and the founding creator delete;
 * anyone else reads back zero rows and fails here.
 */
export const deleteCampaign = createApiFunction<{ campaignId: string }, void>(
  async (params) => {
    const { campaignId } = params;
    const { data, error } = await getSupabaseClient()
      .from(CAMPAIGNS_TABLE)
      .delete()
      .eq("id", campaignId)
      .select("id");
    if (error || !data || data.length === 0) {
      throw error ?? new Error("Campaign not found");
    }
  },
  "Failed to delete campaign."
);
