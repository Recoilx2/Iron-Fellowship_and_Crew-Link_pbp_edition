import { updateDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignNoteDocument,
  CHARACTER_NOTES_TABLE,
} from "./_getRef";
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

  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (!characterId) {
    await updateDoc(getCampaignNoteDocument(campaignId as string, noteId), {
      shared,
    });
    return;
  }
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_NOTES_TABLE)
    .update({ shared })
    .eq("id", noteId)
    .eq("character_id", characterId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Note not found");
  }
}, "Failed to update note.");
