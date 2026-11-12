import { addDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignNoteCollection,
  CHARACTER_NOTES_TABLE,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

async function addSupabaseNote(
  characterId: string,
  order: number,
  shared?: boolean
): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_NOTES_TABLE)
    .insert({
      character_id: characterId,
      sort_order: order,
      title: "New Page",
      shared: shared ?? false,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to add note.");
  }
  return (data as { id: string }).id;
}

export const addNote = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    order: number;
    shared?: boolean;
  },
  string
>(async (params) => {
  const { campaignId, characterId, order, shared } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either character or campaign ID must be defined");
  }

  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (!characterId) {
    const doc = await addDoc(getCampaignNoteCollection(campaignId as string), {
      order,
      title: "New Page",
      shared: shared ?? false,
    });
    return doc.id;
  }
  return addSupabaseNote(characterId, order, shared);
}, "Failed to add note.");
