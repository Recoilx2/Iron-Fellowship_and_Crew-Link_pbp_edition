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
  // through ON DELETE CASCADE. The RETURNING check reads the row back
  // through the SELECT policy, which sees the pre-existing committed row,
  // so rejecting on an empty return tells strangers their delete matched
  // nothing instead of resolving silently.
  const { data: deleted, error } = await getSupabaseClient()
    .from(CHARACTERS_TABLE)
    .delete()
    .eq("id", characterId)
    .select("id");
  if (error || !deleted || deleted.length === 0) {
    console.error(error);
    throw error ?? new Error("Character not found");
  }
}, "Failed to delete character.");
