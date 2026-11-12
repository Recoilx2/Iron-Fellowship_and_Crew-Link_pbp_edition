import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { decodeNoteContent } from "api-calls/notes/noteContent";
import { World } from "api-calls/world/_world.type";

/**
 * Identifiers and row mapping for the worlds table. The data layer is the
 * only place that names backend tables, live-update channels and guide
 * RPCs; stores, pages and components stay backend-free.
 *
 * Access follows decision #12: a world's owners and the GMs of every
 * campaign linked to it manage the world; members of linked campaigns read
 * it. The database enforces this, so listeners fetch without client-side
 * ownership filters: rows a person may not see never arrive.
 */

export const WORLDS_TABLE = "worlds";

export interface WorldRow {
  id: string;
  setting_key: string;
  name: string;
  description: string | null;
  new_truths: Record<string, unknown>;
  owner_ids: string[];
  created_at: string;
  updated_at: string;
}

export function constructUserWorldsChannelName(uid: string): string {
  return `user-worlds:${uid}`;
}

export function constructWorldChannelName(worldId: string): string {
  return `world:${worldId}`;
}

export function constructWorldIdFilter(worldId: string): string {
  return `id=eq.${worldId}`;
}

/**
 * Turns a world row into the document shape stores and pages read. The
 * description travels as base64 beside the row; the note server owns the
 * live bytes (see the world-descriptions scope), so this is the initial
 * value for a fresh document.
 */
export function worldRowToDocument(row: WorldRow): World {
  const doc: World = {
    settingKey: row.setting_key,
    name: row.name,
    ownerIds: row.owner_ids ?? [],
  };
  if (row.description) {
    doc.worldDescription = decodeNoteContent(row.description);
  }
  if (row.new_truths && Object.keys(row.new_truths).length > 0) {
    doc.newTruths = row.new_truths as World["newTruths"];
  }
  return doc;
}

const documentFieldToColumn: Record<string, string> = {
  settingKey: "setting_key",
  name: "name",
  newTruths: "new_truths",
  ownerIds: "owner_ids",
};

/**
 * Converts an app-level world update into row columns. The description has
 * its own function (updateWorldDescription) because it is a Yjs document on
 * the note server; guides go through add/remove_world_guide RPCs.
 */
export function worldUpdateToColumns(
  update: Partial<World>
): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(documentFieldToColumn)) {
    const value = (update as Record<string, unknown>)[field];
    if (value !== undefined) {
      columns[column] = value;
    }
  }
  return columns;
}

export function worldPayloadToChange(
  payload: PostgresChangePayload<WorldRow>
): RowChange<WorldRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<WorldRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<WorldRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as WorldRow }
    : null;
}
