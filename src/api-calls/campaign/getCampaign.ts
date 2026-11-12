import { getSupabaseClient } from "config/supabase.config";
import { CampaignDocument } from "api-calls/campaign/_campaign.type";
import {
  assembleCampaignDocuments,
  CAMPAIGN_MEMBERS_TABLE,
  CAMPAIGNS_TABLE,
  type CampaignCharacterLink,
  type CampaignMemberRow,
  type CampaignRow,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Loads one campaign the caller belongs to, assembled with its roster and
 * character links. Outsiders read nothing, so a missing row and a refused
 * row look the same: the campaign is not found.
 */
export const getCampaign = createApiFunction<string, CampaignDocument>(
  async (campaignId) => {
    const client = getSupabaseClient();
    const { data: auth } = await client.auth.getUser();
    const uid = auth.user?.id ?? "";
    const [campaign, members, characters] = await Promise.all([
      client.from(CAMPAIGNS_TABLE).select("*").eq("id", campaignId),
      client
        .from(CAMPAIGN_MEMBERS_TABLE)
        .select("campaign_id, user_id, role")
        .eq("campaign_id", campaignId),
      client
        .from("characters")
        .select("id, owner_id, campaign_id")
        .eq("campaign_id", campaignId),
    ]);
    if (campaign.error) {
      throw campaign.error;
    }
    if (members.error) {
      throw members.error;
    }
    if (characters.error) {
      throw characters.error;
    }
    const rows = (campaign.data ?? []) as unknown as CampaignRow[];
    const match = assembleCampaignDocuments(
      rows,
      (members.data ?? []) as unknown as CampaignMemberRow[],
      (characters.data ?? []) as unknown as CampaignCharacterLink[],
      uid
    ).find((entry) => entry.id === campaignId);
    if (!match) {
      throw new Error("Could not find campaign");
    }
    return match.doc;
  },
  "Failed to load campaign."
);
