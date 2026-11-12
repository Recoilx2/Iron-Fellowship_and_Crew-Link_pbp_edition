import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_IMAGES_BUCKET } from "api-calls/world/worldImageStorage";
import { WORLDS_TABLE } from "./_getRef";

/**
 * Deletes a world and everything under it: items, GM details and notes
 * follow through cascade deletes, and linked campaigns and characters are
 * unlinked by the database. Only world owners may delete (campaign GMs may
 * edit the world but not remove it). Stored images are removed best-effort
 * first so no orphaned files linger.
 */
export const deleteWorld = createApiFunction<string, void>(
  async (worldId) => {
    const client = getSupabaseClient();
    try {
      const { data: entries } = await client.storage
        .from(WORLD_IMAGES_BUCKET)
        .list(worldId);
      const paths: string[] = [];
      for (const entry of entries ?? []) {
        const { data: nested } = await client.storage
          .from(WORLD_IMAGES_BUCKET)
          .list(`${worldId}/${entry.name}`);
        for (const file of nested ?? []) {
          paths.push(`${worldId}/${entry.name}/${file.name}`);
        }
      }
      if (paths.length > 0) {
        await client.storage.from(WORLD_IMAGES_BUCKET).remove(paths);
      }
    } catch (e) {
      console.error(e);
    }
    const { error } = await client
      .from(WORLDS_TABLE)
      .delete()
      .eq("id", worldId);
    if (error) {
      throw error;
    }
  },
  "Failed to delete world."
);
