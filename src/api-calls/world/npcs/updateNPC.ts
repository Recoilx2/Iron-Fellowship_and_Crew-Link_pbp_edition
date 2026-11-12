import { getSupabaseClient } from "config/supabase.config";
import { NPC } from "types/NPCs.type";
import { createApiFunction } from "api-calls/createApiFunction";
import {
  WORLD_NPCS_TABLE,
  npcUpdateToColumns,
  type NPCRow,
} from "./_getRef";

interface NPCParams {
  worldId: string;
  npcId: string;
  npc: Partial<NPC>;
}

/**
 * Edits an NPC row. Only world GMs may write; the database enforces it.
 * Bond and connection maps are excluded: players toggle them through the
 * bond function, which checks character ownership.
 */
export const updateNPC = createApiFunction<NPCParams, void>(
  async (params) => {
    const { worldId, npcId, npc } = params;
    const client = getSupabaseClient();
    const { data, error: readError } = await client
      .from(WORLD_NPCS_TABLE)
      .select("*")
      .eq("id", npcId)
      .eq("world_id", worldId)
      .single();
    if (readError || !data) {
      throw readError ?? new Error("Failed to update npc.");
    }
    const columns = npcUpdateToColumns(data as unknown as NPCRow, npc);
    if (Object.keys(columns).length === 0) {
      return;
    }
    const { error } = await client
      .from(WORLD_NPCS_TABLE)
      .update(columns)
      .eq("id", npcId);
    if (error) {
      throw error;
    }
  },
  "Failed to update npc."
);
