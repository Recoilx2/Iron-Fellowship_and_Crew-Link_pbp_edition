import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";
import { DocumentUpdate } from "api-calls/helpers.type";
import { Lore } from "types/Lore.type";

/**
 * Identifiers and row mapping for world lore documents. The data layer is
 * the only place that names backend tables and live-update channels;
 * stores, pages and components stay backend-free.
 *
 * Lore has no GM-details table: its only GM-only datum is its GM notes,
 * held in the gm_only world_notes row (see worldNotes.ts).
 */

export const WORLD_LORE_TABLE = "world_lore";

export interface LoreRow {
  id: string;
  world_id: string;
  name: string;
  image_filenames: string[];
  icon: Record<string, unknown> | null;
  shared_with_players: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export function constructWorldLoreChannelName(worldId: string): string {
  return `world-lore:${worldId}`;
}

export function constructWorldLoreFilter(worldId: string): string {
  return `world_id=eq.${worldId}`;
}

export function lorePayloadToChange(
  payload: PostgresChangePayload<LoreRow>
): RowChange<LoreRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<LoreRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<LoreRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as LoreRow }
    : null;
}

export function loreRowToDocument(row: LoreRow): Lore {
  return {
    name: row.name,
    ...(row.image_filenames && row.image_filenames.length > 0
      ? { imageFilenames: row.image_filenames }
      : {}),
    ...(row.icon ? { icon: row.icon as unknown as Lore["icon"] } : {}),
    sharedWithPlayers: row.shared_with_players,
    ...(row.tags && row.tags.length > 0 ? { tags: row.tags } : {}),
    updatedDate: new Date(row.updated_at),
    createdDate: new Date(row.created_at),
  };
}

const loreFieldToColumn: Record<string, string> = {
  name: "name",
  imageFilenames: "image_filenames",
  icon: "icon",
  sharedWithPlayers: "shared_with_players",
  tags: "tags",
};

/**
 * Converts an app-level lore update into row columns, merging dotted
 * field paths over the current row so no sibling data is lost.
 */
export function loreUpdateToColumns(
  row: LoreRow,
  update: DocumentUpdate<Lore>
): Record<string, unknown> {
  const rowByDocumentField: Record<string, unknown> = {
    name: row.name,
    imageFilenames: row.image_filenames,
    icon: row.icon,
    sharedWithPlayers: row.shared_with_players,
    tags: row.tags,
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
  for (const [field, column] of Object.entries(loreFieldToColumn)) {
    if (touched.has(field)) {
      columns[column] = merged[field] ?? null;
    }
  }
  return columns;
}
