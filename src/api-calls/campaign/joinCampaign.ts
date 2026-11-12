import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

export interface JoinedCampaign {
  id: string;
  name: string;
}

function firstRow(data: unknown): JoinedCampaign | null {
  const rows = (Array.isArray(data) ? data : [data]) as Array<{
    id?: unknown;
    name?: unknown;
  }>;
  const row = rows[0];
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") {
    return null;
  }
  return { id: row.id, name: row.name };
}

/**
 * Joins a campaign from its invite link. Anyone holding the link may join
 * as a player -- that is what the link means -- while every campaign table
 * stays members-only. Joining again is a no-op.
 */
export const joinCampaign = createApiFunction<
  { campaignId: string },
  JoinedCampaign
>(async (params) => {
  const { data, error } = await getSupabaseClient().rpc("join_campaign", {
    cid: params.campaignId,
  });
  if (error) {
    throw error;
  }
  const joined = firstRow(data);
  if (!joined) {
    throw new Error("Could not find campaign");
  }
  return joined;
}, "Error joining campaign.");
