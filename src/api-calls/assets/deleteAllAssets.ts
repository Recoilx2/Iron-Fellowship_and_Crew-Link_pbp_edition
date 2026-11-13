import { getSupabaseClient } from "config/supabase.config";
import {
  CAMPAIGN_ASSETS_TABLE,
  CHARACTER_ASSETS_TABLE,
} from "./_getRef";
import { removeAsset } from "./removeAsset";
import { createApiFunction } from "api-calls/createApiFunction";

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
  if (campaignId) {
    const { data, error } = await getSupabaseClient()
      .from(CAMPAIGN_ASSETS_TABLE)
      .select("id")
      .eq("campaign_id", campaignId);
    if (error) {
      throw error;
    }
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    await Promise.all(
      ids.map((assetId) => removeAsset({ campaignId, assetId }))
    );
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  await deleteAllSupabaseAssets(characterId);
}, "Failed to delete some or all assets.");
