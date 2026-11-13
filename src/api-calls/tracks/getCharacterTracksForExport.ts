import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_TRACKS_TABLE,
  characterTrackRowToTrack,
  type CharacterTrackRow,
} from "./_getRef";

export interface CharacterTrackExportRecord {
  id: string;
  data: Record<string, unknown>;
  createdDate?: Date;
}

/**
 * One-shot fetch of a character's progress tracks for export purposes.
 * Track timestamps are converted to plain dates at the edge; legacy
 * documents without a timestamp simply omit `createdDate`.
 */
export async function getCharacterTracksForExport(
  characterId: string
): Promise<CharacterTrackExportRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_TRACKS_TABLE)
    .select("*")
    .eq("character_id", characterId);
  if (error) {
    throw error;
  }
  return ((data ?? []) as unknown as CharacterTrackRow[]).map((row) => {
    const { createdDate, ...rest } = characterTrackRowToTrack(row) as unknown as Record<string, unknown> & {
      createdDate?: Date;
    };
    return {
      id: row.id,
      data: { ...rest },
      ...(createdDate instanceof Date ? { createdDate } : {}),
    };
  });
}
