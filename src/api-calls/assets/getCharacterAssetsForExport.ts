import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_ASSETS_TABLE,
  characterAssetRowToDocument,
  type CharacterAssetRow,
} from "./_getRef";
import { AssetDocument } from "./_asset.type";

export interface CharacterAssetExportRecord {
  id: string;
  data: AssetDocument;
}

/**
 * One-shot fetch of a character's assets for export purposes.
 */
export async function getCharacterAssetsForExport(
  characterId: string
): Promise<CharacterAssetExportRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_ASSETS_TABLE)
    .select("*")
    .eq("character_id", characterId);
  if (error) {
    throw error;
  }
  return ((data ?? []) as unknown as CharacterAssetRow[]).map((row) => ({
    id: row.id,
    data: characterAssetRowToDocument(row),
  }));
}
