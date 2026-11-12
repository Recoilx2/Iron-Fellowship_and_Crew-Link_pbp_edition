import { updateDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignTracksDoc,
  CHARACTER_TRACKS_TABLE,
  characterTrackUpdateToColumns,
  type CharacterTrackRow,
} from "./_getRef";
import { Track } from "types/Track.type";
import { createApiFunction } from "api-calls/createApiFunction";

export const updateProgressTrack = createApiFunction<
  {
    campaignId?: string;
    characterId?: string;
    trackId: string;
    track: Partial<Track>;
  },
  void
>(async (params) => {
  const { campaignId, characterId, trackId, track } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Campaign tracks stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    await updateDoc(getCampaignTracksDoc(campaignId as string, trackId), track);
    return;
  }
  const client = getSupabaseClient();
  const { data: row, error: fetchError } = await client
    .from(CHARACTER_TRACKS_TABLE)
    .select("*")
    .eq("id", trackId)
    .eq("character_id", characterId)
    .single();
  if (fetchError || !row) {
    throw fetchError ?? new Error("Track not found");
  }
  const columns = characterTrackUpdateToColumns(
    row as CharacterTrackRow,
    track
  );
  if (Object.keys(columns).length === 0) {
    return;
  }
  const { data, error } = await client
    .from(CHARACTER_TRACKS_TABLE)
    .update(columns)
    .eq("id", trackId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Track not found");
  }
}, "Failed to update progress track.");
