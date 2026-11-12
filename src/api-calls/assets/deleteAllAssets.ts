import { deleteDoc, getDocs } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignAssetCollection,
  getCampaignAssetDoc,
  CHARACTER_ASSETS_TABLE,
} from "./_getRef";
import { removeAsset } from "./removeAsset";
import { createApiFunction } from "api-calls/createApiFunction";

function getAllFirebaseAssets(campaignId: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    getDocs(getCampaignAssetCollection(campaignId))
      .then((snapshot) => {
        const ids = snapshot.docs.map((doc) => doc.id);
        resolve(ids);
      })
      .catch(() => {
        reject("Failed to get assets.");
      });
  });
}

async function deleteAllSupabaseAssets(characterId: string): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_ASSETS_TABLE)
    .select("id")
    .eq("character_id", characterId);
  if (error) {
    throw error;
  }
  const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  await Promise.all(
    ids.map((assetId) => removeAsset({ characterId, assetId }))
  );
}

export const deleteAllAssets = createApiFunction<
  { characterId?: string; campaignId?: string },
  void
>(async ({ campaignId, characterId }) => {
  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  // Campaign assets stay on Firebase until the campaigns ticket ports them.
  if (!characterId) {
    const assetIds = await getAllFirebaseAssets(campaignId as string);
    await Promise.all(
      assetIds.map((assetId) =>
        deleteDoc(getCampaignAssetDoc(campaignId as string, assetId))
      )
    );
    return;
  }
  await deleteAllSupabaseAssets(characterId);
}, "Failed to delete some or all assets.");
