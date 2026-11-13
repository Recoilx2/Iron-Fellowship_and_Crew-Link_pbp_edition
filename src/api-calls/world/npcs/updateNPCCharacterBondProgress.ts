import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Sets one character's bond progress with an NPC (Starforged). World GMs
 * may set any progress; other world viewers may set only their own
 * characters'. The database function enforces both.
 */
export const updateNPCCharacterBondProgress = createApiFunction<
  {
    worldId: string;
    npcId: string;
    characterId: string;
    progress: number;
  },
  void
>(async (params) => {
  const { npcId, characterId, progress } = params;
  const { error } = await getSupabaseClient().rpc("set_world_item_bond", {
    kind: "npc",
    item_id: npcId,
    character_id: characterId,
    field: "character_bond_progress",
    value: progress,
  });
  if (error) {
    throw error;
  }
}, "Error updating npc bond progress.");
