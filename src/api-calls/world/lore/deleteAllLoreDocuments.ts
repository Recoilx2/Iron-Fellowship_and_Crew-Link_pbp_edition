import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_LORE_TABLE } from "./_getRef";

interface Params {
  worldId: string;
}

/**
 * Deletes every lore document in a world. Notes follow through cascade
 * deletes. Only world GMs may delete; the database enforces it.
 */
export const deleteAllLoreDocuments = createApiFunction<Params, void>(
  async (params) => {
    const { worldId } = params;
    const { error } = await getSupabaseClient()
      .from(WORLD_LORE_TABLE)
      .delete()
      .eq("world_id", worldId);
    if (error) {
      throw error;
    }
  },
  "Failed to delete lore documents."
);
