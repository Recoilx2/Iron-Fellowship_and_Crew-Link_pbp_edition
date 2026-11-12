import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_IMAGES_BUCKET } from "api-calls/world/worldImageStorage";
import { WORLD_LOCATIONS_TABLE } from "./_getRef";

interface Params {
  worldId: string;
  locationId: string;
  imageFilename?: string;
}

/**
 * Deletes a location: its stored images go first (best-effort), then the
 * row, whose GM details and notes follow through cascade deletes. Only
 * world GMs may delete; the database enforces it.
 */
export const deleteLocation = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, locationId } = params;
    const client = getSupabaseClient();
    try {
      const { data: files } = await client.storage
        .from(WORLD_IMAGES_BUCKET)
        .list(`${worldId}/${locationId}`);
      const paths = (files ?? []).map(
        (file) => `${worldId}/${locationId}/${file.name}`
      );
      if (paths.length > 0) {
        await client.storage.from(WORLD_IMAGES_BUCKET).remove(paths);
      }
    } catch (e) {
      console.error(e);
    }
    const { error } = await client
      .from(WORLD_LOCATIONS_TABLE)
      .delete()
      .eq("id", locationId);
    if (error) {
      throw error;
    }
  },
  "Failed to delete location."
);
