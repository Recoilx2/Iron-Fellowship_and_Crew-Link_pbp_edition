import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_TRACKS_TABLE,
  CAMPAIGN_TRACKS_TABLE,
  characterTrackToColumns,
  campaignTrackToColumns,
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

  if (campaignId) {
    const { error } = await getSupabaseClient()
      .from(CAMPAIGN_TRACKS_TABLE)
      .insert(campaignTrackToColumns(campaignId, track));
    if (error) {
      throw error;
    }
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
