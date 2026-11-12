import { deleteDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignAssetDoc,
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
    throw new Error("Either character or campaign ID must be defined");
  }
  // Campaign assets stay on Firebase until the campaigns ticket ports them.
  if (!characterId) {
    await deleteDoc(getCampaignAssetDoc(campaignId as string, assetId));
    return;
  }
  await removeSupabaseAsset(assetId);
}, "Error removing asset");
