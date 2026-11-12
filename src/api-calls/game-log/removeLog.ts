import { createApiFunction } from "api-calls/createApiFunction";
import { deleteDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignGameLogDocument,
  CHARACTER_ROLLS_TABLE,
} from "./_getRef";

export const removeLog = createApiFunction<
  { campaignId?: string; characterId?: string; logId: string },
  void
>(async (params) => {
  const { campaignId, characterId, logId } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Campaign rolls belong to the chat spec and stay on Firebase until then.
  if (campaignId) {
    await deleteDoc(
      getCampaignGameLogDocument(campaignId as string, logId)
    );
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_ROLLS_TABLE)
    .delete()
    .eq("id", logId)
    .eq("character_id", characterId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Roll not found");
  }
}, "Failed to delete roll.");
