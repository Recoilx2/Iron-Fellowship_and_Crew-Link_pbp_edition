import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_LOCATIONS_TABLE } from "./_getRef";

interface Params {
  worldId: string;
}

/**
 * Deletes every location in a world. GM details and notes follow through
 * cascade deletes. Only world GMs may delete; the database enforces it.
 */
export const deleteAllLocations = createApiFunction<Params, void>(
  async (params) => {
    const { worldId } = params;
    const { error } = await getSupabaseClient()
      .from(WORLD_LOCATIONS_TABLE)
      .delete()
      .eq("world_id", worldId);
    if (error) {
      throw error;
    }
  },
  "Failed to delete locations."
);
