import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_ROLLS_TABLE,
} from "./_getRef";
import { removeLog } from "./removeLog";
import { createApiFunction } from "api-calls/createApiFunction";

export const deleteAllLogs = createApiFunction<
  { characterId?: string; campaignId?: string },
  void
>(async ({ campaignId, characterId }) => {
  if (!campaignId && !characterId) {
    throw new Error("Either character or campaign ID must be defined.");
  }
  // A campaign's rolls live as chat roll posts: take the posts back from
  // chat instead of clearing a log (ticket #30).
  if (campaignId) {
    throw new Error(
      "Campaign rolls are chat posts: delete the posts from chat instead."
    );
  }
  if (!characterId) {
    throw new Error("Either character or campaign ID must be defined.");
  }
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_ROLLS_TABLE)
    .select("id")
    .eq("character_id", characterId);
  if (error) {
    throw error;
  }
  const logIds = ((data ?? []) as Array<{ id: string }>).map(
    (row) => row.id
  );
  await Promise.all(
    logIds.map((logId) => removeLog({ campaignId, characterId, logId }))
  );
}, "Failed to delete some or all logs.");
