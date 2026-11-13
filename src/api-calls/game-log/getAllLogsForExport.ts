import { getSupabaseClient } from "config/supabase.config";
import { fetchCampaignRollPosts } from "api-calls/chat/listenToCampaignRollPosts";
import {
  CHARACTER_ROLLS_TABLE,
  characterRollRowToExportRecord,
  type CharacterRollRow,
} from "./_getRef";

export interface GameLogExportRecord {
  id: string;
  roll: Record<string, unknown>;
}

export async function getAllLogsForExport(params: {
  campaignId?: string;
  characterId?: string;
  isGM: boolean;
}): Promise<GameLogExportRecord[]> {
  const { campaignId, characterId, isGM } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaignId or characterId must be defined.");
  }

  // A campaign's log exports its chat roll posts, oldest first (ticket
  // #30). The database refuses GM-only rows to non-GMs; the explicit
  // filter keeps the export's intent obvious either way.
  if (!characterId || campaignId) {
    const { posts } = await fetchCampaignRollPosts(
      getSupabaseClient(),
      (campaignId ?? characterId) as string,
      { ascending: true, isGM }
    );
    return posts.map((row) => ({ id: row.id, roll: { ...row.roll } }));
  }

  let rowsQuery = getSupabaseClient()
    .from(CHARACTER_ROLLS_TABLE)
    .select("*")
    .eq("character_id", characterId)
    .order("created_at", { ascending: true });
  if (!isGM) {
    rowsQuery = rowsQuery.eq("gms_only", false);
  }
  const { data, error } = await rowsQuery;
  if (error) {
    throw error;
  }
  return ((data ?? []) as unknown as CharacterRollRow[]).map(
    characterRollRowToExportRecord
  );
}
