import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { Location } from "types/Locations.type";
import { ensureWorldItemNotes } from "api-calls/world/worldNotes";
import { WORLD_LOCATIONS_TABLE } from "./_getRef";

/**
 * Creates a location from a full document (used when stacking locations
 * and duplicating). Dates travel as document fields; the rows stamp their
 * own created and updated times.
 */
export const createSpecificLocation = createApiFunction<
  { worldId: string; location: Location },
  string
>(async (params) => {
  const { worldId, location } = params;
  const { data, error } = await getSupabaseClient()
    .from(WORLD_LOCATIONS_TABLE)
    .insert({
      world_id: worldId,
      name: location.name,
      parent_location_id: location.parentLocationId ?? null,
      image_filenames: location.imageFilenames ?? [],
      icon: (location.icon ?? null) as unknown as Record<string, unknown> | null,
      shared_with_players: location.sharedWithPlayers ?? true,
      type: location.type ?? null,
      fields: location.fields ?? null,
      map: (location.map ?? null) as unknown as Record<
        string,
        Record<string, unknown>
      > | null,
      map_rows: location.mapRows ?? null,
      map_cols: location.mapCols ?? null,
      map_hex_size: location.mapHexSize ?? null,
      map_background_image_filename:
        location.mapBackgroundImageFilename ?? null,
      map_background_image_fit: location.mapBackgroundImageFit ?? null,
      map_stroke_color: location.mapStrokeColor ?? null,
      show_map: location.showMap ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to create a new location.");
  }
  const id = (data as { id: string }).id;
  await ensureWorldItemNotes(worldId, "location", id);
  return id;
}, "Failed to create a new location.");
