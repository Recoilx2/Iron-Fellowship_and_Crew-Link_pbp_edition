import { getSupabaseClient } from "config/supabase.config";
import { CHARACTER_NOTES_TABLE, CAMPAIGN_NOTES_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const updateNoteOrder = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    noteId: string;
    order: number;
  },
  void
>(async (params) => {
  const { campaignId, characterId, noteId, order } = params;

  if (!characterId && !campaignId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  const table = characterId ? CHARACTER_NOTES_TABLE : CAMPAIGN_NOTES_TABLE;
  const parentColumn = characterId ? "character_id" : "campaign_id";
  const parentId = (characterId ?? campaignId) as string;
  const { data, error } = await getSupabaseClient()
    .from(table)
    .update({ sort_order: order })
    .eq("id", noteId)
    .eq(parentColumn, parentId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Note not found");
  }
}, "Failed to reorder note.");
