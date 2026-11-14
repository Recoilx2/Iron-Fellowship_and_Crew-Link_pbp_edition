import { createApiFunction } from "api-calls/createApiFunction";
import { getSupabaseClient } from "config/supabase.config";
import { Roll } from "types/DieRolls.type";
import {
  CHARACTER_ROLLS_TABLE,
  characterRollToColumns,
} from "./_getRef";

// Solo characters keep their own roll log here. Rolls made in a campaign
// no longer come through this function: they post to the campaign's
// starting IC channel as chat roll posts (ticket #30).
export const addRoll = createApiFunction<
  { roll: Roll; characterId: string },
  string
>(async (params) => {
  const { characterId, roll } = params;

  if (!characterId) {
    throw new Error("A character ID must be defined.");
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
