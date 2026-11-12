import { deleteDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignNoteContentDocument,
  getCampaignNoteDocument,
  CHARACTER_NOTES_TABLE,
} from "./_getRef";
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
    throw new Error("Either character or campaign ID must be defined.");
  }

  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (!characterId) {
    await deleteDoc(
      getCampaignNoteDocument(campaignId as string, noteId)
    );
    await deleteDoc(
      getCampaignNoteContentDocument(campaignId as string, noteId)
    );
    return;
  }
  // The note content row follows through ON DELETE CASCADE.
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_NOTES_TABLE)
    .delete()
    .eq("id", noteId)
    .eq("character_id", characterId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Note not found");
  }
}, "Failed to remove note.");
