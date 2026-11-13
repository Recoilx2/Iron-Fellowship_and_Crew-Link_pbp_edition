import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  CHARACTER_TRACKS_TABLE,
  CAMPAIGN_TRACKS_TABLE,
  characterTrackPayloadToChange,
  characterTrackRowToTrack,
  campaignTrackPayloadToChange,
  campaignTrackRowToTrack,
  constructCharacterTracksChannelName,
  constructCharacterTracksFilter,
  constructCampaignTracksChannelName,
  constructCampaignTracksFilter,
  type CampaignTrackRow,
  type CharacterTrackRow,
} from "./_getRef";
import { Track, TrackSectionTracks } from "types/Track.type";

export function listenToProgressTracks(
  campaignId: string | undefined,
  characterId: string | undefined,
  status: string,
  addOrUpdateTracks: (tracks: { [trackId: string]: Track }) => void,
  removeTrack: (trackId: string, trackType: TrackSectionTracks) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): PlainUnsubscribe | undefined {
  if (!campaignId && !characterId) {
    throw new Error("Must provide either a character or campaign ID.");
  }
  if (campaignId) {
    return listenToCampaignProgressTracks(
      campaignId,
      status,
      addOrUpdateTracks,
      removeTrack,
      onError
    );
  }
  if (!characterId) {
    throw new Error("Must provide either a character or campaign ID.");
  }
  const client = getSupabaseClient();
  let previous = new Map<string, Track>();
  return listenToRows<CharacterTrackRow>({
    client,
    channelName: constructCharacterTracksChannelName(characterId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHARACTER_TRACKS_TABLE,
        filter: constructCharacterTracksFilter(characterId),
        toChange: characterTrackPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CHARACTER_TRACKS_TABLE)
        .select("*")
        .eq("character_id", characterId)
        .eq("status", status);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterTrackRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      // The channel carries every track on the character; this subscription
      // only follows one status, like the previous per-status queries.
      const current = new Map<string, Track>();
      const changes: { [trackId: string]: Track } = {};
      for (const row of rows) {
        if (row.status !== status) {
          continue;
        }
        const track = characterTrackRowToTrack(row);
        current.set(row.id, track);
        changes[row.id] = track;
      }
      if (Object.keys(changes).length > 0) {
        addOrUpdateTracks(changes);
      }
      for (const [id, track] of previous) {
        if (!current.has(id)) {
          removeTrack(id, track.type);
        }
      }
      previous = current;
    },
    onError,
  });
}

function listenToCampaignProgressTracks(
  campaignId: string,
  status: string,
  addOrUpdateTracks: (tracks: { [trackId: string]: Track }) => void,
  removeTrack: (trackId: string, trackType: TrackSectionTracks) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): PlainUnsubscribe {
  const client = getSupabaseClient();
  let previous = new Map<string, Track>();
  return listenToRows<CampaignTrackRow>({
    client,
    channelName: constructCampaignTracksChannelName(campaignId),
    bindings: [
      {
        type: "postgres_changes",
        table: CAMPAIGN_TRACKS_TABLE,
        filter: constructCampaignTracksFilter(campaignId),
        toChange: campaignTrackPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CAMPAIGN_TRACKS_TABLE)
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("status", status);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CampaignTrackRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      // The channel carries every track on the campaign; this subscription
      // only follows one status, like the previous per-status queries.
      const current = new Map<string, Track>();
      const changes: { [trackId: string]: Track } = {};
      for (const row of rows) {
        if (row.status !== status) {
          continue;
        }
        const track = campaignTrackRowToTrack(row);
        current.set(row.id, track);
        changes[row.id] = track;
      }
      if (Object.keys(changes).length > 0) {
        addOrUpdateTracks(changes);
      }
      for (const [id, track] of previous) {
        if (!current.has(id)) {
          removeTrack(id, track.type);
        }
      }
      previous = current;
    },
    onError,
  });
}
