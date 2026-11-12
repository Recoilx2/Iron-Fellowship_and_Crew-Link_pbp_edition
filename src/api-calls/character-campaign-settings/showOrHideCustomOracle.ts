import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_SETTINGS_TABLE,
  CAMPAIGN_SETTINGS_TABLE,
  characterSettingsRowToDocument,
  campaignSettingsRowToDocument,
  type CampaignSettingsRow,
  type CharacterSettingsRow,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const showOrHideCustomOracle = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    oracleId: string;
    hidden: boolean;
  },
  void
>(async (params) => {
  const { campaignId, characterId, oracleId, hidden } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Campaign settings hide one id in an array column: read the row, toggle
  // the id, and write it back. Reads and writes both pass the members-only
  // access rules.
  if (campaignId) {
    const client = getSupabaseClient();
    const { data, error: fetchError } = await client
      .from(CAMPAIGN_SETTINGS_TABLE)
      .select("*")
      .eq("campaign_id", campaignId)
      .single();
    if (fetchError && fetchError.code !== "PGRST116") {
      throw fetchError;
    }
    const current = campaignSettingsRowToDocument(
      (data ?? null) as unknown as CampaignSettingsRow | null
    );
    const next = hidden
      ? Array.from(new Set([...current.hiddenCustomOraclesIds, oracleId]))
      : current.hiddenCustomOraclesIds.filter((entry) => entry !== oracleId);
    const { error } = await client
      .from(CAMPAIGN_SETTINGS_TABLE)
      .upsert(
        { campaign_id: campaignId, hidden_custom_oracle_ids: next },
        { onConflict: "campaign_id" }
      );
    if (error) {
      throw error;
    }
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  const client = getSupabaseClient();
  const { data, error: fetchError } = await client
    .from(CHARACTER_SETTINGS_TABLE)
    .select("*")
    .eq("character_id", characterId)
    .single();
  if (fetchError && fetchError.code !== "PGRST116") {
    throw fetchError;
  }
  const current = characterSettingsRowToDocument(
    (data ?? null) as unknown as CharacterSettingsRow | null
  );
  const next = hidden
    ? Array.from(new Set([...current.hiddenCustomOraclesIds, oracleId]))
    : current.hiddenCustomOraclesIds.filter((entry) => entry !== oracleId);
  const { error } = await client.from(CHARACTER_SETTINGS_TABLE).upsert(
    { character_id: characterId, hidden_custom_oracle_ids: next },
    { onConflict: "character_id" }
  );
  if (error) {
    throw error;
  }
}, "Failed to update visibility of custom oracle.");
