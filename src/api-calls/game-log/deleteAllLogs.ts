import { getDocs } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignGameLogCollection,
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
  // Campaign rolls belong to the chat spec and stay on Firebase until then.
  if (campaignId) {
    const snapshot = await getDocs(
      getCampaignGameLogCollection(campaignId as string)
    ).catch(() => {
      throw new Error("Failed to get game logs.");
    });
    const logIds = snapshot.docs.map((doc) => doc.id);
    await Promise.all(
      logIds.map((logId) => removeLog({ campaignId, characterId, logId }))
    );
    return;
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
