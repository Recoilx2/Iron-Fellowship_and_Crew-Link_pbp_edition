import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { GMNPC } from "types/NPCs.type";
import {
  WORLD_NPC_GM_DETAILS_TABLE,
  constructNPCChannelName,
  constructNPCIdFilter,
  npcGMDetailsPayloadToChange,
  npcGMDetailsRowToDocument,
  type NPCGMDetailsRow,
} from "./_getRef";

/**
 * Follows one NPC's structured GM-only fields. Only world GMs receive the
 * row; everyone else receives nothing and treats the NPC as having no GM
 * properties. GM notes arrive through the GM-only world note, not here.
 */
export function listenToNPCGMProperties(
  worldId: string,
  npcId: string,
  updateGMProperties: (properties: GMNPC | undefined) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const client = getSupabaseClient();

  return listenToRows<NPCGMDetailsRow>({
    client,
    channelName: constructNPCChannelName(npcId),
    bindings: [
      {
        type: "postgres_changes",
        table: WORLD_NPC_GM_DETAILS_TABLE,
        filter: constructNPCIdFilter(npcId),
        toChange: npcGMDetailsPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(WORLD_NPC_GM_DETAILS_TABLE)
        .select("*")
        .eq("npc_id", npcId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as NPCGMDetailsRow[];
    },
    getKey: (row) => row.npc_id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const row = rows.find((candidate) => candidate.npc_id === npcId);
      updateGMProperties(row ? npcGMDetailsRowToDocument(row) : undefined);
    },
    onError,
  });
}
