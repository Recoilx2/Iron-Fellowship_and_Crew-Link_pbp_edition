import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_IMAGES_BUCKET } from "api-calls/world/worldImageStorage";
import { WORLD_NPCS_TABLE } from "./_getRef";

interface Params {
  worldId: string;
  npcId: string;
  imageFilename?: string;
}

/**
 * Deletes an NPC: its stored images go first (best-effort), then the row,
 * whose GM details and notes follow through cascade deletes. Only world
 * GMs may delete; the database enforces it.
 */
export const deleteNPC = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, npcId } = params;
    const client = getSupabaseClient();
    try {
      const { data: files } = await client.storage
        .from(WORLD_IMAGES_BUCKET)
        .list(`${worldId}/${npcId}`);
      const paths = (files ?? []).map(
        (file) => `${worldId}/${npcId}/${file.name}`
      );
      if (paths.length > 0) {
        await client.storage.from(WORLD_IMAGES_BUCKET).remove(paths);
      }
    } catch (e) {
      console.error(e);
    }
    const { error } = await client
      .from(WORLD_NPCS_TABLE)
      .delete()
      .eq("id", npcId);
    if (error) {
      throw error;
    }
  },
  "Failed to delete npc."
);
