import { addDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignAssetCollection,
  CHARACTER_ASSETS_TABLE,
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

function addFirebaseAsset(params: AddAssetParams): Promise<void> {
  const { campaignId, asset } = params;
  return new Promise((resolve, reject) => {
    addDoc(getCampaignAssetCollection(campaignId as string), asset)
      .then(() => {
        resolve();
      })
      .catch((e) => {
        reject(e);
      });
  });
}

export const addAsset = createApiFunction<AddAssetParams, void>(
  async (params) => {
    const { characterId, campaignId } = params;
    if (!characterId && !campaignId) {
      throw new Error("Either campaign or character ID must be defined.");
    }
    // Campaign assets stay on Firebase until the campaigns ticket ports them.
    if (!characterId) {
      return addFirebaseAsset(params);
    }
    await addSupabaseAsset(characterId, params.asset);
  },
  "Error creating your asset"
);
