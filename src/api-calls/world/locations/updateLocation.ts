import { getSupabaseClient } from "config/supabase.config";
import { DocumentUpdate } from "api-calls/helpers.type";
import { Location } from "types/Locations.type";
import { createApiFunction } from "api-calls/createApiFunction";
import {
  WORLD_LOCATIONS_TABLE,
  locationUpdateToColumns,
  type LocationRow,
} from "./_getRef";

interface LocationParams {
  worldId: string;
  locationId: string;
  location: DocumentUpdate<Location>;
}

/**
 * Edits a location row. Only world GMs may write; the database enforces
 * it. Dotted field paths merge over the current row so sibling data (map
 * cells, fields) is never lost. Bond maps are excluded: players toggle
 * bonds through the bond function, which checks character ownership.
 */
export const updateLocation = createApiFunction<LocationParams, void>(
  async (params) => {
    const { worldId, locationId, location } = params;
    const client = getSupabaseClient();
    const { data, error: readError } = await client
      .from(WORLD_LOCATIONS_TABLE)
      .select("*")
      .eq("id", locationId)
      .eq("world_id", worldId)
      .single();
    if (readError || !data) {
      throw readError ?? new Error("Failed to update location.");
    }
    const columns = locationUpdateToColumns(
      data as unknown as LocationRow,
      location
    );
    if (Object.keys(columns).length === 0) {
      return;
    }
    const { data: updated, error } = await client
      .from(WORLD_LOCATIONS_TABLE)
      .update(columns)
      .eq("id", locationId)
      .select("id");
    if (error || !updated || updated.length === 0) {
      throw error ?? new Error("Failed to update location.");
    }
  },
  "Failed to update location."
);
