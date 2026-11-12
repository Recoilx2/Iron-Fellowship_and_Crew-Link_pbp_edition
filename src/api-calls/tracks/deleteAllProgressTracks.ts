import { getDocs } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { removeProgressTrack } from "./removeProgressTrack";
import {
  getCampaignTracksCollection,
  CHARACTER_TRACKS_TABLE,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const deleteAllProgressTracks = createApiFunction<
  { characterId?: string; campaignId?: string },
  void
>(async ({ campaignId, characterId }) => {
  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  // Campaign tracks stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    const snapshot = await getDocs(
      getCampaignTracksCollection(campaignId as string)
    ).catch(() => {
      throw new Error("Failed to get tracks.");
    });
    const trackIds = snapshot.docs.map((doc) => doc.id);
    await Promise.all(
      trackIds.map((trackId) =>
        removeProgressTrack({ campaignId, characterId, id: trackId })
      )
    );
    return;
  }
  if (!characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }
  const { data, error } = await getSupabaseClient()
    .from(CHARACTER_TRACKS_TABLE)
    .select("id")
    .eq("character_id", characterId);
  if (error) {
    throw error;
  }
  const trackIds = ((data ?? []) as Array<{ id: string }>).map(
    (row) => row.id
  );
  await Promise.all(
    trackIds.map((trackId) =>
      removeProgressTrack({ campaignId, characterId, id: trackId })
    )
  );
}, "Failed to delete some or all tracks.");
