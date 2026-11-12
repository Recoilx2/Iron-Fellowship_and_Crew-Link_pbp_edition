import { getSupabaseClient } from "config/supabase.config";
import { DocumentUpdate } from "api-calls/helpers.type";
import { CharacterDocument } from "./_character.type";
import {
  CHARACTERS_TABLE,
  characterUpdateToColumns,
  type CharacterRow,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

interface Params {
  characterId: string;
  character: DocumentUpdate<CharacterDocument>;
}

export const updateCharacter = createApiFunction<Params, void>(
  async (params) => {
    const { characterId, character } = params;
    const client = getSupabaseClient();

    const { data: row, error: fetchError } = await client
      .from(CHARACTERS_TABLE)
      .select("*")
      .eq("id", characterId)
      .single();
    if (fetchError || !row) {
      throw fetchError ?? new Error("Character not found");
    }
    const columns = characterUpdateToColumns(
      row as CharacterRow,
      character
    );
    if (Object.keys(columns).length === 0) {
      return;
    }
    const { error } = await client
      .from(CHARACTERS_TABLE)
      .update(columns)
      .eq("id", characterId);
    if (error) {
      throw error;
    }
  },
  "Failed to update character."
);
