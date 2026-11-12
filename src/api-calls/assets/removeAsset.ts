import { getSupabaseClient } from "config/supabase.config";
import {
  CAMPAIGN_ASSETS_TABLE,
  CHARACTER_ASSETS_TABLE,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

async function removeSupabaseAsset(assetId: string): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_ASSETS_TABLE)
    .delete()
    .eq("id", assetId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Asset not found");
  }
}

export const removeAsset = createApiFunction<
  {
    characterId?: string;
    campaignId?: string;
    assetId: string;
  },
  void
>(async (params) => {
  const { characterId, campaignId, assetId } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined");
  }
  if (campaignId) {
    const { data, error } = await getSupabaseClient()
      .from(CAMPAIGN_ASSETS_TABLE)
      .delete()
      .eq("id", assetId)
      .select("id");
    if (error || !data || data.length === 0) {
      throw error ?? new Error("Asset not found");
    }
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined");
  }
  await removeSupabaseAsset(assetId);
}, "Error removing asset");
