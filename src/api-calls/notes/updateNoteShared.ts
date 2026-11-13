import { getSupabaseClient } from "config/supabase.config";
import { CHARACTER_NOTES_TABLE, CAMPAIGN_NOTES_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const updateNoteShared = createApiFunction<
  {
    campaignId: string | undefined;
    characterId: string | undefined;
    noteId: string;
    shared: boolean;
  },
  void
>(async (params) => {
  const { campaignId, characterId, noteId, shared } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Unsharing fires the database's access-revoked notification, and the
  // note server closes the connections of everyone who just lost access.
  const table = characterId ? CHARACTER_NOTES_TABLE : CAMPAIGN_NOTES_TABLE;
  const parentColumn = characterId ? "character_id" : "campaign_id";
  const parentId = (characterId ?? campaignId) as string;
  const { data, error } = await getSupabaseClient()
    .from(table)
    .update({ shared })
    .eq("id", noteId)
    .eq(parentColumn, parentId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Note not found");
  }
}, "Failed to update note.");
