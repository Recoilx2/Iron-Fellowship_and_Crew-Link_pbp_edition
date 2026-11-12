import { createApiFunction } from "api-calls/createApiFunction";
import { addDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Roll } from "types/DieRolls.type";
import {
  convertRollToGameLogDocument,
  getCampaignGameLogCollection,
  CHARACTER_ROLLS_TABLE,
  characterRollToColumns,
} from "./_getRef";

export const addRoll = createApiFunction<
  { roll: Roll; campaignId?: string; characterId?: string },
  string
>(async (params) => {
  const { characterId, campaignId, roll } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Campaign rolls belong to the chat spec and stay on Firebase until then.
  if (campaignId) {
    const doc = await addDoc(
      getCampaignGameLogCollection(campaignId as string),
      convertRollToGameLogDocument(roll)
    );
    return doc.id;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_ROLLS_TABLE)
    .insert(characterRollToColumns(characterId, roll))
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to add roll to log.");
  }
  return (data as { id: string }).id;
}, "Failed to add roll to log.");
