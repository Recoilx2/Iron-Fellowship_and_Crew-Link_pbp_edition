import { getSupabaseClient } from "config/supabase.config";
import { removeNote } from "./removeNote";
import { CHARACTER_NOTES_TABLE, CAMPAIGN_NOTES_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const deleteNotes = createApiFunction<
  { characterId?: string; campaignId?: string },
  void
>(async ({ campaignId, characterId }) => {
  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  // Deleting a note fires the database's access-revoked notification, so
  // the note server closes its connected editors too.
  const table = characterId ? CHARACTER_NOTES_TABLE : CAMPAIGN_NOTES_TABLE;
  const parentColumn = characterId ? "character_id" : "campaign_id";
  const parentId = (characterId ?? campaignId) as string;
  const { data, error } = await getSupabaseClient()
    .from(table)
    .select("id")
    .eq(parentColumn, parentId);
  if (error) {
    throw error;
  }
  const noteIds = ((data ?? []) as Array<{ id: string }>).map(
    (row) => row.id
  );
  await Promise.all(
    noteIds.map((noteId) => removeNote({ campaignId, characterId, noteId }))
  );
}, "Failed to delete some or all notes.");
