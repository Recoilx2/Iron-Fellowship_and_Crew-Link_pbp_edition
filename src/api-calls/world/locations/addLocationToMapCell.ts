import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { Location, MapEntryType } from "types/Locations.type";
import {
  WORLD_LOCATIONS_TABLE,
  locationRowToDocument,
  type LocationRow,
} from "./_getRef";

/**
 * Places a location on another location's map cell, appending to the
 * cell's location list. Only world GMs may write; the database enforces it.
 */
export const addLocationToMapCell = createApiFunction<
  {
    worldId: string;
    mapLocationId: string;
    row: number;
    col: number;
    locationId: string;
  },
  void
>(async (params) => {
  const { mapLocationId, row, col, locationId } = params;
  const client = getSupabaseClient();
  const { data, error: readError } = await client
    .from(WORLD_LOCATIONS_TABLE)
    .select("*")
    .eq("id", mapLocationId)
    .single();
  if (readError || !data) {
    throw readError ?? new Error("Failed to update location.");
  }
  const doc = locationRowToDocument(data as unknown as LocationRow);
  const map = { ...(doc.map ?? {}) } as NonNullable<Location["map"]>;
  const rowEntry = { ...(map[row] ?? {}) };
  const cell = { ...(rowEntry[col] ?? {}) } as {
    type?: MapEntryType | null;
    locationIds?: string[];
  };
  const locationIds = [...(cell.locationIds ?? [])];
  if (!locationIds.includes(locationId)) {
    locationIds.push(locationId);
  }
  rowEntry[col] = { ...cell, type: MapEntryType.Location, locationIds };
  map[row] = rowEntry;
  const { data: updated, error } = await client
    .from(WORLD_LOCATIONS_TABLE)
    .update({ map: map as unknown as Record<string, Record<string, unknown>> })
    .eq("id", mapLocationId)
    .select("id");
  if (error || !updated || updated.length === 0) {
    throw error ?? new Error("Failed to update location.");
  }
}, "Failed to update location.");
