import { getSupabaseClient } from "config/supabase.config";
import { CharacterDocument } from "./_character.type";
import { CHARACTERS_TABLE, characterRowToDocument } from "./_getRef";

/**
 * One-shot fetch of a character document for export purposes.
 * Returns null when the document does not exist or is not visible.
 */
export async function getCharacterForExport(
  characterId: string
): Promise<{ id: string; data: CharacterDocument } | null> {
  const { data, error } = await getSupabaseClient()
    .from(CHARACTERS_TABLE)
    .select("*")
    .eq("id", characterId)
    .single();
  if (error || !data) {
    return null;
  }
  return {
    id: (data as { id: string }).id,
    data: characterRowToDocument(data as never),
  };
}
