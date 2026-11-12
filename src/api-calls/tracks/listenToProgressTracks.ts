import { onSnapshot, query, Unsubscribe, where } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  convertFromDatabase,
  getCampaignTracksCollection,
  getCharacterTracksCollection,
  CHARACTER_TRACKS_TABLE,
  characterTrackPayloadToChange,
  characterTrackRowToTrack,
  constructCharacterTracksChannelName,
  constructCharacterTracksFilter,
  type CharacterTrackRow,
} from "./_getRef";
import { Track, TrackSectionTracks } from "types/Track.type";

function listenToFirebaseTracks(
  campaignId: string | undefined,
  characterId: string | undefined,
  status: string,
  addOrUpdateTracks: (tracks: { [trackId: string]: Track }) => void,
  removeTrack: (trackId: string, trackType: TrackSectionTracks) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe | undefined {
  const q = query(
    campaignId
      ? getCampaignTracksCollection(campaignId)
      : getCharacterTracksCollection(characterId as string),
    where("status", "==", status)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const addOrUpdateChanges: { [trackId: string]: Track } = {};

      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          removeTrack(change.doc.id, change.doc.data().type);
        } else {
          addOrUpdateChanges[change.doc.id] = convertFromDatabase(
            change.doc.data()
          );
        }
      });
      addOrUpdateTracks(addOrUpdateChanges);
    },
    (error) => onError(error)
  );
}

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
  // Campaign tracks stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    return listenToFirebaseTracks(
      campaignId,
      characterId,
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
