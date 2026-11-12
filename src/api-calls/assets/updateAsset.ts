import { UpdateData, updateDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { DocumentUpdate } from "api-calls/helpers.type";
import {
  getCampaignAssetDoc,
  CHARACTER_ASSETS_TABLE,
  characterAssetUpdateToColumns,
  type CharacterAssetRow,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";
import { AssetDocument } from "api-calls/assets/_asset.type";

async function updateSupabaseAsset(
  characterId: string,
  assetId: string,
  asset: DocumentUpdate<AssetDocument>
): Promise<void> {
  const client = getSupabaseClient();
  const { data: row, error: fetchError } = await client
    .from(CHARACTER_ASSETS_TABLE)
    .select("*")
    .eq("id", assetId)
    .eq("character_id", characterId)
    .single();
  if (fetchError || !row) {
    throw fetchError ?? new Error("Asset not found");
  }
  const columns = characterAssetUpdateToColumns(
    row as CharacterAssetRow,
    asset
  );
  if (Object.keys(columns).length === 0) {
    return;
  }
  const { data, error } = await client
    .from(CHARACTER_ASSETS_TABLE)
    .update(columns)
    .eq("id", assetId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Asset not found");
  }
}

export const updateAsset = createApiFunction<
  {
    characterId?: string;
    campaignId?: string;
    assetId: string;
    asset: DocumentUpdate<AssetDocument>;
  },
  void
>(async (params) => {
  const { characterId, campaignId, assetId, asset } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  // Campaign assets stay on Firebase until the campaigns ticket ports them.
  if (!characterId) {
    await updateDoc(
      getCampaignAssetDoc(campaignId as string, assetId),
      asset as UpdateData<AssetDocument>
    );
    return;
  }
  await updateSupabaseAsset(characterId, assetId, asset);
}, "Error updating asset.");
