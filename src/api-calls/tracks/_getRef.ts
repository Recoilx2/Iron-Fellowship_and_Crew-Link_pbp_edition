import { firestore } from "config/firebase.config";
import {
  collection,
  CollectionReference,
  doc,
  DocumentReference,
  Timestamp,
} from "firebase/firestore";
import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";
import { Track } from "types/Track.type";
import { TrackDocument } from "./_track.type";

export function constructCampaignTracksCollection(campaignId: string) {
  return `/campaigns/${campaignId}/tracks`;
}
export function constructCampaignTracksDocPath(
  campaignId: string,
  trackId: string
) {
  return `/campaigns/${campaignId}/tracks/${trackId}`;
}

export function getCampaignTracksCollection(campaignId: string) {
  return collection(
    firestore,
    constructCampaignTracksCollection(campaignId)
  ) as CollectionReference<TrackDocument>;
}
export function getCampaignTracksDoc(campaignId: string, trackId: string) {
  return doc(
    firestore,
    constructCampaignTracksDocPath(campaignId, trackId)
  ) as DocumentReference<TrackDocument>;
}

export function constructCharacterTracksCollection(characterId: string) {
  return `/characters/${characterId}/tracks`;
}
export function constructCharacterTracksDocPath(
  characterId: string,
  trackId: string
) {
  return `/characters/${characterId}/tracks/${trackId}`;
}

export function getCharacterTracksCollection(characterId: string) {
  return collection(
    firestore,
    constructCharacterTracksCollection(characterId)
  ) as CollectionReference<TrackDocument>;
}
export function getCharacterTracksDoc(characterId: string, trackId: string) {
  return doc(
    firestore,
    constructCharacterTracksDocPath(characterId, trackId)
  ) as DocumentReference<TrackDocument>;
}

export function convertToDatabase(track: Track): TrackDocument {
  const { createdDate, ...rest } = track;

  return {
    ...rest,
    createdTimestamp: Timestamp.fromDate(createdDate),
  } as TrackDocument;
}

export function convertFromDatabase(track: TrackDocument): Track {
  const { createdTimestamp, ...rest } = track;

  return {
    ...rest,
    createdDate: createdTimestamp.toDate(),
  };
}

// ---------------------------------------------------------------------------
// Supabase (character scope). Campaign tracks stay on Firebase until the
// campaigns ticket ports them.
// ---------------------------------------------------------------------------

export const CHARACTER_TRACKS_TABLE = "character_tracks";

export interface CharacterTrackRow {
  id: string;
  character_id: string;
  label: string;
  type: string;
  description: string;
  value: number;
  status: string;
  difficulty: string | null;
  segments: number | null;
  segments_filled: number | null;
  oracle_key: string | null;
  created_date: string;
  created_at: string;
  updated_at: string;
}

export function constructCharacterTracksChannelName(
  characterId: string
): string {
  return `character-tracks:${characterId}`;
}

export function constructCharacterTracksFilter(characterId: string): string {
  return `character_id=eq.${characterId}`;
}

export function characterTrackRowToTrack(row: CharacterTrackRow): Track {
  const base = {
    label: row.label,
    type: row.type,
    value: row.value,
    status: row.status,
    createdDate: new Date(row.created_date),
    ...(row.description ? { description: row.description } : {}),
  };
  if (row.type === "clock") {
    return {
      ...base,
      segments: row.segments ?? 0,
      ...(row.oracle_key ? { oracleKey: row.oracle_key } : {}),
    } as unknown as Track;
  }
  if (row.type === "sceneChallenge") {
    return {
      ...base,
      segmentsFilled: row.segments_filled ?? 0,
      difficulty: row.difficulty,
    } as unknown as Track;
  }
  return {
    ...base,
    difficulty: row.difficulty,
  } as unknown as Track;
}

export function characterTrackToColumns(
  characterId: string,
  track: Track
): Record<string, unknown> {
  return {
    character_id: characterId,
    label: track.label,
    type: track.type,
    description: track.description ?? "",
    value: track.value,
    status: track.status,
    difficulty: "difficulty" in track ? track.difficulty ?? null : null,
    segments: "segments" in track ? track.segments ?? null : null,
    segments_filled:
      "segmentsFilled" in track ? track.segmentsFilled ?? null : null,
    oracle_key: "oracleKey" in track ? track.oracleKey ?? null : null,
    created_date: track.createdDate.toISOString(),
  };
}

const characterTrackFieldToColumn: Record<string, string> = {
  label: "label",
  type: "type",
  description: "description",
  value: "value",
  status: "status",
  difficulty: "difficulty",
  segments: "segments",
  segmentsFilled: "segments_filled",
  oracleKey: "oracle_key",
  createdDate: "created_date",
};

export function characterTrackUpdateToColumns(
  row: CharacterTrackRow,
  track: Partial<Track>
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    label: row.label,
    type: row.type,
    description: row.description,
    value: row.value,
    status: row.status,
    difficulty: row.difficulty,
    segments: row.segments,
    segmentsFilled: row.segments_filled,
    oracleKey: row.oracle_key,
    createdDate: row.created_date,
  };
  const update: Record<string, unknown> = { ...(track as Record<string, unknown>) };
  if (update.createdDate instanceof Date) {
    update.createdDate = update.createdDate.toISOString();
  }
  const merged = applyDocumentUpdate(base, update);
  const touched = new Set(Object.keys(update).map((path) => path.split(".")[0]));
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(characterTrackFieldToColumn)) {
    if (touched.has(field)) {
      columns[column] = merged[field] ?? null;
    }
  }
  return columns;
}

export function characterTrackPayloadToChange(
  payload: PostgresChangePayload<CharacterTrackRow>
): RowChange<CharacterTrackRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CharacterTrackRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CharacterTrackRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CharacterTrackRow }
    : null;
}
