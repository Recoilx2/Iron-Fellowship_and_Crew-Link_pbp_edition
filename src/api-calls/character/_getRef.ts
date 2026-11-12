import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import {
  CharacterDocument,
  InitiativeStatus,
} from "api-calls/character/_character.type";
import { DocumentUpdate } from "api-calls/helpers.type";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";

/**
 * Identifiers and row mapping for the characters table. The data layer is the
 * only place that names backend tables and live-update topics; stores, pages
 * and components stay backend-free.
 */

export const CHARACTERS_TABLE = "characters";

export interface CharacterRow {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  world_id: string | null;
  name: string;
  stats: Record<string, number>;
  condition_meters: Record<string, number>;
  initiative_status: string | null;
  momentum: number;
  special_tracks: Record<string, unknown>;
  experience: Record<string, unknown>;
  debilities: Record<string, boolean>;
  adds: number | null;
  profile_image: {
    filename: string;
    position: { x: number; y: number };
    scale: number;
  } | null;
  expansion_ids: string[];
  custom_tracks: Record<string, number>;
  theme: string | null;
  created_at: string;
  updated_at: string;
}

export function constructCharactersChannelName(ownerId: string): string {
  return `characters:${ownerId}`;
}

export function constructCharacterChannelName(characterId: string): string {
  return `character:${characterId}`;
}

export function constructCharactersOwnerFilter(ownerId: string): string {
  return `owner_id=eq.${ownerId}`;
}

export function constructCharacterIdFilter(characterId: string): string {
  return `id=eq.${characterId}`;
}

/**
 * Turns a row-streaming event into an upsert or removal keyed by row id.
 * Deletes arrive with the old row (REPLICA IDENTITY FULL), so listeners see
 * removals as well as changes.
 */
export function characterPayloadToChange(
  payload: PostgresChangePayload<CharacterRow>
): RowChange<CharacterRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CharacterRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CharacterRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CharacterRow }
    : null;
}

export function characterRowToDocument(row: CharacterRow): CharacterDocument {
  return {
    uid: row.owner_id,
    ...(row.campaign_id ? { campaignId: row.campaign_id } : {}),
    ...(row.world_id ? { worldId: row.world_id } : {}),
    name: row.name,
    stats: row.stats ?? {},
    ...(row.condition_meters &&
    Object.keys(row.condition_meters).length > 0
      ? { conditionMeters: row.condition_meters }
      : {}),
    ...(row.initiative_status
      ? {
          initiativeStatus:
            row.initiative_status as unknown as InitiativeStatus,
        }
      : {}),
    momentum: row.momentum,
    ...(row.special_tracks && Object.keys(row.special_tracks).length > 0
      ? {
          specialTracks:
            row.special_tracks as CharacterDocument["specialTracks"],
        }
      : {}),
    ...(row.experience && Object.keys(row.experience).length > 0
      ? { experience: row.experience as CharacterDocument["experience"] }
      : {}),
    ...(row.debilities && Object.keys(row.debilities).length > 0
      ? { debilities: row.debilities }
      : {}),
    ...(row.adds !== null && row.adds !== undefined
      ? { adds: row.adds }
      : {}),
    ...(row.profile_image ? { profileImage: row.profile_image } : {}),
    ...(row.expansion_ids && row.expansion_ids.length > 0
      ? { expansionIds: row.expansion_ids }
      : {}),
    ...(row.custom_tracks && Object.keys(row.custom_tracks).length > 0
      ? { customTracks: row.custom_tracks }
      : {}),
    ...(row.theme ? { theme: row.theme as CharacterDocument["theme"] } : {}),
  };
}

const documentFieldToColumn: Record<string, string> = {
  uid: "owner_id",
  campaignId: "campaign_id",
  worldId: "world_id",
  name: "name",
  stats: "stats",
  conditionMeters: "condition_meters",
  initiativeStatus: "initiative_status",
  momentum: "momentum",
  specialTracks: "special_tracks",
  experience: "experience",
  debilities: "debilities",
  adds: "adds",
  profileImage: "profile_image",
  expansionIds: "expansion_ids",
  customTracks: "custom_tracks",
  theme: "theme",
};

/**
 * Converts an app-level character update into row columns, merging
 * dotted-path updates over the current row so no sibling data is lost.
 */
export function characterUpdateToColumns(
  row: CharacterRow,
  update: DocumentUpdate<CharacterDocument>
): Record<string, unknown> {
  const rowByDocumentField: Record<string, unknown> = {
    uid: row.owner_id,
    campaignId: row.campaign_id,
    worldId: row.world_id,
    name: row.name,
    stats: row.stats,
    conditionMeters: row.condition_meters,
    initiativeStatus: row.initiative_status,
    momentum: row.momentum,
    specialTracks: row.special_tracks,
    experience: row.experience,
    debilities: row.debilities,
    adds: row.adds,
    profileImage: row.profile_image,
    expansionIds: row.expansion_ids,
    customTracks: row.custom_tracks,
    theme: row.theme,
  };
  const merged = applyDocumentUpdate(
    rowByDocumentField,
    update as Record<string, unknown>
  );
  const touched = new Set(
    Object.keys(update as Record<string, unknown>).map((path) =>
      path.split(".")[0]
    )
  );
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(documentFieldToColumn)) {
    if (touched.has(field)) {
      columns[column] = merged[field] ?? null;
    }
  }
  return columns;
}
