import { getSupabaseClient } from "config/supabase.config";
import { WORLD_LOCATIONS_TABLE } from "./locations/_getRef";
import { WORLD_LORE_TABLE } from "./lore/_getRef";
import { WORLD_NPCS_TABLE } from "./npcs/_getRef";

export interface WorldItemExportCounts {
  npcCount: number;
  loreCount: number;
  locationCount: number;
}

/**
 * Counts the world entities readable by the requesting person, for export
 * progress reporting. Non-GMs only see items shared with players, enforced
 * by the database either way; the flag just avoids fetching GM details.
 */
export async function countWorldItemsForExport(
  worldId: string,
  isOwner: boolean
): Promise<WorldItemExportCounts> {
  const client = getSupabaseClient();
  const countIn = async (table: string): Promise<number> => {
    let query = client
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("world_id", worldId);
    if (!isOwner) {
      query = query.eq("shared_with_players", true);
    }
    const { count, error } = await query;
    if (error) {
      throw error;
    }
    return count ?? 0;
  };

  const [npcCount, loreCount, locationCount] = await Promise.all([
    countIn(WORLD_NPCS_TABLE),
    countIn(WORLD_LORE_TABLE),
    countIn(WORLD_LOCATIONS_TABLE),
  ]);

  return { npcCount, loreCount, locationCount };
}
