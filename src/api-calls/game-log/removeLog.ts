import { createApiFunction } from "api-calls/createApiFunction";
import { getSupabaseClient } from "config/supabase.config";
import {
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

  // A campaign's rolls live as chat roll posts: take the post back from
  // chat instead of deleting it from a log (ticket #30).
  if (campaignId) {
    throw new Error(
      "Campaign rolls are chat posts: delete the post from chat instead."
    );
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
