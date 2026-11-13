import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Toggles one character's bond to a location. World GMs may set any bond;
 * other world viewers may set only their own characters'. The database
 * function enforces both.
 */
export const updateLocationCharacterBond = createApiFunction<
  {
    worldId: string;
    locationId: string;
    characterId: string;
    bonded: boolean;
  },
  void
>(async (params) => {
  const { locationId, characterId, bonded } = params;
  const { error } = await getSupabaseClient().rpc("set_world_item_bond", {
    kind: "location",
    item_id: locationId,
    character_id: characterId,
    field: "character_bonds",
    value: bonded,
  });
  if (error) {
    throw error;
  }
}, "Error updating location bonds.");
