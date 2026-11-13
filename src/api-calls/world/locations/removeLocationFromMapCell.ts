import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { Location, MapEntry, MapEntryType } from "types/Locations.type";
import {
  WORLD_LOCATIONS_TABLE,
  locationRowToDocument,
  type LocationRow,
} from "./_getRef";

/**
 * Removes a location from another location's map cell. Only world GMs may
 * write; the database enforces it.
 */
export const removeLocationFromMapCell = createApiFunction<
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
  const existingCell = (rowEntry[col] ?? {}) as {
    type?: MapEntryType | null;
    locationIds?: string[];
  };
  const locationIds = [...(existingCell.locationIds ?? [])].filter(
    (id) => id !== locationId
  );
  rowEntry[col] = {
    ...existingCell,
    type: MapEntryType.Location,
    locationIds,
  } as MapEntry;
  map[row] = rowEntry;
  const { error } = await client
    .from(WORLD_LOCATIONS_TABLE)
    .update({ map: map as unknown as Record<string, Record<string, unknown>> })
    .eq("id", mapLocationId);
  if (error) {
    throw error;
  }
}, "Failed to update location.");
