import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Reads a campaign name before joining, so the invite screen can show which
 * campaign the link points at without opening the campaign itself. Nothing
 * else about the campaign is visible until the invitee joins.
 */
export const previewCampaign = createApiFunction<
  { campaignId: string },
  { id: string; name: string }
>(async (params) => {
  const { data, error } = await getSupabaseClient().rpc("preview_campaign", {
    cid: params.campaignId,
  });
  if (error) {
    throw error;
  }
  const rows = (Array.isArray(data) ? data : []) as Array<{
    id?: unknown;
    name?: unknown;
  }>;
  const row = rows[0];
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") {
    throw new Error("Could not find campaign");
  }
  return { id: row.id, name: row.name };
}, "Failed to load campaign.");
