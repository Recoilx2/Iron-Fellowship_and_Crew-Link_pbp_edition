import { getSupabaseClient } from "config/supabase.config";
import { CAMPAIGNS_TABLE, type CampaignRow } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Hides a datasworn asset from players, or shows it again. The hidden lists
 * live on the campaign row, so every member reads the same table state.
 */
export const updateCampaignHiddenAssets = createApiFunction<
  {
    campaignId: string;
    assetId: string;
    isHidden: boolean;
  },
  void
>(async (params) => {
  const { campaignId, assetId, isHidden } = params;
  const client = getSupabaseClient();
  const { data: row, error: fetchError } = await client
    .from(CAMPAIGNS_TABLE)
    .select("hidden_asset_ids")
    .eq("id", campaignId)
    .single();
  if (fetchError || !row) {
    throw fetchError ?? new Error("Campaign not found");
  }
  const current = ((row as unknown as CampaignRow).hidden_asset_ids ??
    []) as string[];
  const next = isHidden
    ? Array.from(new Set([...current, assetId]))
    : current.filter((entry) => entry !== assetId);
  const { data, error } = await client
    .from(CAMPAIGNS_TABLE)
    .update({ hidden_asset_ids: next })
    .eq("id", campaignId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Campaign not found");
  }
}, "Failed to update hidden assets.");
