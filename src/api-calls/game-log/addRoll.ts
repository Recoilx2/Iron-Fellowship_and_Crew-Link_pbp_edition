import { createApiFunction } from "api-calls/createApiFunction";
import { getSupabaseClient } from "config/supabase.config";
import { Roll } from "types/DieRolls.type";
import {
  CHARACTER_ROLLS_TABLE,
  CAMPAIGN_ROLLS_TABLE,
  characterRollToColumns,
  campaignRollToColumns,
} from "./_getRef";

export const addRoll = createApiFunction<
  { roll: Roll; campaignId?: string; characterId?: string },
  string
>(async (params) => {
  const { characterId, campaignId, roll } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  if (campaignId) {
    const { data, error } = await getSupabaseClient()
      .from(CAMPAIGN_ROLLS_TABLE)
      .insert(campaignRollToColumns(campaignId, roll))
      .select("id")
      .single();
    if (error || !data) {
      throw error ?? new Error("Failed to add roll to log.");
    }
    return (data as { id: string }).id;
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
