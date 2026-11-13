import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";
import { DocumentUpdate } from "api-calls/helpers.type";
import { GMLocation, Location } from "types/Locations.type";

/**
 * Identifiers and row mapping for world locations and their GM details.
 * The data layer is the only place that names backend tables, live-update
 * channels and the bond RPC; stores, pages and components stay backend-free.
 *
 * Notes (public and GM-only) are not columns here: they are world_notes
 * rows holding Yjs documents on the note server (see worldNotes.ts).
 */

export const WORLD_LOCATIONS_TABLE = "world_locations";
export const WORLD_LOCATION_GM_DETAILS_TABLE = "world_location_gm_details";

export interface LocationRow {
  id: string;
  world_id: string;
  name: string;
  parent_location_id: string | null;
  image_filenames: string[];
  icon: Record<string, unknown> | null;
  shared_with_players: boolean;
  character_bonds: Record<string, boolean>;
  type: string | null;
  fields: Record<string, string> | null;
  map: Record<string, Record<string, unknown>> | null;
  map_rows: number | null;
  map_cols: number | null;
  map_hex_size: number | null;
  map_background_image_filename: string | null;
  map_background_image_fit: string | null;
  map_stroke_color: string | null;
  show_map: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface LocationGMDetailsRow {
  location_id: string;
  fields: Record<string, string> | null;
  descriptor: string | null;
  trouble: string | null;
  location_features: string | null;
  updated_at: string;
}

export function constructWorldLocationsChannelName(worldId: string): string {
  return `world-locations:${worldId}`;
}

export function constructWorldLocationsFilter(worldId: string): string {
  return `world_id=eq.${worldId}`;
}

export function constructLocationChannelName(locationId: string): string {
  return `world-location:${locationId}`;
}

export function constructLocationIdFilter(locationId: string): string {
  return `location_id=eq.${locationId}`;
}

/**
 * Turns a row-streaming event into an upsert or removal keyed by row id.
 * Deletes arrive with the old row (REPLICA IDENTITY FULL), so listeners see
 * removals as well as changes.
 */
export function locationPayloadToChange(
  payload: PostgresChangePayload<LocationRow>
): RowChange<LocationRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<LocationRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<LocationRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as LocationRow }
    : null;
}

export function locationGMDetailsPayloadToChange(
  payload: PostgresChangePayload<LocationGMDetailsRow>
): RowChange<LocationGMDetailsRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<LocationGMDetailsRow>;
    return typeof old.location_id === "string"
      ? { kind: "remove", key: old.location_id }
      : null;
  }
  const row = payload.new as Partial<LocationGMDetailsRow>;
  return row && typeof row.location_id === "string"
    ? { kind: "upsert", row: row as LocationGMDetailsRow }
    : null;
}

export function locationRowToDocument(row: LocationRow): Location {
  return {
    name: row.name,
    ...(row.parent_location_id
      ? { parentLocationId: row.parent_location_id }
      : {}),
    ...(row.image_filenames && row.image_filenames.length > 0
      ? { imageFilenames: row.image_filenames }
      : {}),
    ...(row.icon ? { icon: row.icon as unknown as Location["icon"] } : {}),
    sharedWithPlayers: row.shared_with_players,
    ...(row.character_bonds && Object.keys(row.character_bonds).length > 0
      ? { characterBonds: row.character_bonds }
      : {}),
    ...(row.type ? { type: row.type } : {}),
    ...(row.fields ? { fields: row.fields } : {}),
    ...(row.map
      ? { map: row.map as unknown as Location["map"] }
      : {}),
    ...(row.map_rows !== null && row.map_rows !== undefined
      ? { mapRows: row.map_rows }
      : {}),
    ...(row.map_cols !== null && row.map_cols !== undefined
      ? { mapCols: row.map_cols }
      : {}),
    ...(row.map_hex_size !== null && row.map_hex_size !== undefined
      ? { mapHexSize: row.map_hex_size }
      : {}),
    ...(row.map_background_image_filename
      ? { mapBackgroundImageFilename: row.map_background_image_filename }
      : {}),
    ...(row.map_background_image_fit
      ? {
          mapBackgroundImageFit: row.map_background_image_fit as Location["mapBackgroundImageFit"],
        }
      : {}),
    ...(row.map_stroke_color
      ? {
          mapStrokeColor:
            row.map_stroke_color as Location["mapStrokeColor"],
        }
      : {}),
    ...(row.show_map !== null && row.show_map !== undefined
      ? { showMap: row.show_map }
      : {}),
    updatedDate: new Date(row.updated_at),
    createdDate: new Date(row.created_at),
  };
}

export function locationGMDetailsRowToDocument(
  row: LocationGMDetailsRow
): GMLocation {
  const doc: GMLocation = {};
  if (row.fields) {
    doc.fields = row.fields;
  }
  if (row.descriptor) {
    doc.descriptor = row.descriptor;
  }
  if (row.trouble) {
    doc.trouble = row.trouble;
  }
  if (row.location_features) {
    doc.locationFeatures = row.location_features;
  }
  return doc;
}

const locationFieldToColumn: Record<string, string> = {
  name: "name",
  parentLocationId: "parent_location_id",
  imageFilenames: "image_filenames",
  icon: "icon",
  sharedWithPlayers: "shared_with_players",
  type: "type",
  fields: "fields",
  map: "map",
  mapRows: "map_rows",
  mapCols: "map_cols",
  mapHexSize: "map_hex_size",
  mapBackgroundImageFilename: "map_background_image_filename",
  mapBackgroundImageFit: "map_background_image_fit",
  mapStrokeColor: "map_stroke_color",
  showMap: "show_map",
};

/**
 * Converts an app-level location update into row columns, merging dotted
 * field paths over the current row so no sibling data is lost. Bond maps
 * are excluded: players toggle bonds through the set_world_item_bond
 * function, which checks character ownership.
 */
export function locationUpdateToColumns(
  row: LocationRow,
  update: DocumentUpdate<Location>
): Record<string, unknown> {
  const rowByDocumentField: Record<string, unknown> = {
    name: row.name,
    parentLocationId: row.parent_location_id,
    imageFilenames: row.image_filenames,
    icon: row.icon,
    sharedWithPlayers: row.shared_with_players,
    type: row.type,
    fields: row.fields,
    map: row.map,
    mapRows: row.map_rows,
    mapCols: row.map_cols,
    mapHexSize: row.map_hex_size,
    mapBackgroundImageFilename: row.map_background_image_filename,
    mapBackgroundImageFit: row.map_background_image_fit,
    mapStrokeColor: row.map_stroke_color,
    showMap: row.show_map,
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
  for (const [field, column] of Object.entries(locationFieldToColumn)) {
    if (touched.has(field)) {
      columns[column] = merged[field] ?? null;
    }
  }
  return columns;
}
