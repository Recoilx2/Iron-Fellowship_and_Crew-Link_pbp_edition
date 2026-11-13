import { getSupabaseClient } from "config/supabase.config";
import {
  CAMPAIGN_TRACKS_TABLE,
  CHARACTER_TRACKS_TABLE,
  campaignTrackUpdateToColumns,
  characterTrackUpdateToColumns,
  type CampaignTrackRow,
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

  if (campaignId) {
    const client = getSupabaseClient();
    const { data: row, error: fetchError } = await client
      .from(CAMPAIGN_TRACKS_TABLE)
      .select("*")
      .eq("id", trackId)
      .eq("campaign_id", campaignId)
      .single();
    if (fetchError || !row) {
      throw fetchError ?? new Error("Track not found");
    }
    const columns = campaignTrackUpdateToColumns(
      row as CampaignTrackRow,
      track
    );
    if (Object.keys(columns).length === 0) {
      return;
    }
    const { data, error } = await client
      .from(CAMPAIGN_TRACKS_TABLE)
      .update(columns)
      .eq("id", trackId)
      .select("id");
    if (error || !data || data.length === 0) {
      throw error ?? new Error("Track not found");
    }
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
