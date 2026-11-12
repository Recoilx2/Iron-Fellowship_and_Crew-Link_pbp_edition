import { setDoc, updateDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignSettingsDoc,
  CHARACTER_SETTINGS_TABLE,
  characterSettingsToColumns,
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
  const { campaignId, characterId, settings, useUpdate } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either character or campaign ID must be defined.");
  }

  // Campaign settings stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    if (useUpdate) {
      await updateDoc(getCampaignSettingsDoc(campaignId as string), settings);
    } else {
      await setDoc(getCampaignSettingsDoc(campaignId as string), settings, {
        merge: true,
      });
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
