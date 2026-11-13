import { getSupabaseClient } from "config/supabase.config";
import { CHARACTER_NOTES_TABLE, CAMPAIGN_NOTES_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Saves the note title. The editor bytes live on the note server
 * (Hocuspocus), which reads and writes the content rows directly: the
 * client never writes them, so solo edits cannot clobber a merged document.
 */
async function updateSupabaseNote(
  table: string,
  parentColumn: string,
  parentId: string,
  noteId: string,
  title: string
): Promise<void> {
  const client = getSupabaseClient();
  const { data: updated, error: titleError } = await client
    .from(table)
    .update({ title })
    .eq("id", noteId)
    .eq(parentColumn, parentId)
    .select("id");
  if (titleError || !updated || updated.length === 0) {
    throw titleError ?? new Error("Note not found");
  }
}

export const updateNote = createApiFunction<
  {
    campaignId: string | undefined;
    characterId: string | undefined;
    noteId: string;
    title: string;
    // Accepted for the editor's save flow but ignored: the note server owns
    // the bytes, so content snapshots and beacon retries would only race it.
    content?: Uint8Array;
    isBeaconRequest?: boolean;
  },
  void
>(async (params) => {
  const { campaignId, characterId, noteId, title } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  if (characterId) {
    return updateSupabaseNote(
      CHARACTER_NOTES_TABLE,
      "character_id",
      characterId,
      noteId,
      title
    );
  }
  return updateSupabaseNote(
    CAMPAIGN_NOTES_TABLE,
    "campaign_id",
    campaignId as string,
    noteId,
    title
  );
}, "Failed to update note.");
