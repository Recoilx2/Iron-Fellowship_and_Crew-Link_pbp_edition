import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_ROLLS_TABLE,
  CAMPAIGN_ROLLS_TABLE,
  characterRollRowToExportRecord,
  campaignRollRowToExportRecord,
  type CampaignRollRow,
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

  // Campaign rolls export from the campaign roll log table, oldest first.
  // The database refuses GM-only rows to non-GMs; the explicit filter keeps
  // the export's intent obvious either way.
  if (!characterId || campaignId) {
    let rowsQuery = getSupabaseClient()
      .from(CAMPAIGN_ROLLS_TABLE)
      .select("*")
      .eq("campaign_id", (campaignId ?? characterId) as string)
      .order("created_at", { ascending: true });
    if (!isGM) {
      rowsQuery = rowsQuery.eq("gms_only", false);
    }
    const { data, error } = await rowsQuery;
    if (error) {
      throw error;
    }
    return ((data ?? []) as unknown as CampaignRollRow[]).map(
      campaignRollRowToExportRecord
    );
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
