import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_IMAGES_BUCKET } from "api-calls/world/worldImageStorage";
import { WORLD_LORE_TABLE } from "./_getRef";

interface Params {
  worldId: string;
  loreId: string;
  imageFilename?: string;
}

/**
 * Deletes a lore document: its stored images go first (best-effort), then
 * the row, whose notes follow through cascade deletes. Only world GMs may
 * delete; the database enforces it.
 */
export const deleteLore = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, loreId } = params;
    const client = getSupabaseClient();
    try {
      const { data: files } = await client.storage
        .from(WORLD_IMAGES_BUCKET)
        .list(`${worldId}/${loreId}`);
      const paths = (files ?? []).map(
        (file) => `${worldId}/${loreId}/${file.name}`
      );
      if (paths.length > 0) {
        await client.storage.from(WORLD_IMAGES_BUCKET).remove(paths);
      }
    } catch (e) {
      console.error(e);
    }
    const { error } = await client
      .from(WORLD_LORE_TABLE)
      .delete()
      .eq("id", loreId);
    if (error) {
      throw error;
    }
  },
  "Failed to delete lore document."
);
