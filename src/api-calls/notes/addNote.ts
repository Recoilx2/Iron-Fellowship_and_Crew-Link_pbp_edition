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
  // The id is generated here so the insert needs no RETURNING clause: the
  // notes SELECT policy re-queries its own table, which cannot see a
  // just-inserted row in the same statement, so insert-then-select always
  // fails RLS (#69). The plain INSERT policy compares ownership directly
  // and accepts the row.
  const id = crypto.randomUUID();
  const { error } = await getSupabaseClient()
    .from(CHARACTER_NOTES_TABLE)
    .insert({
      id,
      character_id: characterId,
      sort_order: order,
      title: "New Page",
      shared: shared ?? false,
    });
  if (error) {
    throw error;
  }
  return id;
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
