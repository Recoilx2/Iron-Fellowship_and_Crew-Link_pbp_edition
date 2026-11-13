import { getSupabaseClient } from "config/supabase.config";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Creates a campaign with the caller in its roster: co-op founders start as
 * GMs, solo and guided founders as players. The invite link is the campaign
 * sheet URL; joining goes through joinCampaign.
 */
export const createCampaign = createApiFunction<
  { uid: string; campaignName: string; campaignType: CampaignType },
  string
>(async (params) => {
  const { campaignName, campaignType } = params;
  const { data, error } = await getSupabaseClient().rpc("create_campaign", {
    cname: campaignName,
    ctype: campaignType,
  });
  if (error || !data) {
    throw error ?? new Error("Failed to create campaign.");
  }
  const id = Array.isArray(data) ? data[0] : data;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Failed to create campaign.");
  }
  return id;
}, "Error creating campaign.");
