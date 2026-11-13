import { getSupabaseClient } from "config/supabase.config";
import {
  CAMPAIGN_ASSETS_TABLE,
  CHARACTER_ASSETS_TABLE,
  type CampaignAssetRow,
  type CharacterAssetRow,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

async function updateSupabaseAssetCheckbox(
  assetId: string,
  abilityIndex: number,
  checked: boolean
): Promise<void> {
  const client = getSupabaseClient();
  const { data: row, error: fetchError } = await client
    .from(CHARACTER_ASSETS_TABLE)
    .select("*")
    .eq("id", assetId)
    .single();
  if (fetchError || !row) {
    throw fetchError ?? new Error("Asset not found");
  }
  const enabled = { ...((row as CharacterAssetRow).enabled_abilities ?? {}) };
  enabled[String(abilityIndex)] = checked;
  const { data, error } = await client
    .from(CHARACTER_ASSETS_TABLE)
    .update({ enabled_abilities: enabled })
    .eq("id", assetId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Asset not found");
  }
}

export const updateAssetCheckbox = createApiFunction<
  {
    characterId?: string;
    campaignId?: string;
    assetId: string;
    abilityIndex: number;
    checked: boolean;
  },
  void
>(async (params) => {
  const { characterId, campaignId, assetId, abilityIndex, checked } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  if (campaignId) {
    const client = getSupabaseClient();
    const { data: row, error: fetchError } = await client
      .from(CAMPAIGN_ASSETS_TABLE)
      .select("*")
      .eq("id", assetId)
      .eq("campaign_id", campaignId)
      .single();
    if (fetchError || !row) {
      throw fetchError ?? new Error("Asset not found");
    }
    const enabled = {
      ...((row as CampaignAssetRow).enabled_abilities ?? {}),
    };
    enabled[String(abilityIndex)] = checked;
    const { data, error } = await client
      .from(CAMPAIGN_ASSETS_TABLE)
      .update({ enabled_abilities: enabled })
      .eq("id", assetId)
      .select("id");
    if (error || !data || data.length === 0) {
      throw error ?? new Error("Asset not found");
    }
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  await updateSupabaseAssetCheckbox(assetId, abilityIndex, checked);
}, "Error updating asset ability.");
