import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Toggles one character's bond to an NPC. World GMs may set any bond;
 * other world viewers may set only their own characters'. The database
 * function enforces both.
 */
export const updateNPCCharacterBond = createApiFunction<
  {
    worldId: string;
    npcId: string;
    characterId: string;
    bonded: boolean;
  },
  void
>(async (params) => {
  const { npcId, characterId, bonded } = params;
  const { error } = await getSupabaseClient().rpc("set_world_item_bond", {
    kind: "npc",
    item_id: npcId,
    character_id: characterId,
    field: "character_bonds",
    value: bonded,
  });
  if (error) {
    throw error;
  }
}, "Error updating npc bonds.");
