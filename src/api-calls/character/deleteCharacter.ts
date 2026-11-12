import { createApiFunction } from "api-calls/createApiFunction";
import { removeCharacterFromCampaign } from "api-calls/campaign/removeCharacterFromCampaign";
import { getSupabaseClient } from "config/supabase.config";
import { CHARACTERS_TABLE } from "./_getRef";
import { removePortraitFile } from "./portraitStorage";

export const deleteCharacter = createApiFunction<
  {
    uid: string;
    characterId: string;
    campaignId?: string;
    portraitFilename?: string;
  },
  void
>(async (params) => {
  const { characterId, campaignId, portraitFilename, uid } = params;

  if (campaignId) {
    await removeCharacterFromCampaign({
      uid,
      campaignId,
      characterId,
    });
  }

  if (portraitFilename) {
    await removePortraitFile(uid, characterId, portraitFilename);
  }

  // Assets, tracks, notes, settings and the solo roll log follow the row
  // through ON DELETE CASCADE.
  const { error } = await getSupabaseClient()
    .from(CHARACTERS_TABLE)
    .delete()
    .eq("id", characterId);
  if (error) {
    console.error(error);
    throw error;
  }
}, "Failed to delete character.");
