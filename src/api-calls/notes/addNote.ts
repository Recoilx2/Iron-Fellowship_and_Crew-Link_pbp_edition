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
  const { data, error } = await getSupabaseClient()
    .from(table)
    .insert({
      [parentColumn]: parentId,
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
