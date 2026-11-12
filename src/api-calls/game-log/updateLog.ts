import { createApiFunction } from "api-calls/createApiFunction";
import { Timestamp, updateDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Roll } from "types/DieRolls.type";
import {
  getCampaignGameLogDocument,
  CHARACTER_ROLLS_TABLE,
  characterRollToColumns,
} from "./_getRef";

export const updateLog = createApiFunction<
  { campaignId?: string; characterId?: string; logId: string; log: Roll },
  void
>(async (params) => {
  const { campaignId, characterId, logId, log } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Campaign rolls belong to the chat spec and stay on Firebase until then.
  if (campaignId) {
    await updateDoc(getCampaignGameLogDocument(campaignId as string, logId), {
      ...log,
      timestamp: Timestamp.fromDate(log.timestamp),
    });
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  const client = getSupabaseClient();
  const { data: existing, error: fetchError } = await client
    .from(CHARACTER_ROLLS_TABLE)
    .select("id")
    .eq("id", logId)
    .eq("character_id", characterId)
    .single();
  if (fetchError || !existing) {
    throw fetchError ?? new Error("Roll not found");
  }
  const { data, error } = await client
    .from(CHARACTER_ROLLS_TABLE)
    .update(characterRollToColumns(characterId, log))
    .eq("id", logId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Roll not found");
  }
}, "Failed to update roll.");
