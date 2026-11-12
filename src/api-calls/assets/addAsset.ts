import { getSupabaseClient } from "config/supabase.config";
import {
  CAMPAIGN_ASSETS_TABLE,
  CHARACTER_ASSETS_TABLE,
  campaignAssetDocumentToColumns,
  characterAssetDocumentToColumns,
} from "./_getRef";
import { AssetDocument } from "api-calls/assets/_asset.type";
import { createApiFunction } from "api-calls/createApiFunction";

interface AddAssetParams {
  campaignId?: string;
  characterId?: string;
  asset: AssetDocument;
}

async function addSupabaseAsset(
  characterId: string,
  asset: AssetDocument
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from(CHARACTER_ASSETS_TABLE)
    .insert(characterAssetDocumentToColumns(characterId, asset));
  if (error) {
    throw error;
  }
}

export const addAsset = createApiFunction<AddAssetParams, void>(
  async (params) => {
    const { characterId, campaignId } = params;
    if (!characterId && !campaignId) {
      throw new Error("Either campaign or character ID must be defined.");
    }
    if (campaignId) {
      const { error } = await getSupabaseClient()
        .from(CAMPAIGN_ASSETS_TABLE)
        .insert(campaignAssetDocumentToColumns(campaignId, params.asset));
      if (error) {
        throw error;
      }
      return;
    }
    if (!characterId) {
      throw new Error("Either campaign or character ID must be defined.");
    }
    await addSupabaseAsset(characterId, params.asset);
  },
  "Error creating your asset"
);
