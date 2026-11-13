import { getSupabaseClient } from "config/supabase.config";
import { CAMPAIGNS_TABLE, type CampaignRow } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Hides a datasworn oracle from players, or shows it again. The hidden
 * lists live on the campaign row, so every member reads the same table
 * state.
 */
export const updateCampaignHiddenOracles = createApiFunction<
  {
    campaignId: string;
    oracleId: string;
    hidden: boolean;
  },
  void
>(async (params) => {
  const { campaignId, oracleId, hidden } = params;
  const client = getSupabaseClient();
  const { data: row, error: fetchError } = await client
    .from(CAMPAIGNS_TABLE)
    .select("hidden_oracle_ids")
    .eq("id", campaignId)
    .single();
  if (fetchError || !row) {
    throw fetchError ?? new Error("Campaign not found");
  }
  const current = ((row as unknown as CampaignRow).hidden_oracle_ids ??
    []) as string[];
  const next = hidden
    ? Array.from(new Set([...current, oracleId]))
    : current.filter((entry) => entry !== oracleId);
  const { data, error } = await client
    .from(CAMPAIGNS_TABLE)
    .update({ hidden_oracle_ids: next })
    .eq("id", campaignId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Campaign not found");
  }
}, "Failed to update hidden oracles.");
