import { getSupabaseClient } from "config/supabase.config";
import { CHARACTER_NOTES_TABLE, CAMPAIGN_NOTES_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

async function addSupabaseNote(
  table: string,
  parentColumn: string,
  parentId: string,
  order: number,
  shared?: boolean
): Promise<string> {
  // The id is generated here so the insert needs no RETURNING clause: the
  // notes SELECT policy re-queries its own table, which cannot see a
  // just-inserted row in the same statement, so insert-then-select always
  // fails RLS (#69). The plain INSERT policy compares ownership directly
  // and accepts the row. Applies to both character and campaign notes (#20/#21).
  const id = crypto.randomUUID();
  const { error } = await getSupabaseClient()
    .from(table)
    .insert({
      id,
      [parentColumn]: parentId,
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

  if (characterId) {
    return addSupabaseNote(
      CHARACTER_NOTES_TABLE,
      "character_id",
      characterId,
      order,
      shared
    );
  }
  return addSupabaseNote(
    CAMPAIGN_NOTES_TABLE,
    "campaign_id",
    campaignId as string,
    order,
    shared
  );
}, "Failed to add note.");
