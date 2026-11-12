import { addDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  convertToDatabase,
  getCampaignTracksCollection,
  CHARACTER_TRACKS_TABLE,
  characterTrackToColumns,
} from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";
import { Track } from "types/Track.type";

export const addProgressTrack = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    track: Track;
  },
  void
>(async (params) => {
  const { campaignId, characterId, track } = params;

  if (!campaignId && !characterId) {
    throw new Error("Must provide either a character or a campaign ID");
  }

  // Campaign tracks stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    const storedTrack = convertToDatabase(track);
    await addDoc(
      getCampaignTracksCollection(campaignId as string),
      storedTrack
    );
    return;
  }
  if (!characterId) {
    throw new Error("Must provide either a character or a campaign ID");
  }
  const { error } = await getSupabaseClient()
    .from(CHARACTER_TRACKS_TABLE)
    .insert(characterTrackToColumns(characterId, track));
  if (error) {
    throw error;
  }
}, "Failed to add progress track.");
