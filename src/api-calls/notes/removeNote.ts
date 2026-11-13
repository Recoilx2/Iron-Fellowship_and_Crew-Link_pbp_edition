import { getSupabaseClient } from "config/supabase.config";
import { CHARACTER_NOTES_TABLE, CAMPAIGN_NOTES_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const removeNote = createApiFunction<
  {
    characterId?: string;
    campaignId?: string;
    noteId: string;
  },
  void
>(async (params) => {
  const { campaignId, characterId, noteId } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // The note content row follows through ON DELETE CASCADE. Deleting fires
  // the database's access-revoked notification, so the note server closes
  // the deleted note's connected editors too.
  const table = characterId ? CHARACTER_NOTES_TABLE : CAMPAIGN_NOTES_TABLE;
  const parentColumn = characterId ? "character_id" : "campaign_id";
  const parentId = (characterId ?? campaignId) as string;
  const { data, error } = await getSupabaseClient()
    .from(table)
    .delete()
    .eq("id", noteId)
    .eq(parentColumn, parentId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Note not found");
  }
}, "Failed to remove note.");
