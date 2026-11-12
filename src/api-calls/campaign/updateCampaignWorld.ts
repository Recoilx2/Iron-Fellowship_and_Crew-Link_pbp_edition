import { updateCampaign } from "./updateCampaign";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Points a campaign at a world. Only the campaign row changes here; linking
 * the world's owner list back stays with the worlds ticket, whose tables do
 * not exist yet.
 */
export const updateCampaignWorld = createApiFunction<
  { campaignId: string; gmIds: string[]; worldId?: string },
  void
>(async (params) => {
  const { campaignId, worldId } = params;
  await updateCampaign({ campaignId, campaign: { worldId } });
}, "Failed to update campaign world.");
