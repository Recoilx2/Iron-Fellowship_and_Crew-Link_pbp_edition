import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Toggles one character's connection to an NPC (Starforged). World GMs
 * may set any connection; other world viewers may set only their own
 * characters'. The database function enforces both.
 */
export const updateNPCCharacterConnection = createApiFunction<
  {
    worldId: string;
    npcId: string;
    characterId: string;
    isConnection: boolean;
  },
  void
>(async (params) => {
  const { npcId, characterId, isConnection } = params;
  const { error } = await getSupabaseClient().rpc("set_world_item_bond", {
    kind: "npc",
    item_id: npcId,
    character_id: characterId,
    field: "character_connections",
    value: isConnection,
  });
  if (error) {
    throw error;
  }
}, "Error updating npc connection.");
