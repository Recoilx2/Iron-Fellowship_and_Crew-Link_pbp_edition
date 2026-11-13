import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_SETTINGS_TABLE,
  CAMPAIGN_SETTINGS_TABLE,
  characterSettingsToColumns,
  campaignSettingsToColumns,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";
import { SettingsDocument } from "api-calls/character-campaign-settings/_character-campaign-settings.type";

export const updateSettings = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    settings: Partial<SettingsDocument>;
    useUpdate?: boolean;
  },
  void
>(async (params) => {
  const { campaignId, characterId, settings } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either character or campaign ID must be defined.");
  }

  if (campaignId) {
    const columns = campaignSettingsToColumns(campaignId, settings);
    const { error } = await getSupabaseClient()
      .from(CAMPAIGN_SETTINGS_TABLE)
      .upsert(columns, { onConflict: "campaign_id" });
    if (error) {
      throw error;
    }
    return;
  }
  if (!characterId) {
    throw new Error("Either character or campaign ID must be defined.");
  }
  const columns = characterSettingsToColumns(characterId, settings);
  const { error } = await getSupabaseClient()
    .from(CHARACTER_SETTINGS_TABLE)
    .upsert(columns, { onConflict: "character_id" });
  if (error) {
    throw error;
  }
}, "Failed to update settings.");
