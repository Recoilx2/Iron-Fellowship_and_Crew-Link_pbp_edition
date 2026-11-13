import { updateCampaign } from "./updateCampaign";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Points a campaign at a world. Only the campaign row changes here; the
 * world's access rules pick the link up through private.is_world_gm, so
 * campaign GMs manage linked worlds with no further writes.
 */
export const updateCampaignWorld = createApiFunction<
  { campaignId: string; gmIds: string[]; worldId?: string },
  void
>(async (params) => {
  const { campaignId, worldId } = params;
  await updateCampaign({ campaignId, campaign: { worldId } });
}, "Failed to update campaign world.");
