import { getDocs } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { removeNote } from "./removeNote";
import {
  getCampaignNoteCollection,
  CHARACTER_NOTES_TABLE,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const deleteNotes = createApiFunction<
  { characterId?: string; campaignId?: string },
  void
>(async ({ campaignId, characterId }) => {
  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (!characterId) {
    const snapshot = await getDocs(
      getCampaignNoteCollection(campaignId as string)
    ).catch(() => {
      throw new Error("Failed to get notes.");
    });
    const noteIds = snapshot.docs.map((doc) => doc.id);
    await Promise.all(
      noteIds.map((noteId) => removeNote({ campaignId, characterId, noteId }))
    );
    return;
  }
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_NOTES_TABLE)
    .select("id")
    .eq("character_id", characterId);
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
