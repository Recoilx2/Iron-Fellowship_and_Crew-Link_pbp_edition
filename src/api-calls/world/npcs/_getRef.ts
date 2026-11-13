import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";
import { DocumentUpdate } from "api-calls/helpers.type";
import { GMNPC, NPC } from "types/NPCs.type";

/**
 * Identifiers and row mapping for world NPCs and their GM details. The
 * data layer is the only place that names backend tables, live-update
 * channels and the bond RPC; stores, pages and components stay backend-free.
 *
 * Notes (public and GM-only) are not columns here: they are world_notes
 * rows holding Yjs documents on the note server (see worldNotes.ts).
 */

export const WORLD_NPCS_TABLE = "world_npcs";
export const WORLD_NPC_GM_DETAILS_TABLE = "world_npc_gm_details";

export interface NPCRow {
  id: string;
  world_id: string;
  name: string;
  image_filenames: string[];
  icon: Record<string, unknown> | null;
  shared_with_players: boolean;
  pronouns: string | null;
  species: string | null;
  last_location_id: string | null;
  character_connections: Record<string, boolean>;
  character_bonds: Record<string, boolean>;
  character_bond_progress: Record<string, number>;
  rank: string | null;
  callsign: string | null;
  created_at: string;
  updated_at: string;
}

export interface NPCGMDetailsRow {
  npc_id: string;
  goal: string | null;
  role: string | null;
  descriptor: string | null;
  disposition: string | null;
  activity: string | null;
  first_look: string | null;
  revealed_aspect: string | null;
  updated_at: string;
}

export function constructWorldNPCsChannelName(worldId: string): string {
  return `world-npcs:${worldId}`;
}

export function constructWorldNPCsFilter(worldId: string): string {
  return `world_id=eq.${worldId}`;
}

export function constructNPCChannelName(npcId: string): string {
  return `world-npc:${npcId}`;
}

export function constructNPCIdFilter(npcId: string): string {
  return `npc_id=eq.${npcId}`;
}

export function npcPayloadToChange(
  payload: PostgresChangePayload<NPCRow>
): RowChange<NPCRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<NPCRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<NPCRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as NPCRow }
    : null;
}

export function npcGMDetailsPayloadToChange(
  payload: PostgresChangePayload<NPCGMDetailsRow>
): RowChange<NPCGMDetailsRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<NPCGMDetailsRow>;
    return typeof old.npc_id === "string"
      ? { kind: "remove", key: old.npc_id }
      : null;
  }
  const row = payload.new as Partial<NPCGMDetailsRow>;
  return row && typeof row.npc_id === "string"
    ? { kind: "upsert", row: row as NPCGMDetailsRow }
    : null;
}

export function npcRowToDocument(row: NPCRow): NPC {
  return {
    name: row.name,
    ...(row.image_filenames && row.image_filenames.length > 0
      ? { imageFilenames: row.image_filenames }
      : {}),
    ...(row.icon ? { icon: row.icon as unknown as NPC["icon"] } : {}),
    sharedWithPlayers: row.shared_with_players,
    ...(row.pronouns ? { pronouns: row.pronouns } : {}),
    ...(row.species !== null && row.species !== undefined
      ? { species: row.species }
      : {}),
    ...(row.last_location_id ? { lastLocationId: row.last_location_id } : {}),
    ...(row.character_connections &&
    Object.keys(row.character_connections).length > 0
      ? { characterConnections: row.character_connections }
      : {}),
    ...(row.character_bonds && Object.keys(row.character_bonds).length > 0
      ? { characterBonds: row.character_bonds }
      : {}),
    ...(row.character_bond_progress &&
    Object.keys(row.character_bond_progress).length > 0
      ? { characterBondProgress: row.character_bond_progress }
      : {}),
    ...(row.rank ? { rank: row.rank as NPC["rank"] } : {}),
    ...(row.callsign ? { callsign: row.callsign } : {}),
    updatedDate: new Date(row.updated_at),
    createdDate: new Date(row.created_at),
  };
}

export function npcGMDetailsRowToDocument(row: NPCGMDetailsRow): GMNPC {
  const doc: GMNPC = {};
  if (row.goal) doc.goal = row.goal;
  if (row.role) doc.role = row.role;
  if (row.descriptor) doc.descriptor = row.descriptor;
  if (row.disposition) doc.disposition = row.disposition;
  if (row.activity) doc.activity = row.activity;
  if (row.first_look) doc.firstLook = row.first_look;
  if (row.revealed_aspect) doc.revealedAspect = row.revealed_aspect;
  return doc;
}

const npcFieldToColumn: Record<string, string> = {
  name: "name",
  imageFilenames: "image_filenames",
  icon: "icon",
  sharedWithPlayers: "shared_with_players",
  pronouns: "pronouns",
  species: "species",
  lastLocationId: "last_location_id",
  rank: "rank",
  callsign: "callsign",
};

/**
 * Converts an app-level NPC update into row columns, merging dotted field
 * paths over the current row so no sibling data is lost. Bond and
 * connection maps are excluded: players toggle them through the bond
 * function, which checks character ownership.
 */
export function npcUpdateToColumns(
  row: NPCRow,
  update: DocumentUpdate<NPC>
): Record<string, unknown> {
  const rowByDocumentField: Record<string, unknown> = {
    name: row.name,
    imageFilenames: row.image_filenames,
    icon: row.icon,
    sharedWithPlayers: row.shared_with_players,
    pronouns: row.pronouns,
    species: row.species,
    lastLocationId: row.last_location_id,
    rank: row.rank,
    callsign: row.callsign,
  };
  const merged = applyDocumentUpdate(
    rowByDocumentField,
    update as Record<string, unknown>
  );
  const touched = new Set(
    Object.keys(update as Record<string, unknown>).map(
      (path) => path.split(".")[0]
    )
  );
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(npcFieldToColumn)) {
    if (touched.has(field)) {
      columns[column] = merged[field] ?? null;
    }
  }
  return columns;
}
